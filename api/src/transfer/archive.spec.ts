import JSZip from 'jszip';
import { ARCHIVE_LIMITS, ArchiveRefused, readArchive, staysInside, UnpackBudget } from './archive';

const markdown = (path: string) => /\.md$/.test(path);
const zipOf = async (files: Record<string, string | Buffer>) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
const read = (buffer: Buffer, limits = ARCHIVE_LIMITS, budget = new UnpackBudget(limits.totalBytes)) =>
  readArchive(buffer, markdown, 'Not Markdown', budget, limits);

/**
 * A zip whose central directory lists `copies` entries that all point at the
 * packed data of its one real entry. Unpacking each of them unpacks that
 * data again, which is what a zip bomb of overlapping entries does.
 */
function overlapping(zip: Buffer, copies: number): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const record = zip.subarray(cdOffset, cdOffset + cdSize);
  const nameLength = record.readUInt16LE(28);
  const records = Array.from({ length: copies }, (_, index) => {
    const copy = Buffer.from(record);
    copy.write(String(index).padStart(nameLength - 3, '0'), 46, 'latin1');
    return copy;
  });
  const directory = Buffer.concat(records);
  const end = Buffer.from(zip.subarray(eocd, eocd + 22));
  end.writeUInt16LE(copies, 8);
  end.writeUInt16LE(copies, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([zip.subarray(0, cdOffset), directory, end]);
}

/** The same zip with the checksum of its first entry changed, in both places it is written. */
function damaged(zip: Buffer): Buffer {
  const copy = Buffer.from(zip);
  copy.writeUInt32LE(copy.readUInt32LE(14) ^ 1, 14);
  const eocd = copy.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cdOffset = copy.readUInt32LE(eocd + 16);
  copy.writeUInt32LE(copy.readUInt32LE(cdOffset + 16) ^ 1, cdOffset + 16);
  return copy;
}

describe('readArchive', () => {
  it('reads the files it is asked for and lists the rest', async () => {
    const contents = await read(await zipOf({ 'A/One.md': '# One', 'A/picture.png': 'png', '.obsidian/x.md': 'x' }));
    expect(contents.files.map((file) => [file.path, file.text])).toEqual([['A/One.md', '# One']]);
    expect(contents.skipped).toEqual([{ file: 'A/picture.png', reason: 'Not Markdown' }]);
  });

  it('never takes an entry whose path leads out of the zip', async () => {
    const contents = await read(await zipOf({ '../outside.md': 'x', 'A/../../up.md': 'y', 'fine.md': 'z' }));
    expect(contents.files.map((file) => file.path)).toEqual(['fine.md']);
    expect(contents.skipped.map((entry) => entry.file).sort()).toEqual(['../outside.md', 'A/../../up.md']);
    expect(contents.skipped.every((entry) => entry.reason === 'Its path leads out of the zip')).toBe(true);
  });

  it('knows a path that leads out when it sees one', () => {
    for (const name of ['/etc/passwd', 'C:/x.md', 'a\\..\\b.md', '..', 'a/../../b', 'a\0.md', '']) {
      expect(staysInside(name)).toBe(false);
    }
    for (const name of ['a.md', 'a/b/c.md', 'a..b.md', '...md']) expect(staysInside(name)).toBe(true);
  });

  it('does not open a zip inside the zip', async () => {
    const inner = await zipOf({ 'deep.md': 'x' });
    const contents = await read(await zipOf({ 'Export-Part-1.zip': inner, 'Notes.enex': '<en-export/>' }));
    expect(contents.files).toEqual([]);
    expect(contents.skipped.map((entry) => entry.file).sort()).toEqual(['Export-Part-1.zip', 'Notes.enex']);
  });

  it('stops unpacking a file at its limit, whatever size the zip claims', async () => {
    // Five megabytes of nothing pack into a few kilobytes.
    const bomb = await zipOf({ 'bomb.md': Buffer.alloc(5 * 1024 * 1024), 'small.md': 'ok' });
    expect(bomb.length).toBeLessThan(64 * 1024);
    const contents = await read(bomb);
    expect(contents.files.map((file) => file.path)).toEqual(['small.md']);
    expect(contents.skipped).toEqual([{ file: 'bomb.md', reason: 'The file is too large' }]);
  });

  it('refuses the zip once the import as a whole unpacks to more than it may', async () => {
    const limits = { ...ARCHIVE_LIMITS, totalBytes: 10_000 };
    const budget = new UnpackBudget(limits.totalBytes);
    await read(await zipOf({ 'a.md': 'x'.repeat(6_000) }), limits, budget);
    expect(budget.remaining).toBe(4_000);
    await expect(read(await zipOf({ 'b.md': 'x'.repeat(6_000) }), limits, budget)).rejects.toThrow(
      new ArchiveRefused('The import unpacks to more than it may'),
    );
  });

  it('refuses a zip with too many entries, and skips files too deep down', async () => {
    const limits = { ...ARCHIVE_LIMITS, entries: 3, depth: 2 };
    await expect(read(await zipOf({ 'a.md': '', 'b.md': '', 'c.md': '', 'd.md': '' }), limits)).rejects.toThrow(
      ArchiveRefused,
    );
    const contents = await read(await zipOf({ 'a/b/ok.md': '', 'a/b/c/deep.md': '' }), { ...limits, entries: 10 });
    expect(contents.files.map((file) => file.path)).toEqual(['a/b/ok.md']);
    expect(contents.skipped).toEqual([{ file: 'a/b/c/deep.md', reason: 'More than 2 folders deep' }]);
  });

  it('refuses what is not a zip', async () => {
    await expect(read(Buffer.from('not a zip'))).rejects.toThrow(new ArchiveRefused('Not a valid zip file'));
  });

  it('unpacks packed data that many entries share only once', async () => {
    const one = await zipOf({ 'aaaa.md': Buffer.alloc(5 * 1024 * 1024) });
    const bomb = overlapping(one, 2_000);
    expect(bomb.length).toBeLessThan(400 * 1024);
    const started = Date.now();
    // JSZip names an entry by its local header, which all of them share, so they are one file.
    const contents = await read(bomb);
    expect(contents.skipped).toEqual([{ file: 'aaaa.md', reason: 'The file is too large' }]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('counts what files that are too large unpacked, so many of them stop at the import limit', async () => {
    const files: Record<string, Buffer> = {};
    for (let index = 0; index < 30; index++) files[`bomb-${index}.md`] = Buffer.alloc(2 * 1024 * 1024);
    const bombs = await zipOf(files);
    const limits = { ...ARCHIVE_LIMITS, fileBytes: 512 * 1024, totalBytes: 4 * 1024 * 1024 };
    const budget = new UnpackBudget(limits.totalBytes);
    // Each file is too large and is skipped, but what it unpacked before that counts: about eight of them use it up.
    await expect(read(bombs, limits, budget)).rejects.toThrow(
      new ArchiveRefused('The import unpacks to more than it may'),
    );
    expect(budget.remaining).toBeLessThan(0);
  });

  it('refuses a file whose checksum does not match, and does not unpack anything before it is asked to', async () => {
    const zip = await zipOf({ 'note.md': 'some text' });
    await expect(read(damaged(zip))).rejects.toThrow(/checksum does not match/);
    // Opening a zip reads its directory only: a damaged file that is skipped costs nothing.
    const skipped = await readArchive(damaged(zip), () => false, 'Not wanted', new UnpackBudget(1));
    expect(skipped.skipped).toEqual([{ file: 'note.md', reason: 'Not wanted' }]);
  });
});

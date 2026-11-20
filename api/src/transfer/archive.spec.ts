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
});

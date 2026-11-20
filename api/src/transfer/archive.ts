import JSZip from 'jszip';
import { crc32 } from 'node:zlib';

/** Limits on what one import may unpack, over all its zips together. */
export interface ArchiveLimits {
  /** Bytes of text unpacked in total. */
  totalBytes: number;
  /** Entries in one zip, folders and files that are not read included. */
  entries: number;
  /** Folders above a file. */
  depth: number;
  /** Bytes one text file may unpack to. */
  fileBytes: number;
  /** Bytes one file kept as bytes (an image, a PDF) may unpack to. */
  binaryBytes: number;
}

export const ARCHIVE_LIMITS: ArchiveLimits = {
  totalBytes: 100 * 1024 * 1024,
  entries: 10_000,
  depth: 12,
  // A note may hold a million characters, which is up to four bytes each.
  fileBytes: 4 * 1024 * 1024,
  // The most an attachment may have (ATTACHMENT_MAX_MB cannot go above it).
  binaryBytes: 50 * 1024 * 1024,
};

export interface ArchiveFile {
  /** The path inside the zip, with forward slashes and no leading one. */
  path: string;
  text: string;
  modified?: Date;
}

/** A file of the zip kept as bytes, such as an image a note shows. */
export interface ArchiveBinary {
  path: string;
  bytes: Buffer;
}

export interface ArchiveContents {
  files: ArchiveFile[];
  /** The files `binary` asked for, as bytes. */
  binaries: ArchiveBinary[];
  skipped: { file: string; reason: string }[];
}

/** What is left of the import's allowance of unpacked bytes. Shared by all zips of one import. */
export class UnpackBudget {
  constructor(public remaining: number) {}
}

export class ArchiveRefused extends Error {}

const ARCHIVE = /\.(zip|7z|rar|tar|tgz|gz|bz2|xz|enex)$/i;

function ignored(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
}

/**
 * Whether a name, as the zip has it, stays inside the zip's root once it is
 * unpacked: relative, no "..", no drive letter, no backslash that some
 * systems would read as a folder.
 */
export function staysInside(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name) || name.includes('\0')) {
    return false;
  }
  return !name.split('/').some((part) => part === '..');
}

/**
 * The text files of a zip, read within the limits. `wanted` says which paths
 * are worth unpacking; everything else is listed as skipped with `reason`.
 * Nothing is ever written to disk, and a zip inside the zip is not opened.
 *
 * Refuses the whole zip, with ArchiveRefused, when it has too many entries
 * or unpacks to more than the import has left.
 */
export async function readArchive(
  buffer: Buffer,
  wanted: (path: string) => boolean,
  reason: string,
  budget: UnpackBudget,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
  binary: (path: string) => boolean = () => false,
): Promise<ArchiveContents> {
  let zip: JSZip;
  try {
    // Only the directory is read here. With checkCRC32 JSZip would unpack every entry
    // to check it, before any limit applies. The checksum is checked while reading below.
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ArchiveRefused('Not a valid zip file');
  }
  const entries = Object.values(zip.files);
  if (entries.length > limits.entries) {
    throw new ArchiveRefused(`The zip has more than ${limits.entries} entries`);
  }

  const contents: ArchiveContents = { files: [], binaries: [], skipped: [] };
  for (const entry of entries) {
    // JSZip cleans "../" out of `name`. What the zip really says is kept aside, and that is what counts.
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (entry.dir) continue;
    if (!staysInside(original)) {
      contents.skipped.push({ file: original, reason: 'Its path leads out of the zip' });
      continue;
    }
    if (ignored(original)) continue;
    if (original.split('/').length - 1 > limits.depth) {
      contents.skipped.push({ file: original, reason: `More than ${limits.depth} folders deep` });
      continue;
    }
    if (ARCHIVE.test(original)) {
      contents.skipped.push({ file: original, reason: 'A file packed inside the zip is not opened. Unpack it first' });
      continue;
    }
    const asBytes = !wanted(original) && binary(original);
    if (!wanted(original) && !asBytes) {
      contents.skipped.push({ file: original, reason });
      continue;
    }
    const { bytes, unpacked } = await readBounded(
      entry,
      Math.min(asBytes ? limits.binaryBytes : limits.fileBytes, budget.remaining + 1),
    );
    // What was unpacked counts, also for a file that turned out too large: entries
    // can share their packed data, and each of them would unpack it all again.
    budget.remaining -= unpacked;
    if (budget.remaining < 0) {
      throw new ArchiveRefused('The import unpacks to more than it may');
    }
    if (bytes === null) {
      contents.skipped.push({ file: original, reason: 'The file is too large' });
      continue;
    }
    if (asBytes) contents.binaries.push({ path: original, bytes });
    else contents.files.push({ path: original, text: bytes.toString('utf8'), modified: entry.date });
  }
  return contents;
}

/** The part of JSZip's internal stream used here. It is public in JSZip, though not in its types. */
interface EntryStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): EntryStream;
  on(event: 'error', listener: (error: Error) => void): EntryStream;
  on(event: 'end', listener: () => void): EntryStream;
  pause(): EntryStream;
  resume(): EntryStream;
}

/**
 * Unpacks one entry, stopping as soon as it passes `limit` bytes, whatever
 * size the zip claims for it: `bytes` is null then. `unpacked` says how much
 * was unpacked either way. The checksum the zip gives is compared at the end.
 */
function readBounded(entry: JSZip.JSZipObject, limit: number): Promise<{ bytes: Buffer | null; unpacked: number }> {
  const expected = (entry as unknown as { _data?: { crc32?: number } })._data?.crc32;
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let checksum = 0;
    let settled = false;
    const stream = (entry as unknown as { internalStream(type: 'uint8array'): EntryStream }).internalStream(
      'uint8array',
    );
    stream
      .on('data', (chunk: Uint8Array) => {
        if (settled) return;
        size += chunk.length;
        if (size > limit) {
          settled = true;
          stream.pause();
          resolve({ bytes: null, unpacked: size });
          return;
        }
        checksum = crc32(chunk, checksum);
        chunks.push(chunk);
      })
      .on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        reject(new ArchiveRefused(`Could not unpack ${entry.name}: ${error.message}`));
      })
      .on('end', () => {
        if (settled) return;
        settled = true;
        if (typeof expected === 'number' && expected >>> 0 !== checksum >>> 0) {
          reject(new ArchiveRefused(`${entry.name} is damaged: its checksum does not match`));
          return;
        }
        resolve({ bytes: Buffer.concat(chunks), unpacked: size });
      })
      .resume();
  });
}

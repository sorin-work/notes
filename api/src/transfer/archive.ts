import JSZip from 'jszip';

/** Limits on what one import may unpack, over all its zips together. */
export interface ArchiveLimits {
  /** Bytes of text unpacked in total. */
  totalBytes: number;
  /** Entries in one zip, folders and files that are not read included. */
  entries: number;
  /** Folders above a file. */
  depth: number;
  /** Bytes one file may unpack to. */
  fileBytes: number;
}

export const ARCHIVE_LIMITS: ArchiveLimits = {
  totalBytes: 100 * 1024 * 1024,
  entries: 10_000,
  depth: 12,
  // A note may hold a million characters, which is up to four bytes each.
  fileBytes: 4 * 1024 * 1024,
};

export interface ArchiveFile {
  /** The path inside the zip, with forward slashes and no leading one. */
  path: string;
  text: string;
  modified?: Date;
}

export interface ArchiveContents {
  files: ArchiveFile[];
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
): Promise<ArchiveContents> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new ArchiveRefused('Not a valid zip file');
  }
  const entries = Object.values(zip.files);
  if (entries.length > limits.entries) {
    throw new ArchiveRefused(`The zip has more than ${limits.entries} entries`);
  }

  const contents: ArchiveContents = { files: [], skipped: [] };
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
    if (!wanted(original)) {
      contents.skipped.push({ file: original, reason });
      continue;
    }
    const bytes = await readBounded(entry, Math.min(limits.fileBytes, budget.remaining + 1));
    if (bytes === null) {
      if (budget.remaining < limits.fileBytes) {
        throw new ArchiveRefused('The import unpacks to more than it may');
      }
      contents.skipped.push({ file: original, reason: 'The file is too large' });
      continue;
    }
    budget.remaining -= bytes.length;
    contents.files.push({ path: original, text: bytes.toString('utf8'), modified: entry.date });
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
 * size the zip claims for it. Null when it does.
 */
function readBounded(entry: JSZip.JSZipObject, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
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
          resolve(null);
          return;
        }
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
        resolve(Buffer.concat(chunks));
      })
      .resume();
  });
}

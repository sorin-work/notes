/** Characters that are not allowed in file names on Windows, macOS or Linux. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

/** A file or folder name for a note title or notebook name. */
export function safeFileName(name: string, fallback = 'Untitled'): string {
  const cleaned = name
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

/** Hands out "name.md", "name (2).md", ... so two notes never share a path. */
export class UniquePaths {
  private readonly used = new Set<string>();

  claim(folder: string, base: string, extension: string): string {
    let candidate = `${folder}${base}${extension}`;
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) {
      candidate = `${folder}${base} (${n})${extension}`;
    }
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}

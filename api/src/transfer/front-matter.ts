import { parseDocument } from 'yaml';

/**
 * Reads and writes the YAML front matter at the top of exported notes.
 *
 * Reading uses a real YAML parser with the core schema only: plain strings,
 * numbers, booleans, null, lists and maps. No custom tags, no aliases, and
 * nothing in the file can make the parser run code or fetch anything. A
 * block that is not clean YAML is left in the note as text, so nothing the
 * file holds is lost. Values are boiled down to what the import uses:
 * strings, booleans and lists of strings.
 */
export type FrontMatterValue = string | boolean | string[];
export type FrontMatter = Record<string, FrontMatterValue>;

export interface ParsedMarkdown {
  data: FrontMatter;
  body: string;
}

const OPENING = /^\uFEFF?---[ \t]*\r?\n/;
/** Front matter is a few lines of metadata. A longer block is not read. */
export const MAX_FRONT_MATTER_LENGTH = 64 * 1024;

export function parseFrontMatter(text: string): ParsedMarkdown {
  const plain = { data: {}, body: text.replace(/^\uFEFF/, '') };
  const opening = OPENING.exec(text);
  if (!opening) return plain;
  const rest = text.slice(opening[0].length);
  const closing = /^(---|\.\.\.)[ \t]*(\r?\n|$)/m.exec(rest);
  if (!closing || closing.index > MAX_FRONT_MATTER_LENGTH) return plain;

  const data = readYaml(rest.slice(0, closing.index));
  if (!data) return plain;
  const body = rest.slice(closing.index + closing[0].length).replace(/^\r?\n/, '');
  return { data, body };
}

/** The top-level keys of a YAML block, or null when the block is not clean YAML. */
function readYaml(source: string): FrontMatter | null {
  const doc = parseDocument(source, { schema: 'core', uniqueKeys: false, logLevel: 'silent' });
  // A tag the core schema does not know, such as !!js/function, is a warning. It is refused like an error.
  if (doc.errors.length > 0 || doc.warnings.length > 0) return null;
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 0 });
  } catch {
    // An alias: refused, so that no block can expand into more than it says.
    return null;
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const data: FrontMatter = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(item)) {
      data[key] = item.flatMap((entry) => {
        const read = scalar(entry);
        return read === null || read === '' ? [] : [String(read).trim()];
      });
      continue;
    }
    const read = scalar(item);
    if (read !== null) data[key] = typeof read === 'boolean' ? read : read.trim();
  }
  return data;
}

function scalar(value: unknown): string | boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

export function serializeFrontMatter(data: FrontMatter): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(quoteIfNeeded).join(', ')}]`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${quoteIfNeeded(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function quoteIfNeeded(value: string): string {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} ._/()-]*$/u.test(value) && !/^(true|false|null|~)$/i.test(value);
  return plain && !/\s$/.test(value) ? value : JSON.stringify(value);
}

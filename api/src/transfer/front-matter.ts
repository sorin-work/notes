/**
 * A small reader and writer for the YAML front matter at the top of exported
 * notes. It understands what the export writes (strings, booleans, dates and
 * lists of strings) plus the common ways other apps write tags, which is
 * enough for importing notes without pulling in a YAML parser.
 */
export type FrontMatterValue = string | boolean | string[];
export type FrontMatter = Record<string, FrontMatterValue>;

export interface ParsedMarkdown {
  data: FrontMatter;
  body: string;
}

const OPENING = /^\uFEFF?---[ \t]*\r?\n/;

export function parseFrontMatter(text: string): ParsedMarkdown {
  const opening = OPENING.exec(text);
  if (!opening) {
    return { data: {}, body: text.replace(/^\uFEFF/, '') };
  }
  const rest = text.slice(opening[0].length);
  const closing = /^(---|\.\.\.)[ \t]*(\r?\n|$)/m.exec(rest);
  if (!closing) {
    return { data: {}, body: text.replace(/^\uFEFF/, '') };
  }

  const data: FrontMatter = {};
  let listKey: string | null = null;
  for (const rawLine of rest.slice(0, closing.index).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;

    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && listKey) {
      const list = data[listKey];
      const value = unquote(item[1].trim());
      if (Array.isArray(list) && value) list.push(value);
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      listKey = null;
      continue;
    }
    const [, key, value] = pair;
    listKey = null;
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = splitInlineList(value.slice(1, -1));
    } else if (value === 'true' || value === 'false') {
      data[key] = value === 'true';
    } else {
      data[key] = unquote(value.trim());
    }
  }

  const body = rest.slice(closing.index + closing[0].length).replace(/^\r?\n/, '');
  return { data, body };
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

function splitInlineList(inner: string): string[] {
  const values: string[] = [];
  for (const match of inner.matchAll(/\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^,]+))/g)) {
    const value = match[1] !== undefined ? unescapeDouble(match[1]) : (match[2]?.replace(/''/g, "'") ?? match[3]);
    const trimmed = value?.trim();
    if (trimmed) values.push(trimmed);
  }
  return values;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return unescapeDouble(value.slice(1, -1));
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function unescapeDouble(value: string): string {
  return value.replace(/\\(["\\nt])/g, (_, char: string) => ({ n: '\n', t: '\t' })[char] ?? char);
}

function quoteIfNeeded(value: string): string {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} ._/()-]*$/u.test(value) && !/^(true|false|null|~)$/i.test(value);
  return plain && !/\s$/.test(value) ? value : JSON.stringify(value);
}

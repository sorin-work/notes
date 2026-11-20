import { isLinkable } from '../links/wikilinks';
import type { ArchiveFile } from './archive';

/** Notion ends every page's file and folder name with a space and a 32-character id. */
const NOTION_ID = / [0-9a-f]{32}(?=(\.[^./]+)?$)/;
const MARKDOWN = /\.(md|markdown)$/i;

/** Whether the files of a zip look like a Notion export: some Markdown file named the Notion way. */
export function isNotionExport(paths: string[]): boolean {
  return paths.some((path) => MARKDOWN.test(path) && NOTION_ID.test(path.split('/').pop() ?? ''));
}

/** "Plans 0123...cdef/Trip 4567...89ab.md" -> "Plans/Trip.md" */
export function stripNotionIds(path: string): string {
  return path
    .split('/')
    .map((part) => part.replace(NOTION_ID, ''))
    .join('/');
}

function folderOf(path: string): string[] {
  return path.split('/').slice(0, -1);
}

/** Resolves a relative link from the file at `from`. Null when it leaves the zip. */
function resolve(from: string, href: string): string | null {
  const parts = folderOf(from);
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function decode(href: string): string | null {
  try {
    return decodeURIComponent(href);
  } catch {
    return null;
  }
}

const TITLE_OF = (path: string) => (path.split('/').pop() ?? '').replace(MARKDOWN, '');

/**
 * One Markdown link `[text](href)`, not an image. The text may hold no
 * brackets, the address no spaces or parentheses, which is how Notion
 * writes links between pages.
 */
const LINK = /(?<!!)\[([^\]\n]*)\]\(([^()\s]+)\)/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Rewrites a Notion export into what the import reads: the ids are gone
 * from every name, so folders become notebooks with their real names, and
 * links between pages become [[wiki links]]. A link whose page has a title
 * that cannot be a wiki link keeps its words only. The heading Notion puts
 * at the top of every page, which repeats its title, is dropped.
 */
export function fromNotion(files: ArchiveFile[]): ArchiveFile[] {
  const pages = new Set(files.map((file) => file.path).filter((path) => MARKDOWN.test(path)));
  return files.map((file) => {
    const path = stripNotionIds(file.path);
    if (!MARKDOWN.test(file.path)) return { ...file, path };
    const title = TITLE_OF(path);
    const text = dropTitleHeading(rewriteLinks(file.text, file.path, pages), title);
    return { ...file, path, text };
  });
}

function rewriteLinks(text: string, from: string, pages: Set<string>): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (marker) {
        if (fence === null) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return line;
      }
      if (fence !== null) return line;
      return line.replace(LINK, (link, words: string, href: string) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !MARKDOWN.test(href.split('#')[0])) return link;
        const decoded = decode(href.split('#')[0]);
        const target = decoded === null ? null : resolve(from, decoded);
        if (target === null || !pages.has(target)) return link;
        const title = TITLE_OF(stripNotionIds(target));
        if (!isLinkable(title)) return words || title;
        const alias = words.trim();
        if (!alias || alias === title || /[[\]|]/.test(alias)) return `[[${title}]]`;
        return `[[${title}|${alias}]]`;
      });
    })
    .join('\n');
}

function dropTitleHeading(text: string, title: string): string {
  const match = /^\uFEFF?# (.*)\r?\n(\r?\n)?/.exec(text);
  return match && match[1].trim() === title.trim() ? text.slice(match[0].length) : text;
}

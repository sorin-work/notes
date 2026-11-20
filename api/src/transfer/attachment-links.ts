/**
 * Links from a note to files next to it, as Markdown writes them
 * (`![alt](images/photo.png)`, `[the plan](plan.pdf)`) and as Obsidian
 * embeds them (`![[photo.png]]`), and the `attachment:<id>` links the app
 * uses for its own files. An import turns the first two into the third; an
 * export turns the third back into the first.
 */

/** Extensions of the files an import takes as attachments. The bytes decide in the end. */
export const ATTACHMENT_EXTENSIONS = /\.(png|jpe?g|gif|webp|pdf)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const MARKDOWN_LINK = /(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^()\s]+)(\s+"[^"\n]*")?\)/g;
const EMBED = /!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;
export const ATTACHMENT_REFERENCE = /attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

export interface FileReference {
  /** The path of the file in the archive. */
  path: string;
  /** What the rewritten link shows. */
  words: string;
  image: boolean;
}

/** Runs `replace` over every line outside fenced code blocks. */
function outsideCode(text: string, replace: (line: string) => string): string {
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
      return fence === null ? replace(line) : line;
    })
    .join('\n');
}

function decode(href: string): string | null {
  try {
    return decodeURIComponent(href);
  } catch {
    return null;
  }
}

/** A relative link from the file at `from`, as a path in the archive. Null when it is not relative or leaves it. */
export function resolveRelative(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return null;
  const decoded = decode(href.split('#')[0].split('?')[0]);
  if (!decoded) return null;
  const parts = from.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
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

const clean = (words: string) =>
  words
    .replace(/[[\]()\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Rewrites the links of the note at `from` that lead to files the archive
 * holds into `attachment:<id>` links. `find` names the file a link means, or
 * nothing; `idFor` gives the attachment id for a file, the same one for the
 * same file within the note. Links to anything else stay as they are.
 */
export function linkAttachments(
  text: string,
  from: string,
  find: (path: string, embed: boolean) => string | undefined,
  idFor: (reference: FileReference) => string,
): string {
  return outsideCode(text, (line) =>
    line
      .replace(EMBED, (embed, target: string, alias: string | undefined) => {
        const path = find(target.trim(), true);
        if (!path) return embed;
        const name = path.split('/').pop() ?? path;
        const image = IMAGE_EXTENSIONS.test(path);
        const words = clean(alias ?? name) || 'file';
        return `${image ? '!' : ''}[${words}](attachment:${idFor({ path, words, image })})`;
      })
      .replace(MARKDOWN_LINK, (link, bang: string, words: string, href: string) => {
        const target = href.startsWith('<') ? href.slice(1, -1) : href;
        const relative = resolveRelative(from, target);
        const path = relative === null ? undefined : find(relative, false);
        if (!path) return link;
        const image = bang === '!';
        const shown = clean(words) || (path.split('/').pop() ?? 'file');
        return `${image ? '!' : ''}[${shown}](attachment:${idFor({ path, words: shown, image })})`;
      }),
  );
}

/** The ids of the `attachment:` links in a text. */
export function attachmentIds(text: string): string[] {
  return [...new Set([...text.matchAll(ATTACHMENT_REFERENCE)].map((match) => match[1]))];
}

/** The text with every `attachment:<id>` link changed by `to`. Ids it gives nothing for stay as they are. */
export function replaceAttachmentLinks(text: string, to: (id: string) => string | undefined): string {
  return text.replace(ATTACHMENT_REFERENCE, (reference, id: string) => to(id) ?? reference);
}

/** The same text whichever attachments its links name, for telling a re-import apart from new text. */
export function withoutAttachmentIds(text: string): string {
  return text.replace(ATTACHMENT_REFERENCE, 'attachment:');
}

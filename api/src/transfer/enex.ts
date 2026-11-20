import { SaxesParser } from 'saxes';
import type { FrontMatter } from './front-matter';
import { htmlToMarkdown } from './html-to-markdown';

/** One note read from an .enex file, before it goes through the import like any other. */
export interface EnexNote {
  title: string;
  markdown: string;
  data: FrontMatter;
}

export interface EnexContents {
  notes: EnexNote[];
  /** Attachments and images, which are not imported yet. */
  resourcesSkipped: number;
  skipped: { file: string; reason: string }[];
}

export class EnexRefused extends Error {}

/** ENML is HTML, so a note can be larger than its Markdown. Past this its HTML is not converted at all. */
export const MAX_NOTE_HTML_LENGTH = 4_000_000;
/** An .enex is a flat list of notes. Anything nested deeper than this is not one. */
const MAX_DEPTH = 16;

/** "20240102T101112Z", the way Evernote writes a date. */
function enexDate(value: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

interface OpenNote {
  title: string;
  content: string;
  contentTooLong: boolean;
  created: string;
  updated: string;
  tags: string[];
  resources: number;
}

/**
 * Reads an Evernote export. The XML goes through a streaming parser that
 * reads no DTD and fetches nothing. It knows the five entities of XML and
 * character references, and a file that uses any other entity is refused,
 * so no entity can expand. A DOCTYPE with declarations of its own is
 * refused too; the plain one Evernote writes is passed over.
 *
 * Each note's HTML becomes Markdown. Its title, tags and dates come along.
 * Attachments are counted and left out.
 */
export function readEnex(xml: string, file: string): EnexContents {
  const contents: EnexContents = { notes: [], resourcesSkipped: 0, skipped: [] };
  const parser = new SaxesParser({ xmlns: false, position: true });
  const path: string[] = [];
  let note: OpenNote | null = null;
  let failure: Error | null = null;

  const field = (): string | null => {
    if (!note || path.length !== 3 || path[1] !== 'note') return null;
    return path[2];
  };
  const take = (text: string) => {
    if (!note) return;
    switch (field()) {
      case 'title':
        note.title += text;
        break;
      case 'content':
        if (note.content.length + text.length > MAX_NOTE_HTML_LENGTH) note.contentTooLong = true;
        else note.content += text;
        break;
      case 'created':
        note.created += text;
        break;
      case 'updated':
        note.updated += text;
        break;
      case 'tag':
        note.tags[note.tags.length - 1] += text;
        break;
    }
  };

  parser.on('doctype', (doctype) => {
    if (doctype.includes('[')) failure = new EnexRefused('The file declares a DTD of its own');
  });
  parser.on('opentag', (tag) => {
    path.push(tag.name);
    if (path.length > MAX_DEPTH) failure = new EnexRefused('Not an Evernote export');
    if (path.length === 1 && tag.name !== 'en-export') failure = new EnexRefused('Not an Evernote export');
    if (path.length === 2 && tag.name === 'note') {
      note = { title: '', content: '', contentTooLong: false, created: '', updated: '', tags: [], resources: 0 };
    }
    if (note && path.length === 3 && tag.name === 'tag') note.tags.push('');
    if (note && path.length === 3 && tag.name === 'resource') note.resources++;
  });
  parser.on('text', take);
  parser.on('cdata', take);
  parser.on('closetag', () => {
    if (path.length === 2 && note) {
      finish(note);
      note = null;
    }
    path.pop();
  });
  parser.on('error', (error) => {
    failure ??= new EnexRefused(`Not a readable Evernote export: ${error.message}`);
  });

  const finish = (open: OpenNote) => {
    contents.resourcesSkipped += open.resources;
    const title = open.title.replace(/\s+/g, ' ').trim() || 'Untitled';
    if (open.contentTooLong) {
      contents.skipped.push({ file: `${file}: ${title}`, reason: 'The note is too long' });
      return;
    }
    let markdown: string;
    try {
      markdown = htmlToMarkdown(open.content);
    } catch {
      contents.skipped.push({ file: `${file}: ${title}`, reason: 'Its text could not be read' });
      return;
    }
    const data: FrontMatter = { title };
    const tags = open.tags.map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) data.tags = tags;
    const created = enexDate(open.created);
    const updated = enexDate(open.updated);
    if (created) data.created = created;
    if (updated) data.updated = updated;
    contents.notes.push({ title, markdown, data });
  };

  // The parser reports through the handlers above. Once one of them has
  // refused the file nothing more of it is read.
  const CHUNK = 64 * 1024;
  for (let offset = 0; offset < xml.length && !failure; offset += CHUNK) {
    parser.write(xml.slice(offset, offset + CHUNK));
  }
  if (!failure) parser.close();
  if (failure) throw failure;
  return contents;
}

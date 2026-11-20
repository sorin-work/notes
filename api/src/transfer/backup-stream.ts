import { BadRequestException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { parser } from 'stream-json';
import Assembler from 'stream-json/Assembler';
import { MAX_CONTENT_LENGTH } from '../notes/dto/note.dto';
import { MAX_VERSIONS_PER_NOTE } from '../versions/versions.service';
import { BackupNote, BackupNotebook, BackupPreferences, BackupTag } from './backup';
import {
  invalid,
  NoteRules,
  readExportedAt,
  readFormat,
  readNote,
  readNotebooks,
  readPreferences,
  readShareLinks,
  readTags,
} from './backup-check';

/** What a restore does with each part of a backup as it is read. */
export interface BackupSink {
  notebooks(notebooks: BackupNotebook[]): Promise<void>;
  tags(tags: BackupTag[]): Promise<void>;
  note(note: BackupNote): Promise<void>;
}

export interface BackupSummary {
  notes: number;
  shareLinks: number;
  preferences: BackupPreferences;
}

/**
 * The most text one note can hold: its own and that of every version, with
 * room for its other fields. A value past this is refused while it is still
 * coming in, so no single note can fill the memory.
 */
const MAX_NOTE_CHARS = (MAX_VERSIONS_PER_NOTE + 1) * (MAX_CONTENT_LENGTH + 1_000) + 100_000;
/** The lists before the notes are small. */
const MAX_LIST_CHARS = 64 * 1024 * 1024;

/** The tokens stream-json emits, as far as this reader looks at them. */
interface Token {
  name: string;
  value?: string;
}

const VALUE_START = new Set([
  'startObject',
  'startArray',
  'startString',
  'startNumber',
  'nullValue',
  'trueValue',
  'falseValue',
]);
const CHUNK = new Set(['stringChunk', 'numberChunk', 'keyChunk']);

/**
 * Reads a backup from a stream, part by part, and hands each part to `sink`
 * as soon as it is read and checked. The notes come one at a time, and the
 * next is not read before the sink is done with the last, so the file is
 * never in memory as a whole, whatever its size.
 *
 * The order is the one the app writes: format and version first, the
 * notebooks before the notes. The daily note choices are checked at the
 * end, once the templates they may name are known.
 */
export async function readBackupStream(source: Readable, sink: BackupSink): Promise<BackupSummary> {
  // pipe and not pipeline: pipeline would destroy the request on a parse error, and the
  // client would get a broken connection instead of the 400 that says what is wrong.
  const tokens = parser();
  source.on('error', (error) => tokens.destroy(error));
  source.pipe(tokens);
  const rules = new NoteRules();
  let notebookIds: Set<string> | null = null;
  let format: unknown;
  let version: unknown;
  let formatChecked = false;
  let preferences: unknown;
  let shareLinks = 0;
  let notes = 0;

  let depth = 0;
  let key: string | null = null;
  let inNotes = false;
  let assembler: Assembler | null = null;
  let chars = 0;
  let finished = false;

  const checkFormat = () => {
    if (!formatChecked) readFormat(format, version);
    formatChecked = true;
  };

  const top = async (name: string, value: unknown) => {
    switch (name) {
      case 'format':
        format = value;
        return;
      case 'version':
        version = value;
        return;
      case 'exportedAt':
        checkFormat();
        readExportedAt(value);
        return;
      case 'preferences':
        preferences = value;
        return;
      case 'notebooks': {
        checkFormat();
        const notebooks = readNotebooks(value);
        notebookIds = new Set(notebooks.map((notebook) => notebook.id));
        await sink.notebooks(notebooks);
        return;
      }
      case 'tags':
        checkFormat();
        await sink.tags(readTags(value));
        return;
      case 'shareLinks':
        checkFormat();
        shareLinks = readShareLinks(value).length;
        return;
      default:
      // A field this version does not know is passed over.
    }
  };

  try {
    for await (const token of tokens as AsyncIterable<Token>) {
      if (CHUNK.has(token.name)) {
        chars += token.value?.length ?? 0;
        if (chars > (inNotes ? MAX_NOTE_CHARS : MAX_LIST_CHARS)) {
          invalid(inNotes ? `notes[${notes}]` : (key ?? 'the file'), 'is larger than anything the app writes');
        }
        continue;
      }
      if (assembler) {
        const handled = typeof (assembler as unknown as Record<string, unknown>)[token.name] === 'function';
        assembler.consume(token as never);
        if (handled && assembler.done) {
          const value: unknown = assembler.current;
          assembler = null;
          if (inNotes) {
            if (!notebookIds) invalid('notes', 'come before the notebooks');
            checkFormat();
            const note = readNote(value, notes, notebookIds);
            rules.add(note);
            notes++;
            await sink.note(note);
          } else if (key !== null) {
            await top(key, value);
          }
        }
        continue;
      }
      if (depth === 0) {
        if (token.name !== 'startObject' || finished) invalid('the file', 'is not a notes-backup file');
        depth = 1;
        continue;
      }
      if (inNotes) {
        if (token.name === 'endArray') {
          inNotes = false;
        } else if (VALUE_START.has(token.name)) {
          chars = 0;
          assembler = new Assembler();
          assembler.consume(token as never);
        }
        continue;
      }
      if (token.name === 'keyValue') {
        key = token.value ?? null;
        continue;
      }
      if (token.name === 'endObject') {
        depth = 0;
        finished = true;
        continue;
      }
      if (key === 'notes' && token.name === 'startArray') {
        inNotes = true;
        continue;
      }
      if (VALUE_START.has(token.name)) {
        chars = 0;
        assembler = new Assembler();
        const handled = typeof (assembler as unknown as Record<string, unknown>)[token.name] === 'function';
        assembler.consume(token as never);
        if (handled && assembler.done) {
          // null, true or false: done at once.
          const value: unknown = assembler.current;
          assembler = null;
          if (key !== null) await top(key, value);
        }
      }
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('The file is not JSON, or it ends too early');
  } finally {
    // Nothing more of a refused file is read here. For a request, Node throws the
    // rest away once the answer is sent, so the client gets the answer.
    if (!source.readableEnded) source.unpipe();
  }

  if (!finished) throw new BadRequestException('The file is not JSON, or it ends too early');
  checkFormat();
  if (!notebookIds) invalid('notebooks', 'is missing');
  return {
    notes,
    shareLinks,
    preferences: readPreferences(preferences, notebookIds, rules.templates),
  };
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Attachment, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { signatureIsValid, signedPath } from './signed-url';
import { sniffType } from './sniff';
import { AttachmentStorage } from './storage';

/** A file without a row is only removed once it is this old: an upload writes the file just before its row. */
const SWEEP_GRACE_MS = 60 * 60 * 1000;
export const MAX_FILE_NAME_LENGTH = 200;

export interface AttachmentView {
  id: string;
  noteId: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: Date;
  /** Works without a login for a few minutes. Ask again for a fresh one. */
  url: string;
  /** What to put in the note to show or link the file. */
  markdown: string;
}

/** A file that is checked and stored, waiting for its row. */
export interface StoredFile {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ServedFile {
  stream: ReadStream;
  contentType: string;
  inline: boolean;
  fileName: string;
  size: number;
}

/** The name a file came with, cut down to one plain line: it is shown, never used as a path. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_FILE_NAME_LENGTH);
  return cleaned || 'file';
}

/** `![name](attachment:id)` for an image, `[name](attachment:id)` for anything else. */
export function attachmentMarkdown(id: string, fileName: string, contentType: string): string {
  const words = fileName.replace(/[[\]()\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'file';
  return `${contentType.startsWith('image/') ? '!' : ''}[${words}](attachment:${id})`;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  view(attachment: Attachment, now = Date.now()): AttachmentView {
    return {
      id: attachment.id,
      noteId: attachment.noteId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      url: signedPath(this.config.jwtSecret, attachment.id, attachment.userId, now),
      markdown: attachmentMarkdown(attachment.id, attachment.fileName, attachment.contentType),
    };
  }

  /** Signed addresses by attachment id, for what a page shows. */
  urls(attachments: Pick<Attachment, 'id' | 'userId'>[], now = Date.now()): Record<string, string> {
    return Object.fromEntries(
      attachments.map((attachment) => [
        attachment.id,
        signedPath(this.config.jwtSecret, attachment.id, attachment.userId, now),
      ]),
    );
  }

  async list(userId: string, noteId: string): Promise<AttachmentView[]> {
    await this.findNote(userId, noteId);
    const attachments = await this.prisma.attachment.findMany({ where: { noteId }, orderBy: { createdAt: 'asc' } });
    return attachments.map((attachment) => this.view(attachment));
  }

  /**
   * Stores an upload for a note. The type comes from the bytes and has to
   * be on the list; the file and the account have to stay within their
   * limits. The account's total is counted under a lock on the user row, so
   * uploads at the same moment cannot together pass the limit.
   */
  async upload(userId: string, noteId: string, upload: { originalname: string; buffer: Buffer }) {
    const note = await this.findNote(userId, noteId);
    if (note.deletedAt) throw new ConflictException('This note is in the trash');
    const stored = await this.check(upload.originalname, upload.buffer);

    await this.storage.write(stored.id, upload.buffer);
    try {
      const attachment = await this.prisma.$transaction(async (tx) => {
        await this.assertRoom(tx, userId, stored.size);
        return tx.attachment.create({ data: { ...stored, userId, noteId } });
      });
      return this.view(attachment);
    } catch (error) {
      await this.storage.remove([stored.id]);
      throw error;
    }
  }

  /**
   * Checks a file and writes it to storage under a new id, for a row the
   * caller makes (an import or a restore, inside its own transaction).
   * Null when the type is not allowed or the file is too large; the caller
   * says so in its own words.
   */
  async store(fileName: string, bytes: Buffer): Promise<StoredFile | null> {
    let stored: StoredFile;
    try {
      stored = await this.check(fileName, bytes);
    } catch {
      return null;
    }
    await this.storage.write(stored.id, bytes);
    return stored;
  }

  /** Refuses the bytes of `extra` more when the account would go past its limit. Call inside a transaction. */
  async assertRoom(tx: Prisma.TransactionClient, userId: string, extra: number): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const used = await tx.attachment.aggregate({ where: { userId }, _sum: { size: true } });
    if ((used._sum.size ?? 0) + extra > this.config.attachmentAccountBytes) {
      throw new PayloadTooLargeException(
        `Attachments may take ${Math.round(this.config.attachmentAccountBytes / 1024 / 1024)} MB per account, and this would go past it`,
      );
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const attachment = await this.prisma.attachment.findFirst({ where: { id, userId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.remove([id]);
  }

  /** The file behind a signed address. The same 404 for a wrong, expired or missing one. */
  async serve(id: string, expires: string | undefined, signature: string | undefined): Promise<ServedFile> {
    const attachment = /^[0-9a-f-]{36}$/.test(id) ? await this.prisma.attachment.findUnique({ where: { id } }) : null;
    if (!attachment || !signatureIsValid(this.config.jwtSecret, id, attachment.userId, expires, signature)) {
      throw new NotFoundException('Not found, or the link has run out');
    }
    return {
      stream: this.storage.open(id),
      contentType: attachment.contentType,
      // The type was decided from the bytes when the file came in. Images only are shown in the page.
      inline: attachment.contentType.startsWith('image/'),
      fileName: attachment.fileName,
      size: attachment.size,
    };
  }

  /** The files of the notes `where` picks, so they can be removed after their rows are gone. */
  async idsOfNotes(where: Prisma.NoteWhereInput): Promise<string[]> {
    const rows = await this.prisma.attachment.findMany({ where: { note: where }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  async removeFiles(ids: string[]): Promise<void> {
    await this.storage.remove(ids);
  }

  /** Removes the files that have no row, older than an hour. Answers how many. */
  sweep(now = Date.now()): Promise<number> {
    return this.storage.sweep(
      async (ids) => {
        const rows = await this.prisma.attachment.findMany({ where: { id: { in: ids } }, select: { id: true } });
        return new Set(rows.map((row) => row.id));
      },
      SWEEP_GRACE_MS,
      now,
    );
  }

  read(id: string): Promise<Buffer> {
    return this.storage.read(id);
  }

  private async check(fileName: string, bytes: Buffer): Promise<StoredFile> {
    if (bytes.length > this.config.attachmentMaxBytes) {
      throw new PayloadTooLargeException(
        `A file may have ${Math.round(this.config.attachmentMaxBytes / 1024 / 1024)} MB at most`,
      );
    }
    const type = sniffType(bytes);
    if (!type) {
      throw new BadRequestException('Only PNG, JPEG, GIF and WebP images, PDF and plain text can be attached');
    }
    return { id: randomUUID(), fileName: cleanFileName(fileName), contentType: type.contentType, size: bytes.length };
  }

  private async findNote(userId: string, noteId: string) {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId }, select: { deletedAt: true } });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }
}

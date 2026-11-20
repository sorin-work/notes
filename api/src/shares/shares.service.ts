import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ShareLink } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../auth/password';
import { APP_CONFIG, AppConfig } from '../config/config';
import { LinksService } from '../links/links.service';
import { extractWikiLinks, normalizeTitle, unlinkExcept } from '../links/wikilinks';
import { NotebooksService } from '../notebooks/notebooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShareOptionsDto } from './dto/share.dto';
import { accessIsValid, signAccess } from './share-access';
import { SharePasswordAttempts, TooManyWrongPasswords } from './share-password-attempts';

/** What a link shares: one note, or one notebook with everything in it. */
export type ShareSubject = { noteId: string } | { notebookId: string };

/** What the owner sees of a link. The password itself is never given back, only whether there is one. */
export interface ShareView {
  token: string;
  viewCount: number;
  createdAt: Date;
  expiresAt: Date | null;
  /** True once expiresAt has passed. The link then answers like one that does not exist. */
  expired: boolean;
  hasPassword: boolean;
}

export interface SharedNote {
  kind: 'note';
  title: string;
  /**
   * The text with its [[links]] gone over: a link stays a link only when
   * the reader may follow it. See unlinkExcept.
   */
  content: string;
  tags: string[];
  updatedAt: Date;
  /** Where each link that is left leads, by normalised title: "/s/<token>" or "/s/<token>/<note id>". */
  links: Record<string, string>;
  /** Only in the answer to the right password. See share-access.ts. */
  access?: string;
}

/** The index page of a shared notebook. */
export interface SharedNotebook {
  kind: 'notebook';
  name: string;
  notes: {
    id: string;
    title: string;
    updatedAt: Date;
    /** The notebook inside the shared one, if the note is in one. */ notebook: string | null;
  }[];
  access?: string;
}

/** Who is asking, as far as the request says. */
export interface ShareViewer {
  /** The account of a valid login token sent along, if any. */
  userId?: string;
  /** What was typed into the password prompt, if anything. */
  password?: string;
  /** Proof of an earlier right password, from the X-Share-Access header. */
  access?: string;
}

/**
 * The one answer for everything that cannot be read: a link that is
 * mistyped, revoked or expired, a note in the trash, and a note that is not,
 * or no longer, in the shared notebook. Someone outside cannot tell which.
 */
const GONE = 'This link does not exist or is no longer shared';

export function newShareToken(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * The 403 that makes the page ask for the password. It has to be different
 * from "gone", or there would be nothing to show the prompt on. That a live
 * link has a password is all it gives away. Not a 401: the web app takes a
 * 401 to mean that its own login is over.
 */
function passwordRequired(message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, error: 'Forbidden', message, passwordRequired: true });
}

/** A link that passed the checks, with what is needed to read through it. */
/** A notebook's name and the names above it, as far up as notebooks nest. */
const NOTEBOOK_PATH = {
  name: true,
  parent: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
} as const;

interface NotebookPath {
  id?: string;
  name: string;
  parent?: NotebookPath | null;
}

/** "Bread / Rye": where a notebook sits inside the shared notebook `rootId`, which is left out. */
function pathBelow(notebook: NotebookPath | null | undefined, rootId: string | null): string | null {
  const names: string[] = [];
  for (let at = notebook; at && at.id !== rootId; at = at.parent) names.unshift(at.name);
  return names.length ? names.join(' / ') : null;
}

interface OpenShare {
  share: ShareLink;
  ownerId: string;
  /** The notebooks whose notes the link covers: the shared one and those inside it. Null for a link to one note. */
  notebookIds: string[] | null;
  access?: string;
}

const NOTE_FIELDS = {
  id: true,
  title: true,
  content: true,
  updatedAt: true,
  tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' as const } } },
};

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly attempts: SharePasswordAttempts,
    private readonly notebooks: NotebooksService,
  ) {}

  async get(userId: string, subject: ShareSubject): Promise<ShareView | null> {
    await this.findOwned(userId, subject);
    const share = await this.prisma.shareLink.findUnique({ where: subject });
    return share ? toShareView(share) : null;
  }

  /** Returns the share link of the note or notebook, creating one if it has none. Options that are given are applied either way. */
  async create(userId: string, subject: ShareSubject, options: ShareOptionsDto = {}): Promise<ShareView> {
    const owned = await this.findOwned(userId, subject);
    if (owned.deletedAt) {
      throw new NotFoundException('Note not found');
    }
    const changes = await this.changesFrom(options);
    const share = await this.prisma.shareLink.upsert({
      where: subject,
      create: { ...subject, token: newShareToken(), ...changes },
      update: changes,
    });
    return toShareView(share);
  }

  /** Changes when the link runs out and whether it asks for a password. The link itself stays the same. */
  async update(userId: string, subject: ShareSubject, options: ShareOptionsDto): Promise<ShareView> {
    await this.findOwned(userId, subject);
    const existing = await this.prisma.shareLink.findUnique({ where: subject });
    if (!existing) {
      throw new NotFoundException('noteId' in subject ? 'This note is not shared' : 'This notebook is not shared');
    }
    const share = await this.prisma.shareLink.update({ where: subject, data: await this.changesFrom(options) });
    return toShareView(share);
  }

  /** Stops sharing. The old link stops working; sharing again makes a new one. */
  async revoke(userId: string, subject: ShareSubject): Promise<void> {
    await this.findOwned(userId, subject);
    await this.prisma.shareLink.deleteMany({ where: subject });
  }

  /** What `/s/<token>` shows: the note of a link to a note, the index of a link to a notebook. */
  async view(token: string, viewer: ShareViewer = {}, now = new Date()): Promise<SharedNote | SharedNotebook> {
    const open = await this.open(token, viewer, now);
    const content = open.share.noteId
      ? await this.noteFor(open, token, { id: open.share.noteId }, now)
      : await this.indexFor(open);
    await this.count(open, viewer);
    return open.access ? { ...content, access: open.access } : content;
  }

  /**
   * One note of a shared notebook. Whether the note belongs to the notebook
   * is asked now, with this request: a note moved in a minute ago is there,
   * and one moved out or put in the trash is gone, with nothing to refresh.
   */
  async viewNote(token: string, noteId: string, viewer: ShareViewer = {}, now = new Date()): Promise<SharedNote> {
    const open = await this.open(token, viewer, now);
    if (!open.notebookIds) {
      throw new NotFoundException(GONE);
    }
    const note = await this.noteFor(open, token, { id: noteId, notebookId: { in: open.notebookIds } }, now);
    await this.count(open, viewer);
    return note;
  }

  /**
   * The checks every reader goes through, in an order that matters. "Gone"
   * comes first, so a link that has run out looks like any dead link and
   * not like a prompt, password or not. Then the password, or proof of it.
   */
  private async open(token: string, viewer: ShareViewer, now: Date): Promise<OpenShare> {
    const share = await this.prisma.shareLink.findUnique({
      where: { token },
      include: {
        note: { select: { userId: true, deletedAt: true } },
        notebook: { select: { id: true, userId: true } },
      },
    });
    const ownerId = share?.note?.userId ?? share?.notebook?.userId;
    if (!share || !ownerId || share.note?.deletedAt || isExpired(share, now)) {
      throw new NotFoundException(GONE);
    }

    const owner = viewer.userId === ownerId;
    let access: string | undefined;
    if (share.passwordHash) {
      if (viewer.password !== undefined) {
        // The link's allowance of wrong passwords comes before the password is
        // compared, so a link that is being guessed at costs no hashing. The
        // owner signed in is not guessing: their attempts are neither counted
        // against the link nor refused because others used it up.
        const wait = owner ? 0 : this.attempts.take(share.id);
        if (wait > 0) {
          throw new TooManyWrongPasswords(wait);
        }
        if (!(await verifyPassword(viewer.password, share.passwordHash))) {
          throw passwordRequired('That password is not right');
        }
        if (!owner) this.attempts.giveBack(share.id);
        access = signAccess(this.config.jwtSecret, share.id, share.passwordHash, now);
      } else if (!accessIsValid(this.config.jwtSecret, viewer.access, share.id, share.passwordHash, now)) {
        throw passwordRequired('This link is protected by a password');
      }
    }
    // Everything inside the notebook, at any depth, asked for now.
    const notebookIds = share.notebook ? await this.notebooks.idsWithChildren(ownerId, share.notebook.id) : null;
    return { share, ownerId, notebookIds, access };
  }

  /** A view is a successful read by anyone but the owner. */
  private async count(open: OpenShare, viewer: ShareViewer): Promise<void> {
    if (viewer.userId !== open.ownerId) {
      await this.prisma.shareLink.update({ where: { id: open.share.id }, data: { viewCount: { increment: 1 } } });
    }
  }

  private async indexFor(open: OpenShare): Promise<SharedNotebook> {
    const rootId = open.share.notebookId;
    const [notebook, notes] = await Promise.all([
      this.prisma.notebook.findUniqueOrThrow({ where: { id: rootId ?? '' }, select: { name: true } }),
      this.prisma.note.findMany({
        where: { userId: open.ownerId, deletedAt: null, notebookId: { in: open.notebookIds ?? [] } },
        select: { id: true, title: true, updatedAt: true, notebookId: true, notebook: { select: NOTEBOOK_PATH } },
      }),
    ]);
    const listed = notes.map((note) => ({
      id: note.id,
      title: note.title,
      updatedAt: note.updatedAt,
      notebook: note.notebookId === rootId ? null : pathBelow(note.notebook, rootId),
    }));
    // The notes of the notebook itself first, then each notebook inside it, by title within.
    listed.sort(
      (a, b) =>
        Number(a.notebook !== null) - Number(b.notebook !== null) ||
        (a.notebook ?? '').localeCompare(b.notebook ?? '') ||
        a.title.localeCompare(b.title),
    );
    return { kind: 'notebook', name: notebook.name, notes: listed };
  }

  private async noteFor(
    open: OpenShare,
    token: string,
    where: { id: string; notebookId?: { in: string[] } },
    now: Date,
  ): Promise<SharedNote> {
    const note = await this.prisma.note.findFirst({
      where: { ...where, userId: open.ownerId, deletedAt: null },
      select: NOTE_FIELDS,
    });
    if (!note) {
      throw new NotFoundException(GONE);
    }
    const links = await this.readableLinks(open, token, note.content, now);
    return {
      kind: 'note',
      title: note.title,
      content: unlinkExcept(note.content, (key) => links.has(key)),
      tags: note.tags.map((noteTag) => noteTag.tag.name),
      updatedAt: note.updatedAt,
      links: Object.fromEntries(links),
    };
  }

  /**
   * Which of a note's [[links]] a reader of this link may follow, and where
   * to. A title is looked up among what the reader may open, never among
   * all the owner's notes, so a private note can neither take a link's place
   * nor show that it exists:
   *
   * 1. The notes of the same shared notebook, newest first when several
   *    share the title. The reader stays inside the notebook.
   * 2. Otherwise the notes whose own link is open to anyone: not run out and
   *    without a password. A link to a note behind a password would hand out
   *    its title and its token, enough to use up its password allowance.
   *
   * Every other link becomes the words the author wrote, so a link to a
   * private note, a protected one and one that does not exist look the same.
   */
  private async readableLinks(
    open: OpenShare,
    token: string,
    content: string,
    now: Date,
  ): Promise<Map<string, string>> {
    const keys = [...new Set(extractWikiLinks(content).map((link) => normalizeTitle(link.title)))];
    const paths = new Map<string, string>();
    if (keys.length === 0) return paths;

    if (open.notebookIds) {
      const inNotebook = await this.links.resolveKeys(open.ownerId, keys, { notebookIds: open.notebookIds });
      for (const [key, id] of inNotebook) paths.set(key, `/s/${token}/${id}`);
    }
    const rest = keys.filter((key) => !paths.has(key));
    if (rest.length === 0) return paths;

    const openLinks = await this.prisma.shareLink.findMany({
      where: {
        passwordHash: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        note: { userId: open.ownerId, deletedAt: null },
      },
      select: { noteId: true, token: true },
    });
    const tokenOf = new Map(openLinks.flatMap((link) => (link.noteId ? [[link.noteId, link.token] as const] : [])));
    if (tokenOf.size === 0) return paths;
    const withOwnLink = await this.links.resolveKeys(open.ownerId, rest, { noteIds: [...tokenOf.keys()] });
    for (const [key, id] of withOwnLink) paths.set(key, `/s/${tokenOf.get(id)}`);
    return paths;
  }

  /** undefined leaves a column alone, null empties it. */
  private async changesFrom(
    options: ShareOptionsDto,
  ): Promise<{ expiresAt?: Date | null; passwordHash?: string | null }> {
    const changes: { expiresAt?: Date | null; passwordHash?: string | null } = {};
    if (options.expiresAt !== undefined) {
      const expiresAt = options.expiresAt === null ? null : new Date(options.expiresAt);
      // The first half repeats what the DTO checks. A date that cannot be
      // read is "not a number", which is neither before nor after now.
      if (expiresAt && !(expiresAt.getTime() > Date.now())) {
        throw new BadRequestException('expiresAt must be a date and time in the future');
      }
      changes.expiresAt = expiresAt;
    }
    if (options.password !== undefined) {
      // The same function as for account passwords.
      changes.passwordHash = options.password === null ? null : await hashPassword(options.password);
    }
    return changes;
  }

  /** The note or notebook, if it belongs to the user. `deletedAt` is only ever set for a note. */
  private async findOwned(userId: string, subject: ShareSubject): Promise<{ deletedAt: Date | null }> {
    if ('noteId' in subject) {
      const note = await this.prisma.note.findFirst({
        where: { id: subject.noteId, userId },
        select: { deletedAt: true },
      });
      if (!note) {
        throw new NotFoundException('Note not found');
      }
      return note;
    }
    const notebook = await this.prisma.notebook.findFirst({
      where: { id: subject.notebookId, userId },
      select: { id: true },
    });
    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }
    return { deletedAt: null };
  }
}

function isExpired(share: { expiresAt: Date | null }, now: Date): boolean {
  return share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime();
}

function toShareView(
  share: { token: string; viewCount: number; createdAt: Date; expiresAt: Date | null; passwordHash: string | null },
  now = new Date(),
): ShareView {
  return {
    token: share.token,
    viewCount: share.viewCount,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    expired: isExpired(share, now),
    hasPassword: share.passwordHash !== null,
  };
}

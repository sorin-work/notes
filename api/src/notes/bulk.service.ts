import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessService, Need } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTagName } from '../tags/tag-name';
import { BulkAction, BulkNotesDto } from './dto/bulk.dto';

/** Why a note was left out of a bulk action. */
export type SkipReason = 'not_found' | 'not_allowed' | 'in_trash' | 'too_many_tags' | 'moved_since' | 'notebook_gone';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BulkResult {
  /** The notes the action changed. */
  changed: string[];
  /** The notes that were already as the action would make them. */
  unchanged: string[];
  /** The notes left out, each with why. A note the caller may not see is "not_found", as everywhere. */
  skipped: { id: string; reason: SkipReason }[];
  /** For "move": the notebook each changed note was in before, so the move can be undone. */
  previous?: Record<string, string | null>;
}

/** A note has at most this many tags, as a save allows. */
const MAX_NOTE_TAGS = 20;

/**
 * What a member's role covers, as for a single note (item 17): an editor
 * changes tags, and where a note lives, its pin and the trash stay the
 * owner's.
 */
const NEED: Record<BulkAction, Need> = {
  move: 'owner',
  moveBack: 'owner',
  pin: 'owner',
  unpin: 'owner',
  trash: 'owner',
  addTag: 'edit',
  removeTag: 'edit',
};

@Injectable()
export class BulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /**
   * One action for many notes, in one transaction. The notes are locked in
   * the order of their ids, so two bulk actions over the same notes wait for
   * each other instead of deadlocking, and the caller's memberships with a
   * share lock, as for a single write (AccessService.noteWriteGuard). Access
   * is decided per note inside the transaction, so a mixed selection is
   * carried out in part, and the answer says which notes were left out and
   * why. Nothing here touches title or content, so the revision of a note
   * stays as it was and no save of its text can conflict with this.
   */
  async apply(userId: string, dto: BulkNotesDto): Promise<BulkResult> {
    const ids = [...new Set(dto.ids)];
    const tag = dto.action === 'addTag' || dto.action === 'removeTag' ? normalizeTagName(dto.tag ?? '') : null;
    if ((dto.action === 'addTag' || dto.action === 'removeTag') && !tag) {
      throw new BadRequestException('That is not a tag');
    }
    const target = dto.action === 'move' ? (dto.notebookId ?? null) : null;
    const back = dto.action === 'moveBack' ? (dto.back ?? {}) : {};
    if (dto.action === 'moveBack') {
      const wrong = ids.some((id) => {
        const to = back[id];
        return to === undefined || (to !== null && (typeof to !== 'string' || !UUID.test(to)));
      });
      if (wrong) throw new BadRequestException('back must name a notebook id or null for every note');
    }

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM notes WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT notebook_id FROM notebook_members WHERE user_id = ${userId}::uuid FOR SHARE`;
        // The notebooks cannot go away under the move. One that is gone, or not
        // the caller's, is a 404 for a move and leaves its notes where they are
        // for an undo.
        const wanted = target ? [target] : [...new Set(Object.values(back).filter((to): to is string => to !== null))];
        const there = new Set(
          wanted.length === 0
            ? []
            : (
                await tx.$queryRaw<{ id: string }[]>`
                  SELECT id FROM notebooks WHERE id = ANY(${wanted}::uuid[]) AND user_id = ${userId}::uuid
                  ORDER BY id FOR SHARE`
              ).map((row) => row.id),
        );
        if (target && !there.has(target)) throw new NotFoundException('Notebook not found');

        const granted = await this.access.notes(userId, ids, NEED[dto.action], tx);
        const notes = await tx.note.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            userId: true,
            notebookId: true,
            pinned: true,
            deletedAt: true,
            tags: { select: { tag: { select: { name: true } } } },
          },
        });
        const byId = new Map(notes.map((note) => [note.id, note]));
        const result: BulkResult = { changed: [], unchanged: [], skipped: [] };
        const allowed: NonNullable<ReturnType<typeof byId.get>>[] = [];
        for (const id of ids) {
          const access = granted.get(id);
          const note = byId.get(id);
          if (!note || access === undefined || access === 'missing') {
            result.skipped.push({ id, reason: 'not_found' });
          } else if (access === 'refused') {
            result.skipped.push({ id, reason: 'not_allowed' });
          } else if (note.deletedAt) {
            result.skipped.push({ id, reason: 'in_trash' });
          } else {
            allowed.push(note);
          }
        }

        const now = new Date();
        const change = async (changed: typeof allowed, data: { notebookId?: string | null; pinned?: boolean }) => {
          if (changed.length === 0) return;
          await tx.note.updateMany({ where: { id: { in: changed.map((note) => note.id) } }, data });
        };
        const split = (wanted: (note: (typeof allowed)[number]) => boolean) => {
          const changed = allowed.filter(wanted);
          const ids = new Set(changed.map((note) => note.id));
          result.changed = changed.map((note) => note.id);
          result.unchanged = allowed.filter((note) => !ids.has(note.id)).map((note) => note.id);
          return changed;
        };

        switch (dto.action) {
          case 'move': {
            const moved = split((note) => note.notebookId !== target);
            result.previous = Object.fromEntries(moved.map((note) => [note.id, note.notebookId]));
            // Moving is an edit, as for a single note: it changes updatedAt.
            if (moved.length > 0) {
              await tx.note.updateMany({
                where: { id: { in: moved.map((note) => note.id) } },
                data: { notebookId: target, updatedAt: now },
              });
            }
            break;
          }
          case 'moveBack': {
            const expected = dto.expectedNotebookId ?? null;
            const movable: typeof allowed = [];
            for (const note of allowed) {
              const to = back[note.id] ?? null;
              if (note.notebookId !== expected) result.skipped.push({ id: note.id, reason: 'moved_since' });
              else if (to !== null && !there.has(to)) result.skipped.push({ id: note.id, reason: 'notebook_gone' });
              else movable.push(note);
            }
            result.changed = movable
              .filter((note) => note.notebookId !== (back[note.id] ?? null))
              .map((note) => note.id);
            result.unchanged = movable.filter((note) => !result.changed.includes(note.id)).map((note) => note.id);
            // One statement for each notebook the notes go back to.
            const groups = new Map<string | null, string[]>();
            for (const id of result.changed) {
              const to = back[id] ?? null;
              groups.set(to, [...(groups.get(to) ?? []), id]);
            }
            for (const [notebookId, group] of groups) {
              await tx.note.updateMany({ where: { id: { in: group } }, data: { notebookId, updatedAt: now } });
            }
            break;
          }
          case 'pin':
          case 'unpin': {
            const pinned = dto.action === 'pin';
            // Pinning is no edit, so updatedAt stays.
            await change(
              split((note) => note.pinned !== pinned),
              { pinned },
            );
            break;
          }
          case 'trash': {
            const trashed = split(() => true);
            if (trashed.length > 0) {
              await tx.note.updateMany({
                where: { id: { in: trashed.map((note) => note.id) } },
                data: { deletedAt: now },
              });
            }
            break;
          }
          case 'addTag':
          case 'removeTag': {
            const name = tag as string;
            const has = (note: (typeof allowed)[number]) => note.tags.some((entry) => entry.tag.name === name);
            if (dto.action === 'addTag') {
              // A note already at the most tags a note can have is left out, not changed past it.
              const full = allowed.filter((note) => !has(note) && note.tags.length >= MAX_NOTE_TAGS);
              for (const note of full) result.skipped.push({ id: note.id, reason: 'too_many_tags' });
              const fullIds = new Set(full.map((note) => note.id));
              const tagged = split((note) => !has(note) && !fullIds.has(note.id));
              result.unchanged = result.unchanged.filter((id) => !fullIds.has(id));
              // Tags are the owner's, also when a member adds one.
              for (const ownerId of new Set(tagged.map((note) => note.userId))) {
                const { id: tagId } = await tx.tag.upsert({
                  where: { userId_name: { userId: ownerId, name } },
                  create: { userId: ownerId, name },
                  update: {},
                });
                const mine = tagged.filter((note) => note.userId === ownerId);
                await tx.noteTag.createMany({
                  data: mine.map((note) => ({ noteId: note.id, tagId })),
                  skipDuplicates: true,
                });
              }
            } else {
              const untagged = split(has);
              if (untagged.length > 0) {
                await tx.noteTag.deleteMany({
                  where: { noteId: { in: untagged.map((note) => note.id) }, tag: { name } },
                });
              }
            }
            // A change of tags is an edit, as for a single note.
            if (result.changed.length > 0) {
              await tx.note.updateMany({ where: { id: { in: result.changed } }, data: { updatedAt: now } });
            }
            break;
          }
        }
        return result;
      },
      { timeout: 30_000 },
    );
  }
}

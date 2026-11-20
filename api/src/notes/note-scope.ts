import { Prisma } from '@prisma/client';

/**
 * Which notes are "the notes": not in the trash, and not a template. The
 * lists, the search, the quick switcher, link completion, backlinks and the
 * counts on notebooks and tags all mean these, and they all get the
 * condition from here. A query that spells it out by itself will sooner or
 * later forget half of it.
 *
 * Not everything uses it. A note is still opened, changed and exported by
 * its id whatever it is, a [[link]] still leads to a template that has its
 * title, and the trash lists what is in the trash.
 */
export const WORKING_NOTE = { deletedAt: null, isTemplate: false } as const;

/** The working notes of one user. */
export function workingNotes(userId: string) {
  return { userId, ...WORKING_NOTE } satisfies Prisma.NoteWhereInput;
}

/** The templates of one user, which have a list of their own. */
export function templateNotes(userId: string) {
  return { userId, deletedAt: null, isTemplate: true } satisfies Prisma.NoteWhereInput;
}

/** WORKING_NOTE for raw SQL. `table` is the name or the alias the notes table goes by in the query. */
export function workingNoteSql(table: 'notes' | 'n'): Prisma.Sql {
  const name = Prisma.raw(table);
  return Prisma.sql`${name}.deleted_at IS NULL AND ${name}.is_template = false`;
}

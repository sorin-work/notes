import type { Prisma } from '@prisma/client';

/** How deep notebooks nest. A notebook at the top is level 1, so this allows three levels inside it. */
export const MAX_NOTEBOOK_DEPTH = 4;

/**
 * A notebook of `userId` and every notebook below it, at any depth, the
 * notebook itself first, in one recursive query. Empty when the notebook is
 * not that user's. This is the one place that says what "this notebook and
 * what is inside it" means: for the note list, the search, the graph,
 * deleting, and what a membership of a shared notebook covers.
 */
export async function subtreeOf(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userId: string,
  id: string,
): Promise<string[]> {
  // The level stops the walk if the data should ever hold a loop.
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id, 1 AS level
      FROM notebooks
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
      UNION ALL
      SELECT child.id, tree.level + 1
      FROM notebooks child JOIN tree ON child.parent_id = tree.id
      WHERE child.user_id = ${userId}::uuid AND tree.level < ${MAX_NOTEBOOK_DEPTH * 4}
    )
    SELECT id FROM tree GROUP BY id ORDER BY min(level), id`;
  return rows.map((row) => row.id);
}

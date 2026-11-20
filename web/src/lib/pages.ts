/**
 * Joins the pages of a list that is loaded a page at a time. Pages are cut
 * by position, so an item added or removed between two requests shifts the
 * rest, and the next page can then repeat one. Repeats are dropped.
 */
export function joinPages<T extends { id: string }>(pages: { items: T[] }[] | undefined): T[] {
  const seen = new Set<string>();
  return (pages ?? [])
    .flatMap((page) => page.items)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

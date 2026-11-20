import type { NoteChanges } from '../api/types';

/** Stands for "not in a notebook" wherever a notebook id is expected, in the URL and in the API. */
export const NO_NOTEBOOK = 'none';

/** What narrows the note list, as it is kept in the URL: `?notebook=`, `?tag=` and `?view=`. */
export interface ListFilters {
  /** A notebook id, or NO_NOTEBOOK. */
  notebook: string | null;
  tag: string | null;
  view: 'pinned' | 'favorites' | 'orphans' | null;
}

export function readFilters(params: URLSearchParams): ListFilters {
  const view = params.get('view');
  return {
    // "?view=unfiled" is the older address of "?notebook=none" and still works.
    notebook: params.get('notebook') || (view === 'unfiled' ? NO_NOTEBOOK : null),
    tag: params.get('tag') || null,
    view: view === 'pinned' || view === 'favorites' || view === 'orphans' ? view : null,
  };
}

/** Puts a notebook and a tag into a copy of `params`, leaving everything else as it is. */
export function withFilters(
  params: URLSearchParams,
  { notebook, tag }: Pick<ListFilters, 'notebook' | 'tag'>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (next.get('view') === 'unfiled') next.delete('view');
  for (const [key, value] of [
    ['notebook', notebook],
    ['tag', tag],
  ] as const) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/** What a note created under these filters starts with, so that it shows up in the list being looked at. */
export function newNoteFor(filters: ListFilters): NoteChanges {
  return {
    notebookId: filters.notebook && filters.notebook !== NO_NOTEBOOK ? filters.notebook : null,
    tags: filters.tag ? [filters.tag] : undefined,
    pinned: filters.view === 'pinned' || undefined,
    favorite: filters.view === 'favorites' || undefined,
  };
}

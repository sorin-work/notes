import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { listNotebooks } from '../api/notebooks';
import { search } from '../api/search';
import { listTags } from '../api/tags';
import { FilterSelects } from '../components/FilterSelects';
import { EmptyState, ErrorMessage, Spinner } from '../components/States';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatRelative } from '../lib/dates';
import { readFilters, withFilters } from '../lib/filters';
import { splitHighlights } from '../lib/text';

function Snippet({ text }: { text: string }) {
  return (
    <>
      {splitHighlights(text).map((part, index) =>
        part.highlight ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

/** Drops the hits that an earlier page already had. */
function withoutRepeats<T extends { id: string }>(hits: T[]): T[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.id)) return false;
    seen.add(hit.id);
    return true;
  });
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  // The URL is what gets searched: the words in `q`, narrowed by `notebook` and `tag`.
  const q = params.get('q') ?? '';
  const { notebook, tag } = readFilters(params);
  const [input, setInput] = useState(q);
  const [seenQuery, setSeenQuery] = useState(q);
  const typed = useDebouncedValue(input.trim(), 250);

  // A query in the URL that was not typed here came from outside, for
  // example from the search box in the sidebar: show it in the box.
  if (q !== seenQuery) {
    setSeenQuery(q);
    if (q !== typed) setInput(q);
  }

  // Typing reaches the URL a moment after the last key. Until `typed` has
  // caught up with the box it is an older text and must not be written back.
  useEffect(() => {
    if (typed !== input.trim() || typed === q) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (typed) next.set('q', typed);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [typed, input, q, setParams]);

  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  // The key sits under 'notes', so whatever creates, changes, trashes or
  // restores a note and refreshes the note lists refreshes the results too.
  const results = useInfiniteQuery({
    queryKey: ['notes', 'search', q, notebook, tag],
    queryFn: ({ pageParam }) => search(q, { notebookId: notebook, tag, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: q.length > 0,
  });
  // Pages are cut by position. A note that was added or removed between two
  // requests shifts the rest, and the next page can then repeat a hit.
  const hits = withoutRepeats(results.data?.pages.flatMap((page) => page.items) ?? []);
  const total = results.data?.pages[0]?.total ?? 0;
  const filtered = notebook !== null || tag !== null;

  return (
    <div className="page search-page">
      <h1>Search</h1>
      <input
        type="search"
        className="search-big"
        aria-label="Search all notes"
        placeholder="Search titles and text…"
        value={input}
        autoFocus
        onChange={(event) => setInput(event.target.value)}
      />
      <FilterSelects
        notebooks={notebooks.data ?? []}
        tags={tags.data ?? []}
        notebook={notebook}
        tag={tag}
        onChange={(next) => setParams((current) => withFilters(current, next), { replace: true })}
      />
      {results.isFetching && !results.isFetchingNextPage && <Spinner label="Searching…" />}
      {results.error && <ErrorMessage error={results.error} />}
      {results.data && (
        <p className="muted">
          {total === 0
            ? `Nothing matches “${q}”${filtered ? ' with these filters' : ''}.`
            : `${total} ${total === 1 ? 'note matches' : 'notes match'}`}
        </p>
      )}
      {!q && (
        <EmptyState title={filtered ? 'Search these notes' : 'Search every note'}>
          <p className="muted">
            Words match the start of words, so “meet” finds “meeting”. Put words in "double quotes" to find them next to
            each other. Notes in the trash are left out.
          </p>
        </EmptyState>
      )}
      <ul className="search-results">
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link to={`/notes/${hit.id}`} className="search-hit">
              <span className="search-hit-title">{hit.title}</span>
              <span className="muted"> · {formatRelative(hit.updatedAt)}</span>
              <p className="search-hit-snippet">
                <Snippet text={hit.snippet} />
              </p>
              {hit.tags.length > 0 && (
                <div className="note-item-meta">
                  {hit.tags.map((tag) => (
                    <span key={tag} className="tag-pill">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {results.hasNextPage && (
        <button
          type="button"
          className="button load-more"
          onClick={() => void results.fetchNextPage()}
          disabled={results.isFetchingNextPage}
        >
          {results.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

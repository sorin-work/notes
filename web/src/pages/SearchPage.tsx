import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { search } from '../api/search';
import { EmptyState, ErrorMessage, Spinner } from '../components/States';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatRelative } from '../lib/dates';
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

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(input.trim(), 250);

  useEffect(() => {
    setParams(q ? { q } : {}, { replace: true });
  }, [q, setParams]);

  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => search(q),
    enabled: q.length > 0,
  });

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
      {results.isFetching && <Spinner label="Searching…" />}
      {results.error && <ErrorMessage error={results.error} />}
      {results.data && (
        <p className="muted">
          {results.data.total === 0
            ? `Nothing matches “${q}”.`
            : `${results.data.total} ${results.data.total === 1 ? 'note matches' : 'notes match'}`}
        </p>
      )}
      {!q && (
        <EmptyState title="Search every note">
          <p className="muted">
            Words match the start of words, so “meet” finds “meeting”. Notes in the trash are left out.
          </p>
        </EmptyState>
      )}
      <ul className="search-results">
        {results.data?.items.map((hit) => (
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
    </div>
  );
}

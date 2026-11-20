import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { linkMention, mentions } from '../api/notes';
import { formatRelative } from '../lib/dates';
import { joinPages } from '../lib/pages';
import { ErrorMessage } from './States';

const PAGE_SIZE = 10;

/**
 * The notes that write this note's title without linking to it, each with a
 * button that puts [[ ]] around the mention. Shows nothing when there are none.
 */
export function UnlinkedMentions({ noteId }: { noteId: string }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  // The key sits under 'backlinks': the editor refreshes those after every
  // save, and a new title or a new link changes this list just the same.
  const found = useInfiniteQuery({
    queryKey: ['backlinks', noteId, 'mentions'],
    queryFn: ({ pageParam }) => mentions(noteId, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });

  const link = useMutation({
    mutationFn: (sourceId: string) => linkMention(noteId, sourceId),
    // Also after a refusal: the other note has changed since it was listed.
    onSettled: (_result, _error, sourceId) => {
      // This note has a backlink more and a mention less. The other one has
      // new text, a new link and its old text in the history.
      for (const key of [['backlinks'], ['notes'], ['note', sourceId], ['links', sourceId], ['versions', sourceId]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  const items = joinPages(found.data?.pages);
  const first = found.data?.pages[0];
  if (items.length === 0 && !link.error) return null;

  return (
    <section className="backlinks" aria-labelledby="mentions-heading">
      <h2 id="mentions-heading">
        Unlinked mentions
        <span className="count">{first?.total ?? 0}</span>
      </h2>
      <ul>
        {items.map((mention) => (
          <li key={mention.id}>
            <div className="mention-header">
              <span>
                <Link to={{ pathname: `/notes/${mention.id}`, search: location.search }} className="backlink-title">
                  {mention.title}
                </Link>
                <span className="muted"> · {formatRelative(mention.updatedAt)}</span>
              </span>
              <button
                type="button"
                className="button"
                title="Put [[ ]] around the mention in that note"
                aria-label={`Link the mention in ${mention.title}`}
                disabled={link.isPending}
                onClick={() => link.mutate(mention.id)}
              >
                Link
              </button>
            </div>
            {mention.context && <p className="backlink-context">{mention.context}</p>}
          </li>
        ))}
      </ul>
      {found.hasNextPage && (
        <button
          type="button"
          className="button load-more"
          onClick={() => void found.fetchNextPage()}
          disabled={found.isFetchingNextPage}
        >
          {found.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
      {first?.capped && (
        <p className="muted">There may be more: only the notes edited last that match were looked at.</p>
      )}
      {link.error && <ErrorMessage error={link.error} />}
    </section>
  );
}

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { linkMention, mentions } from '../api/notes';
import type { Mention } from '../api/types';
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
  // The key is not under 'backlinks', which every save refreshes: reading
  // the mentions costs the server more. The editor refreshes it when the
  // title changes, and "Link" does.
  const found = useInfiniteQuery({
    queryKey: ['mentions', noteId],
    queryFn: ({ pageParam }) => mentions(noteId, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });

  const link = useMutation({
    mutationFn: (mention: Mention) => linkMention(noteId, mention),
    // Also after a refusal: the other note has changed since it was listed, and the list has to be asked for again.
    onSettled: (_result, _error, mention) => {
      // The other note has new text. Its copy here is thrown away, not just
      // marked old: the editor starts from the copy it finds. A save from the
      // old copy would be refused for its revision, but it should not come
      // to that.
      queryClient.removeQueries({ queryKey: ['note', mention.id] });
      // This note has a backlink more and a mention less. The other one has a new link and its old text in the history.
      for (const key of [['mentions'], ['backlinks'], ['notes'], ['links', mention.id], ['versions', mention.id]]) {
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
                onClick={() => link.mutate(mention)}
              >
                Link
              </button>
            </div>
            <p className="backlink-context">
              {mention.before}
              <mark>{mention.match}</mark>
              {mention.after}
            </p>
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

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { listNotebooks } from '../api/notebooks';
import { createNote, listNotes, NoteFilters, NoteSort } from '../api/notes';
import { NoteEditor } from '../components/NoteEditor';
import { NoteList } from '../components/NoteList';
import { EmptyState, ErrorMessage, Spinner } from '../components/States';
import { useStoredState } from '../hooks/useStoredState';
import { notebookLabel } from '../lib/notebooks';

const SORTS = ['updated', 'created', 'title'] as const;
const PAGE_SIZE = 50;

export function NotesPage() {
  const { noteId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sort, setSort] = useStoredState<NoteSort>('notes.sort', SORTS, 'updated');

  const view = params.get('view') ?? 'all';
  const notebookId = params.get('notebook');
  const tag = params.get('tag');
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });

  const filters: NoteFilters = { sort, pageSize: PAGE_SIZE };
  let heading = 'All notes';
  if (notebookId) {
    filters.notebookId = notebookId;
    heading = notebookLabel(notebooks.data ?? [], notebookId) ?? 'Notebook';
  } else if (tag) {
    filters.tag = tag;
    heading = `#${tag}`;
  } else if (view === 'pinned') {
    filters.pinned = true;
    heading = 'Pinned';
  } else if (view === 'favorites') {
    filters.favorite = true;
    heading = 'Favourites';
  } else if (view === 'unfiled') {
    filters.notebookId = 'none';
    heading = 'Not in a notebook';
  }

  const notes = useInfiniteQuery({
    queryKey: ['notes', filters],
    queryFn: ({ pageParam }) => listNotes({ ...filters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const total = notes.data?.pages[0]?.total ?? 0;

  const newNote = useMutation({
    mutationFn: () =>
      createNote({
        notebookId: notebookId ?? null,
        tags: tag ? [tag] : undefined,
        pinned: view === 'pinned' || undefined,
        favorite: view === 'favorites' || undefined,
      }),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
      navigate({ pathname: `/notes/${note.id}`, search: params.toString() });
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newNote.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newNote]);

  return (
    <div className={noteId ? 'notes-page has-note' : 'notes-page'}>
      <section className="list-pane" aria-label="Notes">
        <header className="list-header">
          <div>
            <h1>{heading}</h1>
            <span className="muted">{notes.isSuccess && `${total} ${total === 1 ? 'note' : 'notes'}`}</span>
          </div>
          <select aria-label="Sort notes" value={sort} onChange={(event) => setSort(event.target.value as NoteSort)}>
            <option value="updated">Last edited</option>
            <option value="created">Created</option>
            <option value="title">Title</option>
          </select>
        </header>
        <div className="list-scroll">
          {notes.isLoading && <Spinner />}
          {notes.error && <ErrorMessage error={notes.error} onRetry={() => void notes.refetch()} />}
          {notes.isSuccess && items.length === 0 && (
            <EmptyState title="No notes here yet">
              <button type="button" className="button button-primary" onClick={() => newNote.mutate()}>
                Create a note
              </button>
            </EmptyState>
          )}
          <NoteList notes={items} activeId={noteId} />
          {notes.hasNextPage && (
            <button
              type="button"
              className="button load-more"
              onClick={() => void notes.fetchNextPage()}
              disabled={notes.isFetchingNextPage}
            >
              {notes.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </section>

      <section className="editor-pane">
        {noteId ? (
          <NoteEditor key={noteId} noteId={noteId} />
        ) : (
          <EmptyState title="Pick a note, or start a new one">
            <p className="muted">
              Alt+N creates a note, / jumps to search, Ctrl+S saves and Ctrl+E switches between edit and preview.
            </p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

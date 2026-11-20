import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { listNotebooks } from '../api/notebooks';
import { createNote, listNotes, NoteFilters, NoteSort } from '../api/notes';
import { listTags } from '../api/tags';
import { FilterSelects } from '../components/FilterSelects';
import { NoteEditor } from '../components/NoteEditor';
import { NoteList } from '../components/NoteList';
import { EmptyState, ErrorMessage, Spinner } from '../components/States';
import { useStoredState } from '../hooks/useStoredState';
import { newNoteFor, NO_NOTEBOOK, readFilters, withFilters } from '../lib/filters';
import { notebookLabel } from '../lib/notebooks';

const SORTS = ['updated', 'created', 'title'] as const;
const PAGE_SIZE = 50;

export function NotesPage() {
  const { noteId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sort, setSort] = useStoredState<NoteSort>('notes.sort', SORTS, 'updated');

  const shown = readFilters(params);
  const { notebook, tag, view } = shown;
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });

  // A view, a notebook and a tag narrow the list together.
  const filters: NoteFilters = { sort, pageSize: PAGE_SIZE };
  const names: string[] = [];
  if (view === 'pinned') {
    filters.pinned = true;
    names.push('Pinned');
  } else if (view === 'favorites') {
    filters.favorite = true;
    names.push('Favourites');
  }
  if (notebook) {
    filters.notebookId = notebook;
    names.push(
      notebook === NO_NOTEBOOK ? 'Not in a notebook' : (notebookLabel(notebooks.data ?? [], notebook) ?? 'Notebook'),
    );
  }
  if (tag) {
    filters.tag = tag;
    names.push(`#${tag}`);
  }
  const heading = names.join(' · ') || 'All notes';

  const notes = useInfiniteQuery({
    queryKey: ['notes', filters],
    queryFn: ({ pageParam }) => listNotes({ ...filters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const total = notes.data?.pages[0]?.total ?? 0;

  const newNote = useMutation({
    mutationFn: () => createNote(newNoteFor(shown)),
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
        <FilterSelects
          notebooks={notebooks.data ?? []}
          tags={tags.data ?? []}
          notebook={notebook}
          tag={tag}
          onChange={(next) => setParams((current) => withFilters(current, next))}
        />
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

      <section className="editor-pane" id="note" tabIndex={-1}>
        {noteId ? (
          <>
            <Link to={{ pathname: '/notes', search: params.toString() }} className="back-link">
              ← {heading}
            </Link>
            <NoteEditor key={noteId} noteId={noteId} />
          </>
        ) : (
          <EmptyState title="Pick a note, or start a new one">
            <p className="muted">
              Alt+N creates a note, Ctrl+K (Cmd+K on a Mac) opens a note by its title, / jumps to search, Ctrl+S saves
              and Ctrl+E switches between edit and preview.
            </p>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

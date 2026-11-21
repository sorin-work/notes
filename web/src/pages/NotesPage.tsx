import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { listNotebooks } from '../api/notebooks';
import { createNote, listNotes, NoteFilters, NoteSort } from '../api/notes';
import { listTags } from '../api/tags';
import { FilterSelects } from '../components/FilterSelects';
import { NoteEditor } from '../components/NoteEditor';
import { NoteList } from '../components/NoteList';
import { SelectionBar } from '../components/SelectionBar';
import { EmptyState, ErrorMessage, NeedsConnection, Spinner } from '../components/States';
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
  } else if (view === 'orphans') {
    filters.orphans = true;
    names.push('Orphans');
  } else if (view === 'templates') {
    filters.templates = true;
    names.push('Templates');
  }
  const [one, many] = view === 'templates' ? ['template', 'templates'] : ['note', 'notes'];
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

  // "Select" turns a click on a box, and Space, into choosing notes. A click on a note still opens it.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Where a range starts, and what was selected before it: a range is drawn
  // again from these on every step, so Shift with the other arrow shrinks it.
  const [range, setRange] = useState<{ anchor: string; base: ReadonlySet<string> } | null>(null);
  // Only notes in the list are selected: a note that left it, by a filter or an action, drops out.
  const inList = items.filter((note) => selected.has(note.id));
  const inListIds = new Set(inList.map((note) => note.id));
  const toggle = (id: string, extend: boolean, from?: string) => {
    if (!extend) {
      const next = new Set(inListIds);
      if (!next.delete(id)) next.add(id);
      setSelected(next);
      setRange({ anchor: id, base: next });
      return;
    }
    // Shift with no range yet starts one at the note the focus came from, or at this one.
    const start =
      range && items.some((note) => note.id === range.anchor) ? range : { anchor: from ?? id, base: inListIds };
    const a = items.findIndex((note) => note.id === start.anchor);
    const b = items.findIndex((note) => note.id === id);
    if (a === -1 || b === -1) return;
    const [low, high] = a < b ? [a, b] : [b, a];
    setSelected(new Set([...start.base, ...items.slice(low, high + 1).map((note) => note.id)]));
    setRange(start);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    setRange(null);
  };
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
            <span className="muted">{notes.isSuccess && `${total} ${total === 1 ? one : many}`}</span>
          </div>
          <button
            type="button"
            className={selecting ? 'button button-shared' : 'button'}
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            Select
          </button>
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
        {selecting && (
          <SelectionBar
            selected={inList.map((note) => ({ id: note.id, notebookId: note.notebookId }))}
            loaded={items.length}
            notebooks={notebooks.data ?? []}
            onSelectAll={() => setSelected(new Set(items.map((note) => note.id)))}
            onClear={() => {
              setSelected(new Set());
              setRange(null);
            }}
          />
        )}
        <div className="list-scroll">
          {notes.isPending && notes.fetchStatus === 'paused' && (
            <NeedsConnection>This list has not been loaded on this device, so it needs a connection.</NeedsConnection>
          )}
          {notes.isLoading && <Spinner />}
          {notes.error && <ErrorMessage error={notes.error} onRetry={() => void notes.refetch()} />}
          {notes.isSuccess && items.length === 0 && (
            <EmptyState title={`No ${many} here yet`}>
              {view === 'templates' && (
                <p className="muted">
                  A template is a note that new notes start from. Any note becomes one with “Template” in its toolbar.
                </p>
              )}
              <button type="button" className="button button-primary" onClick={() => newNote.mutate()}>
                Create a {one}
              </button>
            </EmptyState>
          )}
          <NoteList
            notes={items}
            activeId={noteId}
            selection={selecting ? { selected: inListIds, onToggle: toggle } : undefined}
          />
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { listNotebooks } from '../api/notebooks';
import { listTags } from '../api/tags';
import { listTasks, TaskNote, tickTask } from '../api/tasks';
import { FilterSelects } from '../components/FilterSelects';
import { EmptyState, ErrorMessage, Spinner } from '../components/States';
import { formatRelative } from '../lib/dates';
import { localDay } from '../lib/days';
import { readFilters, withFilters } from '../lib/filters';
import { dueDay } from '../lib/tasks';

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Every unticked task box in the notes, grouped by note, the note edited last first. */
export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { notebook, tag } = readFilters(params);
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  // Under 'notes', so that whatever changes a note and refreshes the note lists refreshes this too.
  const list = useQuery({
    queryKey: ['notes', 'tasks', notebook, tag],
    queryFn: () => listTasks({ notebookId: notebook, tag }),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const tick = useMutation({
    mutationFn: ({ note, line }: { note: TaskNote; line: number }) =>
      tickTask(note.id, { line, checked: false, revision: note.revision }),
    onMutate: () => setProblem(null),
    onSuccess: (saved) => {
      queryClient.setQueryData(['note', saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ['versions', saved.id] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setProblem('That note changed since this list was made, so nothing was ticked. The list is up to date now.');
      } else {
        setProblem(error instanceof Error ? error.message : 'The task could not be ticked.');
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['notes'] }),
  });
  const data = list.data;
  const today = localDay();
  const ticking = (note: TaskNote, line: number) =>
    tick.isPending && tick.variables.note.id === note.id && tick.variables.line === line;

  return (
    <div className="page tasks-page">
      <h1>Tasks</h1>
      <p className="muted">
        Every task box that is not ticked yet, from all notes, the note edited last first. Write{' '}
        <code>due:2026-11-30</code> after a task to give it a day.
      </p>
      <FilterSelects
        notebooks={notebooks.data ?? []}
        tags={tags.data ?? []}
        notebook={notebook}
        tag={tag}
        onChange={(next) => setParams((current) => withFilters(current, next), { replace: true })}
      />
      {list.isLoading && <Spinner />}
      {list.error && <ErrorMessage error={list.error} onRetry={() => void list.refetch()} />}
      {problem && (
        <p className="banner" role="alert">
          {problem}
        </p>
      )}
      {data && (data.unreadable > 0 || data.unread > 0 || data.capped) && (
        <div className="banner banner-info" role="status">
          {data.unreadable > 0 && (
            <span>
              {count(data.unreadable, 'note is', 'notes are')} too long or too intricate to read for tasks, so their
              tasks are not listed.
            </span>
          )}
          {data.unread > 0 && (
            <>
              <span>{count(data.unread, 'note has', 'notes have')} not been read for tasks yet.</span>
              <button type="button" className="button" onClick={() => void list.refetch()}>
                Read on
              </button>
            </>
          )}
          {data.capped && (
            <span>
              Only the {data.notes.length.toLocaleString()} notes edited last are listed. Pick a notebook or a tag to
              see the others.
            </span>
          )}
        </div>
      )}
      {data && data.notes.length === 0 && <EmptyState title="No open tasks" />}
      {data &&
        data.notes.map((note) => (
          <section key={note.id} className="task-group" aria-labelledby={`tasks-of-${note.id}`}>
            <h2 id={`tasks-of-${note.id}`}>
              <Link to={`/notes/${note.id}`}>{note.title}</Link>
            </h2>
            <p className="muted task-meta">
              {note.notebook ? `${note.notebook.name} · ` : ''}edited {formatRelative(note.updatedAt)}
            </p>
            <ul className="task-list">
              {note.tasks.map((task) => {
                const due = dueDay(task.text);
                const late = due !== null && due < today;
                return (
                  <li key={task.line}>
                    <input
                      type="checkbox"
                      checked={ticking(note, task.line)}
                      disabled={!data.canTick || tick.isPending}
                      aria-label={task.text || 'Task'}
                      onChange={() => tick.mutate({ note, line: task.line })}
                    />
                    <Link to={`/notes/${note.id}`} state={{ line: task.line }}>
                      {task.text || <span className="muted">(no words)</span>}
                    </Link>
                    {due && (
                      <span className={late ? 'task-due task-late' : 'task-due'}>
                        {late ? `late, due ${due}` : `due ${due}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}

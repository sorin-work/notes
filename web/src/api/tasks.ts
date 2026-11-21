import { api, json, withQuery } from './client';
import type { Note } from './types';

/** A note with open tasks, as the Tasks page shows it. */
export interface TaskNote {
  id: string;
  title: string;
  updatedAt: string;
  notebook: { id: string; name: string } | null;
  /** The revision the tasks were read from. Ticking a box sends it back. */
  revision: number;
  tasks: { line: number; text: string }[];
}

export interface TaskList {
  notes: TaskNote[];
  /** Notes too long or too intricate for the parser, whose tasks are not listed. */
  unreadable: number;
  /** Notes not read yet in this request. Asking again reads on. */
  unread: number;
  /** More notes have open tasks than are listed. */
  capped: boolean;
  /** False for a notebook shared with this account to read. */
  canTick: boolean;
}

export const listTasks = (filters: { notebookId?: string | null; tag?: string | null } = {}) =>
  api<TaskList>(withQuery('/tasks', { ...filters }));

/** Ticks or unticks the box on `line`, only while the note is at `revision` and the box shows `checked`. */
export const tickTask = (noteId: string, task: { line: number; checked: boolean; revision: number }) =>
  api<Note>(`/notes/${noteId}/tasks`, json('POST', task));

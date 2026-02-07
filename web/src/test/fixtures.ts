import type { Note, NoteSummary, Notebook } from '../api/types';

export const user = { id: 'u1', email: 'demo@example.com', name: 'Demo User', createdAt: '2026-01-01T00:00:00Z' };

export function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Project Atlas',
    content: 'Links to [[Atlas data model]].',
    notebookId: null,
    notebook: null,
    tags: ['atlas'],
    pinned: false,
    favorite: false,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

export function summary(overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id: 'n1',
    title: 'Project Atlas',
    excerpt: 'Self-service reporting',
    notebookId: null,
    tags: [],
    pinned: false,
    favorite: false,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    ...overrides,
  };
}

export function notebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    id: 'nb1',
    name: 'Work',
    parentId: null,
    noteCount: 0,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    ...overrides,
  };
}

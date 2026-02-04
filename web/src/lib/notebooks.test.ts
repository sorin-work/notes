import { describe, expect, it } from 'vitest';
import type { Notebook } from '../api/types';
import { notebookLabel, notebookTree, totalNotes } from './notebooks';

function nb(id: string, name: string, parentId: string | null = null, noteCount = 0): Notebook {
  return { id, name, parentId, noteCount, createdAt: '', updatedAt: '' };
}

const notebooks = [
  nb('p', 'personal', null, 1),
  nb('w', 'Work', null, 2),
  nb('m', 'Meetings', 'w', 3),
  nb('a', 'atlas', 'w', 4),
];

describe('notebookTree', () => {
  it('nests children under their parents, sorted by name ignoring case', () => {
    const tree = notebookTree(notebooks);
    expect(tree.map((node) => node.name)).toEqual(['personal', 'Work']);
    expect(tree[1]?.children.map((child) => child.name)).toEqual(['atlas', 'Meetings']);
  });

  it('counts notes including nested notebooks', () => {
    expect(totalNotes(notebookTree(notebooks)[1]!)).toBe(9);
  });
});

describe('notebookLabel', () => {
  it('includes the parent name', () => {
    expect(notebookLabel(notebooks, 'm')).toBe('Work / Meetings');
    expect(notebookLabel(notebooks, 'w')).toBe('Work');
    expect(notebookLabel(notebooks, 'x')).toBeNull();
  });
});

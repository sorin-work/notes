import { describe, expect, it } from 'vitest';
import type { Notebook } from '../api/types';
import { notebookLabel, notebookTree, totalNotes, trashedWith } from './notebooks';

function nb(id: string, name: string, parentId: string | null = null, noteCount = 0, templateCount = 0): Notebook {
  return {
    id,
    name,
    parentId,
    noteCount,
    templateCount,
    shared: false,
    sharedThrough: null,
    createdAt: '',
    updatedAt: '',
  };
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

describe('trashedWith', () => {
  it('counts the notes and the templates of the notebook and those inside it', () => {
    const withTemplates = [...notebooks, nb('t', 'Forms', 'w', 0, 1), nb('o', 'Only templates', null, 0, 2)];
    expect(trashedWith(withTemplates, 'w')).toBe(
      '9 notes and 1 template move to the trash, where you can restore them for 30 days.',
    );
    expect(trashedWith(withTemplates, 'o')).toBe(
      '2 templates move to the trash, where you can restore them for 30 days.',
    );
    expect(trashedWith(withTemplates, 'p')).toBe('1 note moves to the trash, where you can restore it for 30 days.');
    expect(trashedWith([nb('e', 'Empty')], 'e')).toBe('There are no notes in it.');
  });
});

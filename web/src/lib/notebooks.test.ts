import { describe, expect, it } from 'vitest';
import type { Notebook } from '../api/types';
import {
  flattenTree,
  heightOf,
  isInside,
  MAX_NOTEBOOK_DEPTH,
  notebookLabel,
  notebookTree,
  possibleParents,
  totalNotes,
  trashedWith,
} from './notebooks';

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
  nb('k', 'Weekly', 'm', 5),
  nb('q', 'Q1', 'k', 6),
];
const names = (nodes: { name: string }[]) => nodes.map((node) => node.name);

describe('notebookTree', () => {
  it('nests notebooks as deep as they go, sorted by name ignoring case', () => {
    const tree = notebookTree(notebooks);
    expect(names(tree)).toEqual(['personal', 'Work']);
    expect(names(tree[1]?.children ?? [])).toEqual(['atlas', 'Meetings']);
    const meetings = tree[1]?.children[1];
    expect(names(meetings?.children ?? [])).toEqual(['Weekly']);
    expect(meetings?.children[0]?.children[0]).toMatchObject({ name: 'Q1', depth: 4, children: [] });
  });

  it('lists a tree in the order it is shown', () => {
    const flat = flattenTree(notebookTree(notebooks));
    expect(names(flat)).toEqual(['personal', 'Work', 'atlas', 'Meetings', 'Weekly', 'Q1']);
    expect(flat.map((node) => node.depth)).toEqual([1, 1, 2, 2, 3, 4]);
  });

  it('counts notes including every notebook inside', () => {
    const work = notebookTree(notebooks)[1];
    expect(work && totalNotes(work)).toBe(20);
    expect(work && heightOf(work)).toBe(4);
  });

  it('shows a notebook at the top when its parent is not in the list, and ends on a loop', () => {
    expect(names(notebookTree([nb('x', 'Lost', 'gone')]))).toEqual(['Lost']);
    expect(notebookTree([nb('x', 'X', 'y'), nb('y', 'Y', 'x')])).toEqual([]);
  });
});

describe('notebookLabel', () => {
  it('names every notebook on the way', () => {
    expect(notebookLabel(notebooks, 'q')).toBe('Work / Meetings / Weekly / Q1');
    expect(notebookLabel(notebooks, 'm')).toBe('Work / Meetings');
    expect(notebookLabel(notebooks, 'w')).toBe('Work');
    expect(notebookLabel(notebooks, 'x')).toBeNull();
  });
});

describe('isInside', () => {
  it('knows whether a notebook is another one or inside it', () => {
    expect(isInside(notebooks, 'q', 'w')).toBe(true);
    expect(isInside(notebooks, 'w', 'w')).toBe(true);
    expect(isInside(notebooks, 'w', 'q')).toBe(false);
    expect(isInside(notebooks, null, 'w')).toBe(false);
  });
});

describe('possibleParents', () => {
  it('offers every notebook that still has room for a new one', () => {
    expect(MAX_NOTEBOOK_DEPTH).toBe(4);
    // Q1 is at the last level, so nothing goes inside it.
    expect(names(possibleParents(notebooks, null))).toEqual(['personal', 'Work', 'atlas', 'Meetings', 'Weekly']);
  });

  it('leaves out the notebook itself, what is inside it, and places that are too deep for it', () => {
    const meetings = notebooks[2] as Notebook;
    // Meetings takes up three levels: it only fits at the top or inside a top-level notebook.
    expect(names(possibleParents(notebooks, meetings))).toEqual(['personal', 'Work']);
    const q1 = notebooks[5] as Notebook;
    expect(names(possibleParents(notebooks, q1))).toEqual(['personal', 'Work', 'atlas', 'Meetings', 'Weekly']);
    const work = notebooks[1] as Notebook;
    expect(possibleParents(notebooks, work)).toEqual([]);
  });
});

describe('trashedWith', () => {
  it('counts the notes and the templates of the notebook and those inside it, at any depth', () => {
    const withTemplates = [...notebooks, nb('t', 'Forms', 'w', 0, 1), nb('o', 'Only templates', null, 0, 2)];
    expect(trashedWith(withTemplates, 'w')).toBe(
      '20 notes and 1 template move to the trash, where you can restore them for 30 days.',
    );
    // Meetings, Weekly inside it and Q1 inside that.
    expect(trashedWith(withTemplates, 'm')).toBe('14 notes move to the trash, where you can restore them for 30 days.');
    expect(trashedWith(withTemplates, 'o')).toBe(
      '2 templates move to the trash, where you can restore them for 30 days.',
    );
    expect(trashedWith(withTemplates, 'p')).toBe('1 note moves to the trash, where you can restore it for 30 days.');
    expect(trashedWith([nb('e', 'Empty')], 'e')).toBe('There are no notes in it.');
  });
});

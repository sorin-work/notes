import { describe, expect, it } from 'vitest';
import { leavingTemplates, newNoteFor, readFilters, withFilters } from './filters';

const read = (search: string) => readFilters(new URLSearchParams(search));

describe('readFilters', () => {
  it('reads a notebook, a tag and a view together', () => {
    expect(read('notebook=w&tag=atlas&view=pinned')).toEqual({ notebook: 'w', tag: 'atlas', view: 'pinned' });
    expect(read('')).toEqual({ notebook: null, tag: null, view: null });
  });

  it('still understands the old address of the notes without a notebook', () => {
    expect(read('view=unfiled&tag=atlas')).toEqual({ notebook: 'none', tag: 'atlas', view: null });
  });
});

describe('withFilters', () => {
  it('changes the notebook and the tag and keeps the rest', () => {
    const next = withFilters(new URLSearchParams('q=atlas&view=pinned&tag=old'), { notebook: 'w', tag: null });
    expect(next.toString()).toBe('q=atlas&view=pinned&notebook=w');
  });

  it('drops the old address once a notebook is chosen', () => {
    expect(withFilters(new URLSearchParams('view=unfiled'), { notebook: null, tag: 'atlas' }).toString()).toBe(
      'tag=atlas',
    );
  });
});

describe('newNoteFor', () => {
  it('starts a note with everything the list is filtered on', () => {
    expect(newNoteFor(read('notebook=w&tag=atlas&view=favorites'))).toEqual({
      notebookId: 'w',
      tags: ['atlas'],
      favorite: true,
    });
  });

  it('leaves the notebook empty for the notes without one', () => {
    expect(newNoteFor(read('notebook=none'))).toEqual({ notebookId: null });
  });
});

describe('the templates view', () => {
  it('is a view of its own, and a note created in it is a template', () => {
    const filters = readFilters(new URLSearchParams('view=templates&notebook=nb'));
    expect(filters).toEqual({ notebook: 'nb', tag: null, view: 'templates' });
    expect(newNoteFor(filters)).toMatchObject({ notebookId: 'nb', isTemplate: true });
    expect(newNoteFor(readFilters(new URLSearchParams('notebook=nb'))).isTemplate).toBeUndefined();
  });

  it('is left behind for a note that is no template', () => {
    expect(leavingTemplates('?view=templates&notebook=nb')).toBe('notebook=nb');
    expect(leavingTemplates('?view=pinned&tag=x')).toBe('view=pinned&tag=x');
    expect(leavingTemplates('')).toBe('');
  });
});

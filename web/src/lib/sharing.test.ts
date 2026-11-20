import { describe, expect, it } from 'vitest';
import type { Notebook } from '../api/types';
import { newlyPublicThrough } from './sharing';

const recipes = { id: 'recipes', name: 'Recipes' };
const notebook = (id: string, sharedThrough: Notebook['sharedThrough']): Notebook => ({
  id,
  name: id,
  parentId: null,
  noteCount: 0,
  templateCount: 0,
  shared: false,
  sharedThrough,
  createdAt: '',
  updatedAt: '',
});
const notebooks = [notebook('recipes', recipes), notebook('bread', recipes), notebook('work', null)];

describe('newlyPublicThrough', () => {
  it('names the shared notebook a move into a covered notebook makes something public through', () => {
    expect(newlyPublicThrough(notebooks, 'bread', null)).toEqual(recipes);
  });

  it('says nothing for a move that makes nothing newly public', () => {
    expect(newlyPublicThrough(notebooks, 'work', null)).toBeNull();
    expect(newlyPublicThrough(notebooks, null, recipes)).toBeNull();
    // From one notebook under the same link to another.
    expect(newlyPublicThrough(notebooks, 'bread', recipes)).toBeNull();
    expect(newlyPublicThrough(notebooks, 'gone', null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { dropStash, dropStashes, readStash, stashDraft } from './draftStash';

const draft = { title: 'Plan', content: 'Typed offline.', revision: 4 };

describe('draft stash', () => {
  it('keeps a draft under its user and its note, and gives it back to that user only', () => {
    stashDraft('ada', 'n1', draft, new Date('2026-11-20T19:42:00Z'));
    expect(readStash('ada', 'n1')).toEqual({ ...draft, at: '2026-11-20T19:42:00.000Z' });
    expect(readStash('ada', 'n2')).toBeNull();
    expect(readStash('bob', 'n1')).toBeNull();
  });

  it('drops one draft, or all drafts of one user, and leaves the others alone', () => {
    stashDraft('ada', 'n1', draft);
    stashDraft('ada', 'n2', draft);
    stashDraft('bob', 'n1', draft);
    dropStash('ada', 'n1');
    expect(readStash('ada', 'n1')).toBeNull();
    expect(readStash('ada', 'n2')).not.toBeNull();

    dropStashes('ada');
    expect(readStash('ada', 'n2')).toBeNull();
    expect(readStash('bob', 'n1')).not.toBeNull();
  });

  it('takes anything it cannot read for no draft at all', () => {
    sessionStorage.setItem('notes.draft.ada.n1', '{"title": "Plan"');
    expect(readStash('ada', 'n1')).toBeNull();
    sessionStorage.setItem('notes.draft.ada.n1', JSON.stringify({ title: 'Plan', content: 5 }));
    expect(readStash('ada', 'n1')).toBeNull();
  });
});

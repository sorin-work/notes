import { notebookDepths, readBackup } from './backup-check';

const at = '2026-01-01T00:00:00.000Z';
const note = (overrides: object = {}) => ({
  id: 'n1',
  title: 'Plan',
  content: 'Body',
  notebookId: null,
  tags: ['Work Stuff'],
  pinned: false,
  favorite: true,
  isTemplate: false,
  dailyDate: null,
  dailyReleased: false,
  revision: 3,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  versions: [],
  ...overrides,
});
const backup = (overrides: object = {}) => ({
  format: 'notes-backup',
  version: 1,
  exportedAt: at,
  notebooks: [],
  tags: [],
  shareLinks: [],
  notes: [note()],
  ...overrides,
});
const notebook = (id: string, parentId: string | null = null, name = id) => ({
  id,
  name,
  parentId,
  createdAt: at,
  updatedAt: at,
});

describe('readBackup', () => {
  it('reads a backup and puts tag names in the form the app keeps them', () => {
    expect(readBackup(backup()).notes[0]).toMatchObject({ title: 'Plan', tags: ['work-stuff'], revision: 3 });
  });

  it('reads the daily note choices, and takes what it does not know as the default', () => {
    const read = readBackup(
      backup({
        notes: [note({ isTemplate: true })],
        preferences: { dailyNotes: { notebookId: null, templateId: 'n1', dateFormat: 'something' } },
      }),
    );
    expect(read.preferences).toEqual({ dailyNotes: { notebookId: null, templateId: 'n1', dateFormat: 'iso' } });
    expect(readBackup(backup()).preferences.dailyNotes).toEqual({
      notebookId: null,
      templateId: null,
      dateFormat: 'iso',
    });
  });

  it('holds the file to the rules of the app', () => {
    const cases: [object, RegExp][] = [
      [{ version: 3 }, /version 3 is not one this app reads \(1, 2\)/],
      [{ notes: [note({ title: 'x'.repeat(201) })] }, /notes\[0\]\.title is longer than 200/],
      [{ notes: [note({ tags: Array(21).fill('t') })] }, /notes\[0\]\.tags has more than 20/],
      [{ notes: [note({ revision: -1 })] }, /revision is not a whole number/],
      [{ notes: [note({ createdAt: '2026-01-01' })] }, /createdAt is not a date and time in UTC/],
      [{ notes: [note(), note()] }, /notes has two with the same id/],
      [
        {
          notebooks: [notebook('a'), notebook('b', 'a'), notebook('c', 'b'), notebook('d', 'c'), notebook('e', 'd')],
        },
        /notebooks\[4\] is nested deeper/,
      ],
      [{ notebooks: [notebook('a', 'b'), notebook('b', 'a')] }, /notebooks\[0\] is inside itself/],
      [{ notebooks: Array.from({ length: 10_001 }, (_, i) => notebook(`n${i}`)) }, /notebooks has more than 10000/],
      [{ notebooks: [notebook('a', null, 'Work'), notebook('b', null, 'work')] }, /taken by another notebook/],
      [{ notebooks: [notebook('a', 'nowhere')] }, /parentId names no notebook/],
      [
        { notes: [note({ versions: [{ title: 'v', content: 1, createdAt: at }] })] },
        /versions\[0\]\.content is not text/,
      ],
      [{ notes: [note({ dailyDate: '2026-02-30' })] }, /dailyDate is not a real day/],
      [
        { notes: [note({ dailyDate: '2026-02-03' }), note({ id: 'n2', dailyDate: '2026-02-03' })] },
        /two daily notes for the same day/,
      ],
      [{ preferences: { dailyNotes: { templateId: 'n1' } } }, /templateId names nothing in the file/],
    ];
    for (const [change, message] of cases) {
      expect(() => readBackup(backup(change))).toThrow(message);
    }
  });
});

describe('notebookDepths', () => {
  it('gives each notebook its level, and none to a notebook in a loop or below one', () => {
    const depths = notebookDepths([
      { id: 'd', parentId: 'c' },
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
      { id: 'z', parentId: 'x' },
    ]);
    expect(Object.fromEntries(depths)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  it('takes one pass however the parents are made up, so a long loop is quick', () => {
    const count = 10_000;
    const loop = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, parentId: `n${(i + 1) % count}` }));
    const chain = Array.from({ length: count }, (_, i) => ({ id: `c${i}`, parentId: i === 0 ? null : `c${i - 1}` }));
    const started = Date.now();
    expect(notebookDepths(loop).size).toBe(0);
    // A chain listed from the bottom up, the worst order for a walk that starts again from each one.
    expect(notebookDepths([...chain].reverse()).get(`c${count - 1}`)).toBe(count);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

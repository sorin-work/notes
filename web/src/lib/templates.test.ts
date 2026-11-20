import { describe, expect, it } from 'vitest';
import { fromTemplate, placeholderValues } from './templates';

describe('placeholderValues', () => {
  it('gives the date and the time as the clock here shows them', () => {
    // Built from local parts, so the test holds in any time zone.
    expect(placeholderValues(new Date(2026, 10, 5, 7, 3))).toEqual({ date: '2026-11-05', time: '07:03' });
    expect(placeholderValues(new Date(2026, 11, 31, 23, 59, 59))).toEqual({ date: '2026-12-31', time: '23:59' });
  });
});

describe('fromTemplate', () => {
  it('names the template and the notebook, and sends the values the server cannot know', () => {
    expect(fromTemplate('t1', 'nb', new Date(2026, 0, 2, 9, 30))).toEqual({
      templateId: 't1',
      notebookId: 'nb',
      placeholders: { date: '2026-01-02', time: '09:30' },
    });
    expect(fromTemplate('t1').notebookId).toBeNull();
  });
});

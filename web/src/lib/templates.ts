import type { NoteChanges } from '../api/types';

const twoDigits = (value: number) => String(value).padStart(2, '0');

/**
 * The values for {{date}} and {{time}} in a template, as the clock here shows
 * them. They are worked out in the browser because the server does not know
 * where the user is, and so not what day it is there.
 */
export function placeholderValues(now = new Date()): { date: string; time: string } {
  return {
    date: `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`,
    time: `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`,
  };
}

/** What to send for a new note made from a template. */
export function fromTemplate(templateId: string, notebookId: string | null = null, now = new Date()): NoteChanges {
  return { templateId, notebookId, placeholders: placeholderValues(now) };
}

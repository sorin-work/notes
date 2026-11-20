import { DATE_FORMATS, DateFormat } from '../common/day';

/**
 * Choices that are kept with the account, so they are the same on every
 * device. Theme and editor mode are not among them: those belong to a screen
 * and stay in the browser.
 */
export interface Preferences {
  /** What the note behind "Today" is made with. */
  dailyNotes: {
    /** The notebook a new daily note goes into, or null for none. */
    notebookId: string | null;
    /** The template a new daily note is made from, or null for an empty note. */
    templateId: string | null;
    /** How the day is written in the title. */
    dateFormat: DateFormat;
  };
}

export const DEFAULT_PREFERENCES: Preferences = {
  dailyNotes: { notebookId: null, templateId: null, dateFormat: 'iso' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOrNull = (value: unknown): string | null => (typeof value === 'string' && UUID.test(value) ? value : null);

/**
 * What is stored for a user, as preferences. The column is free-form JSON,
 * so nothing in it is taken on trust: whatever is missing or is not what it
 * should be becomes the default.
 */
export function readPreferences(stored: unknown): Preferences {
  const root = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const daily =
    root.dailyNotes && typeof root.dailyNotes === 'object' ? (root.dailyNotes as Record<string, unknown>) : {};
  const format = DATE_FORMATS.find((known) => known === daily.dateFormat);
  return {
    dailyNotes: {
      notebookId: idOrNull(daily.notebookId),
      templateId: idOrNull(daily.templateId),
      dateFormat: format ?? DEFAULT_PREFERENCES.dailyNotes.dateFormat,
    },
  };
}

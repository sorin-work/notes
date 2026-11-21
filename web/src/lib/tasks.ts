/** How the Markdown parser ends a line: \r\n, a lone \r or \n. */
const LINE_END = /\r\n?|\n/;

/**
 * Quote and list markers at the start of a line, then the box of a task list
 * item. Like the parser, it wants a space or the end of the line after the
 * box, so `[x]: https://...`, a link definition, is not taken for one.
 */
const TASK_BOX = /^((?:[ \t]*(?:>|[-+*]|\d{1,9}[.)]))+[ \t]+)\[([ \txX])\](?=[ \t]|$)/;

/** How many lines the Markdown parser sees in a text. */
export function countLines(text: string): number {
  return text.split(LINE_END).length;
}

/**
 * Flips the box of the task list item that starts on `line`, counted from 1
 * the way the Markdown parser counts lines. `checked` is what the box showed
 * when it was clicked. The text only changes when that line holds a box in
 * that state, as a guard against editing a line the user did not click. Only
 * the character inside the box changes, so line endings and the length of the
 * text stay as they were.
 */
export function toggleTask(markdown: string, line: number, checked: boolean): string {
  // Lines sit at the even indexes, the line endings between them at the odd ones.
  const parts = markdown.split(new RegExp(`(${LINE_END.source})`));
  const index = (line - 1) * 2;
  const text = parts[index];
  if (text === undefined) return markdown;
  parts[index] = text.replace(TASK_BOX, (box, markers: string, mark: string) =>
    (mark.toLowerCase() === 'x') === checked ? `${markers}[${checked ? ' ' : 'x'}]` : box,
  );
  return parts.join('');
}

/** `due:` and a day, written after a task: `- [ ] Send the report due:2026-11-30`. */
const DUE = /(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/;

/**
 * The day a task is due, by the convention above, or null. Only a real day
 * counts: `due:2026-02-30` is none.
 */
export function dueDay(text: string): string | null {
  const day = DUE.exec(text)?.[1];
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1));
  return parsed.toISOString().slice(0, 10) === day ? day : null;
}

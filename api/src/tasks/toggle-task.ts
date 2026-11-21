/**
 * Kept in step with toggleTask in web/src/lib/tasks.ts, which ticks a box
 * from the preview. The Tasks page ticks one here, by the same rule.
 */

/** How the Markdown parser ends a line: \r\n, a lone \r or \n. */
const LINE_END = /\r\n?|\n/;

/**
 * Quote and list markers at the start of a line, then the box of a task list
 * item. Like the parser, it wants a space or the end of the line after the
 * box, so `[x]: https://...`, a link definition, is not taken for one.
 */
const TASK_BOX = /^((?:[ \t]*(?:>|[-+*]|\d{1,9}[.)]))+[ \t]+)\[([ \txX])\](?=[ \t]|$)/;

/**
 * Flips the box of the task list item that starts on `line`, counted from 1
 * the way the parser counts lines. `checked` is what the box showed when it
 * was clicked. The text only changes when that line holds a box in that
 * state. Only the character inside the box changes.
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

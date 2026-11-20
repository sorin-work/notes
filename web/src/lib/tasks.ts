/** Quote and list markers at the start of a line, then the box of a task list item. */
const TASK_BOX = /^((?:[ \t]*(?:>|[-+*]|\d{1,9}[.)]))+[ \t]+)\[([ \txX])\]/;

/**
 * Flips the `[ ]` or `[x]` box of the task list item that starts on `line`,
 * counted from 1 the way the Markdown parser counts lines. Only the character
 * inside the box changes, so line endings and the length of the text stay as
 * they were. Returns the text unchanged when that line has no box.
 */
export function toggleTask(markdown: string, line: number): string {
  // Lines sit at the even indexes, the line endings between them at the odd ones.
  const parts = markdown.split(/(\r\n?|\n)/);
  const index = (line - 1) * 2;
  const text = parts[index];
  if (text === undefined) return markdown;
  parts[index] = text.replace(
    TASK_BOX,
    (_box, markers: string, mark: string) => `${markers}[${mark.toLowerCase() === 'x' ? ' ' : 'x'}]`,
  );
  return parts.join('');
}

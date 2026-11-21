import { Fragment, ReactNode, useMemo, useState } from 'react';
import { capRows, DiffLine, DiffRow, diffLines, foldUnchanged, markWords, MAX_EDITS } from '../lib/diff';
import { savedTitle } from '../lib/text';

interface Text {
  title: string;
  content: string;
}

interface Props {
  /** The older text, the one the changes start from. */
  from: Text;
  /** The newer text. */
  to: Text;
  /**
   * When both are versions, what to call them: their times. Without it
   * `from` is a version and `to` the note as it is in the editor, saved or not.
   */
  labels?: { from: string; to: string };
}

const SIGNS = { same: ' ', removed: '-', added: '+' };

/** How many hidden lines one click on "Show" puts back. */
export const UNFOLD_STEP = 500;

/** The words of a changed line, with those that differ marked, and said out loud for a screen reader. */
function lineText(row: DiffLine): ReactNode {
  if (!row.parts) return row.text;
  const Mark = row.type === 'added' ? 'ins' : 'del';
  const said = row.type === 'added' ? 'added' : 'removed';
  return row.parts.map((part, index) =>
    part.changed ? (
      <Mark key={index}>
        <span className="sr-only diff-label">({said}: </span>
        {part.text}
        <span className="sr-only diff-label">)</span>
      </Mark>
    ) : (
      part.text
    ),
  );
}

/** What changed from one text to the other: the title, then the text line by line, and word by word inside a line. */
export function VersionChanges({ from, to, labels }: Props) {
  const diff = useMemo(() => {
    const lines = diffLines(from.content, to.content);
    if (lines === null) return null;
    return capRows(lines.some((line) => line.type !== 'same') ? foldUnchanged(markWords(lines)) : []);
  }, [from.content, to.content]);
  // How many lines of each folded stretch were put back, by the index of its row.
  const [shown, setShown] = useState<ReadonlyMap<number, number>>(new Map());
  // A version holds the title as the API stored it. The editor has what was typed.
  const fromTitle = savedTitle(from.title);
  const toTitle = savedTitle(to.title);
  const between = labels ? 'the two versions' : 'this version and the note now';

  const skipped = (row: Extract<DiffRow, { type: 'skipped' }>, index: number) => {
    const open = shown.get(index) ?? 0;
    const hidden = row.count - open;
    const next = Math.min(hidden, UNFOLD_STEP);
    return (
      <>
        {row.lines.slice(0, open).map((line, at) => (
          <Line key={`${index}-${at}`} row={line} />
        ))}
        {hidden > 0 && (
          <div className="diff-skipped">
            <span>
              {hidden.toLocaleString()} unchanged {hidden === 1 ? 'line' : 'lines'}
            </span>
            <button
              type="button"
              className="link-button"
              onClick={() => setShown((current) => new Map(current).set(index, open + next))}
            >
              {next === hidden
                ? `Show ${hidden === 1 ? 'it' : `the ${hidden.toLocaleString()} lines`}`
                : `Show ${next.toLocaleString()} of them`}
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="changes">
      {fromTitle !== toTitle && (
        <p className="changes-title">
          The title changed from <del>“{fromTitle}”</del> to <ins>“{toTitle}”</ins>.
        </p>
      )}
      {diff === null && (
        <p className="muted">
          More than {MAX_EDITS.toLocaleString()} lines differ between {between}, too many to compare line by line. The
          preview shows the whole version.
        </p>
      )}
      {diff?.rows.length === 0 && (
        <p className="muted">
          {labels ? 'The two versions have the same text.' : 'The text of this version is the same as the note now.'}
        </p>
      )}
      {diff && diff.rows.length > 0 && (
        <>
          <p className="muted changes-legend">
            {labels
              ? `From the version of ${labels.from} to the one of ${labels.to}`
              : 'From this version to the note as it is now'}
            : lines marked - were removed, lines marked + were added. Inside a line that changed, the words that differ
            are marked.
          </p>
          <div className="diff">
            {diff.rows.map((row, index) =>
              row.type === 'skipped' ? (
                <Fragment key={index}>{skipped(row, index)}</Fragment>
              ) : (
                <Line key={index} row={row} />
              ),
            )}
            {diff.more > 0 && (
              <div className="diff-skipped">{diff.more.toLocaleString()} more changed lines are not shown</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Line({ row }: { row: DiffLine }) {
  return (
    <div className={`diff-line diff-${row.type}`}>
      <span className="diff-sign" aria-hidden="true">
        {SIGNS[row.type]}
      </span>
      <span className="diff-text">
        {row.type !== 'same' && (
          <span className="sr-only diff-label">{row.type === 'added' ? 'Added: ' : 'Removed: '}</span>
        )}
        {lineText(row)}
      </span>
    </div>
  );
}

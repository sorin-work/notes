import { useMemo } from 'react';
import { diffLines, foldUnchanged } from '../lib/diff';

interface Props {
  version: { title: string; content: string };
  /** The note as it is in the editor, saved or not. */
  current: { title: string; content: string };
}

const SIGNS = { same: ' ', removed: '-', added: '+' };

/** What changed between a version and the note as it is now: the title, then the text line by line. */
export function VersionChanges({ version, current }: Props) {
  const rows = useMemo(() => {
    const lines = diffLines(version.content, current.content);
    if (lines === null) return null;
    return lines.some((line) => line.type !== 'same') ? foldUnchanged(lines) : [];
  }, [version.content, current.content]);

  return (
    <div className="changes">
      {version.title !== current.title && (
        <p className="changes-title">
          The title changed from <del>“{version.title || 'Untitled'}”</del> to{' '}
          <ins>“{current.title || 'Untitled'}”</ins>.
        </p>
      )}
      {rows === null && (
        <p className="muted">
          Too much has changed in this long note to compare it line by line. The preview shows the whole version.
        </p>
      )}
      {rows?.length === 0 && <p className="muted">The text of this version is the same as the note now.</p>}
      {rows && rows.length > 0 && (
        <>
          <p className="muted changes-legend">
            From this version to the note as it is now: lines marked - were removed, lines marked + were added.
          </p>
          <div className="diff">
            {rows.map((row, index) =>
              row.type === 'skipped' ? (
                <div key={index} className="diff-skipped">
                  {row.count.toLocaleString()} unchanged lines
                </div>
              ) : (
                <div key={index} className={`diff-line diff-${row.type}`}>
                  <span className="diff-sign" aria-hidden="true">
                    {SIGNS[row.type]}
                  </span>
                  <span className="diff-text">
                    {row.type !== 'same' && (
                      <span className="sr-only">{row.type === 'added' ? 'Added: ' : 'Removed: '}</span>
                    )}
                    {row.text}
                  </span>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

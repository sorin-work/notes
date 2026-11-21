import { MouseEvent, useState } from 'react';
import { headingId, NoteHeading } from '../lib/headings';
import { TreeToggle } from './TreeToggle';

interface OutlineNode {
  heading: NoteHeading;
  children: OutlineNode[];
}

/** The headings as a tree: each one holds the deeper headings that follow it, up to the next of its depth or less. */
export function outlineTree(headings: NoteHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const open: OutlineNode[] = [];
  for (const heading of headings) {
    const node = { heading, children: [] };
    while (open.length > 0 && (open[open.length - 1]?.heading.depth ?? 0) >= heading.depth) open.pop();
    (open[open.length - 1]?.children ?? roots).push(node);
    open.push(node);
  }
  return roots;
}

interface Props {
  headings: NoteHeading[];
  onPick(heading: NoteHeading): void;
}

/** The headings of the open note, as a list that folds. A click goes to the heading. */
export function NoteOutline({ headings, onPick }: Props) {
  // Folded headings by slug, which is unique in the note. Not kept: a long note is folded afresh.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  if (headings.length === 0) {
    return (
      <nav className="outline" aria-label="Outline">
        <p className="muted">No headings in this note yet. A line that starts with # is one.</p>
      </nav>
    );
  }
  const toggle = (slug: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(slug)) next.add(slug);
      return next;
    });

  const list = (nodes: OutlineNode[], id?: string) => (
    <ul id={id}>
      {nodes.map(({ heading, children }) => {
        const open = !folded.has(heading.slug);
        const childrenId = `outline-${heading.slug}`;
        return (
          <li key={heading.slug}>
            <span className="outline-row">
              {children.length > 0 ? (
                <TreeToggle
                  name={heading.text || 'heading'}
                  open={open}
                  controls={childrenId}
                  onToggle={() => toggle(heading.slug)}
                />
              ) : (
                <span className="tree-toggle" aria-hidden="true" />
              )}
              <a
                href={`#${headingId(heading.slug)}`}
                onClick={(event: MouseEvent) => {
                  event.preventDefault();
                  onPick(heading);
                }}
              >
                {heading.text || <span className="muted">(empty heading)</span>}
              </a>
            </span>
            {children.length > 0 && open && list(children, childrenId)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className="outline" aria-label="Outline">
      {list(outlineTree(headings))}
    </nav>
  );
}

import { ComponentProps, createContext, memo, MouseEvent, useContext } from 'react';
import ReactMarkdown, { defaultUrlTransform, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkifyWikiLinks, normalizeTitle, WIKI_PROTOCOL, wikiTarget } from '../lib/wikilinks';

interface MarkdownPreviewProps {
  content: string;
  /** Called when a [[link]] is clicked. Without it, links render as plain text. */
  onWikiLink?: (title: string) => void;
  /** Normalised titles of links that point at no note, shown as broken. */
  missingTitles?: Set<string>;
  /**
   * Called when the box of a task list item is clicked, with the line of the
   * source the item starts on (counted from 1). Without it, boxes are read-only.
   */
  onToggleTask?: (line: number) => void;
}

type HastElement = NonNullable<ExtraProps['node']>;

const remarkPlugins = [remarkGfm];

function urlTransform(url: string): string {
  return url.startsWith(WIKI_PROTOCOL) ? url : defaultUrlTransform(url);
}

/** What to call when a task box is clicked. Not set where the preview is read-only. */
const ToggleTaskContext = createContext<((line: number) => void) | undefined>(undefined);
/** The task list item a checkbox sits in. The parser gives the item a source position, the checkbox has none. */
const TaskItemContext = createContext<{ line: number; label: string } | null>(null);

/** The text of a list item without its nested lists. */
function itemText(item: HastElement): string {
  const text = (nodes: HastElement['children']): string =>
    nodes
      .map((child) => {
        if (child.type === 'text') return child.value;
        if (child.type !== 'element' || child.tagName === 'ul' || child.tagName === 'ol') return '';
        return text(child.children);
      })
      .join('');
  return text(item.children).replace(/\s+/g, ' ').trim();
}

// These two are defined out here, not inline like the link below, so that they
// are the same components on every render. React then keeps the checkbox in
// the page when a click changes the text, and it keeps the keyboard focus.

function ListItem({ node, children, ...props }: ComponentProps<'li'> & ExtraProps) {
  const line = node?.position?.start.line;
  const task =
    node && line !== undefined && props.className?.includes('task-list-item') ? { line, label: itemText(node) } : null;
  return (
    <li {...props}>
      <TaskItemContext value={task}>{children}</TaskItemContext>
    </li>
  );
}

function TaskBox({ node: _node, ...props }: ComponentProps<'input'> & ExtraProps) {
  const onToggleTask = useContext(ToggleTaskContext);
  const item = useContext(TaskItemContext);
  // Read-only: the box as the parser made it, which is disabled.
  if (!onToggleTask || !item) return <input {...props} />;
  return (
    <input
      type="checkbox"
      checked={props.checked === true}
      aria-label={item.label || 'Task'}
      onChange={() => onToggleTask(item.line)}
    />
  );
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  onWikiLink,
  missingTitles,
  onToggleTask,
}: MarkdownPreviewProps) {
  if (!content.trim()) {
    return <p className="preview-empty">Nothing to preview yet.</p>;
  }
  return (
    <div className="markdown">
      <ToggleTaskContext value={onToggleTask}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          urlTransform={urlTransform}
          components={{
            a({ href, children }) {
              const target = wikiTarget(href);
              if (target === null) {
                return (
                  <a href={href} target="_blank" rel="noreferrer noopener">
                    {children}
                  </a>
                );
              }
              if (!onWikiLink) {
                return <span className="wikilink wikilink-static">{children}</span>;
              }
              const missing = missingTitles?.has(normalizeTitle(target));
              return (
                <a
                  href={`#${encodeURIComponent(target)}`}
                  className={missing ? 'wikilink wikilink-missing' : 'wikilink'}
                  title={missing ? `“${target}” does not exist yet. Click to create it.` : target}
                  onClick={(event: MouseEvent) => {
                    event.preventDefault();
                    onWikiLink(target);
                  }}
                >
                  {children}
                </a>
              );
            },
            li: ListItem,
            input: TaskBox,
          }}
        >
          {linkifyWikiLinks(content)}
        </ReactMarkdown>
      </ToggleTaskContext>
    </div>
  );
});

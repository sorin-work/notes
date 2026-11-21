import { ComponentProps, createContext, memo, MouseEvent, useContext } from 'react';
import ReactMarkdown, { defaultUrlTransform, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Pluggable } from 'unified';
import { headingId, remarkHeadingIds, slugify } from '../lib/headings';
import { countLines } from '../lib/tasks';
import { linkifyWikiLinks, normalizeTitle, WIKI_PROTOCOL, wikiTarget } from '../lib/wikilinks';

interface MarkdownPreviewProps {
  content: string;
  /**
   * Called when a [[link]] is clicked, with the title and the #heading part
   * if it has one. The title is empty for [[#Heading]], a link within this
   * note. Without it, links render as plain text.
   */
  onWikiLink?: (title: string, heading: string | null) => void;
  /**
   * Gives headings their ids (`h-` and a slug), for links to them and the
   * outline. Only one preview on a page should, or the ids repeat.
   */
  headingIds?: boolean;
  /** Normalised titles of links that point at no note, shown as broken. */
  missingTitles?: Set<string>;
  /**
   * When given, only links to these normalised titles are links. Any other
   * is plain text, with nothing to show whether its note exists. For the
   * public page of a shared note.
   */
  linkedTitles?: Set<string>;
  /**
   * Called when the box of a task list item is clicked, with the line of the
   * source the item starts on (counted from 1) and whether the box showed as
   * ticked. Without it, boxes are read-only.
   */
  onToggleTask?: (line: number, checked: boolean) => void;
  /**
   * Where the note's `attachment:<id>` links and images load from: signed
   * addresses by attachment id. An id it does not hold shows as unavailable.
   */
  attachmentUrls?: Record<string, string>;
}

type HastElement = NonNullable<ExtraProps['node']>;

const ATTACHMENT_PROTOCOL = 'attachment:';

function urlTransformFor(attachmentUrls: Record<string, string> | undefined) {
  return (url: string): string => {
    if (url.startsWith(WIKI_PROTOCOL)) return url;
    // The app's own files: the signed address, which is a path on this site, or nothing.
    if (url.startsWith(ATTACHMENT_PROTOCOL)) return attachmentUrls?.[url.slice(ATTACHMENT_PROTOCOL.length)] ?? '';
    return defaultUrlTransform(url);
  };
}

/** An image whose address is gone or not known shows its words, not a broken picture. */
function Image({ node: _node, src, alt, ...props }: ComponentProps<'img'> & ExtraProps) {
  if (!src) return <span className="attachment-missing">{alt || 'Image'} (not available)</span>;
  return <img src={src} alt={alt ?? ''} loading="lazy" {...props} />;
}

/** What to call when a task box is clicked. Not set where the preview is read-only. */
const ToggleTaskContext = createContext<((line: number, checked: boolean) => void) | undefined>(undefined);
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
  // The line lets the editor find a task the Tasks page opened the note at.
  return (
    <li {...props} data-line={task?.line} tabIndex={task ? -1 : undefined}>
      <TaskItemContext value={task}>{children}</TaskItemContext>
    </li>
  );
}

function TaskBox({ node: _node, ...props }: ComponentProps<'input'> & ExtraProps) {
  const onToggleTask = useContext(ToggleTaskContext);
  const item = useContext(TaskItemContext);
  // Read-only: the box as the parser made it, which is disabled. It still gets
  // a name, because a box without one tells a screen reader nothing.
  if (!onToggleTask || !item) return <input aria-label={item?.label || 'Task'} {...props} />;
  const checked = props.checked === true;
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={item.label || 'Task'}
      onChange={() => onToggleTask(item.line, checked)}
    />
  );
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  onWikiLink,
  missingTitles,
  linkedTitles,
  onToggleTask,
  attachmentUrls,
  headingIds = false,
}: MarkdownPreviewProps) {
  if (!content.trim()) {
    return <p className="preview-empty">Nothing to preview yet.</p>;
  }
  const linkified = linkifyWikiLinks(content);
  // Boxes are found in the source by line number, and the parser reads the
  // linkified text. Should the two ever differ in their lines, boxes stay read-only.
  const sameLines = onToggleTask !== undefined && countLines(linkified) === countLines(content);
  // Filled by the plugin while the text is parsed, which is done before any link below is rendered.
  const slugs = new Set<string>();
  const remarkPlugins = headingIds ? [remarkGfm, [remarkHeadingIds, { slugs }] satisfies Pluggable] : [remarkGfm];
  return (
    <div className="markdown">
      <ToggleTaskContext value={sameLines ? onToggleTask : undefined}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          urlTransform={urlTransformFor(attachmentUrls)}
          components={{
            a({ href, children }) {
              const target = wikiTarget(href);
              if (target === null) {
                if (!href) return <span className="attachment-missing">{children}</span>;
                return (
                  <a href={href} target="_blank" rel="noreferrer noopener">
                    {children}
                  </a>
                );
              }
              const { title, heading } = target;
              const here = title === '';
              const allowed = here ? headingIds : !linkedTitles || linkedTitles.has(normalizeTitle(title));
              if (!onWikiLink || !allowed) {
                return <span className="wikilink wikilink-static">{children}</span>;
              }
              // Whether a heading of another note is there is only known once it is opened.
              const slug = slugify(heading ?? '');
              const missing = here ? !slugs.has(slug) : missingTitles?.has(normalizeTitle(title));
              const hint = here
                ? missing
                  ? `There is no heading “${heading}” in this note.`
                  : (heading ?? '')
                : missing
                  ? `“${title}” does not exist yet. Click to create it.`
                  : heading
                    ? `${title}, at “${heading}”`
                    : title;
              return (
                <a
                  href={here ? `#${headingId(slug)}` : `#${encodeURIComponent(title)}`}
                  className={missing ? 'wikilink wikilink-missing' : 'wikilink'}
                  title={hint}
                  onClick={(event: MouseEvent) => {
                    event.preventDefault();
                    onWikiLink(title, heading);
                  }}
                >
                  {children}
                </a>
              );
            },
            li: ListItem,
            input: TaskBox,
            img: Image,
          }}
        >
          {linkified}
        </ReactMarkdown>
      </ToggleTaskContext>
    </div>
  );
});

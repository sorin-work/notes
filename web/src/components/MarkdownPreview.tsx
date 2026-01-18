import { memo, MouseEvent } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { linkifyWikiLinks, normalizeTitle, WIKI_PROTOCOL, wikiTarget } from '../lib/wikilinks';

interface MarkdownPreviewProps {
  content: string;
  /** Called when a [[link]] is clicked. Without it, links render as plain text. */
  onWikiLink?: (title: string) => void;
  /** Normalised titles of links that point at no note, shown as broken. */
  missingTitles?: Set<string>;
}

const remarkPlugins = [remarkGfm];

function urlTransform(url: string): string {
  return url.startsWith(WIKI_PROTOCOL) ? url : defaultUrlTransform(url);
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  onWikiLink,
  missingTitles,
}: MarkdownPreviewProps) {
  if (!content.trim()) {
    return <p className="preview-empty">Nothing to preview yet.</p>;
  }
  return (
    <div className="markdown">
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
        }}
      >
        {linkifyWikiLinks(content)}
      </ReactMarkdown>
    </div>
  );
});

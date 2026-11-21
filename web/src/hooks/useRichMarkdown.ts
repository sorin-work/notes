import { useSyncExternalStore } from 'react';
import type { PluggableList } from 'unified';

/** The plugins of lib/richMarkdown, once they have loaded. */
export interface RichPlugins {
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
}

/**
 * The module is asked for once per page. A failed import is not tried again:
 * the browser keeps the failure of a module it could not load, and asking
 * again only gets the same failure. A reload starts over.
 */
type State = { status: 'idle' | 'loading' | 'failed' } | { status: 'loaded'; plugins: RichPlugins };

let state: State = { status: 'idle' };
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

function load(): void {
  if (state.status !== 'idle') return;
  state = { status: 'loading' };
  import('../lib/richMarkdown')
    .then((module) =>
      set({ status: 'loaded', plugins: { remarkPlugins: module.remarkPlugins, rehypePlugins: module.rehypePlugins } }),
    )
    .catch(() => set({ status: 'failed' }));
}

/**
 * Whether a note has something only the rich plugins show: a fenced block
 * that names its language, or `$$` math. Most notes do not, and never load them.
 */
export function needsRichMarkdown(markdown: string): boolean {
  return markdown.includes('$$') || /^[ \t>]*(?:`{3,}|~{3,})[ \t]*[^\s`~]/m.test(markdown);
}

/**
 * For a note that needs them: the rich plugins once they have loaded, or
 * "failed" when they could not be, and the note shows as plain Markdown.
 * Null while they load, and for a note that does not need them.
 */
export function useRichMarkdown(markdown: string): RichPlugins | 'failed' | null {
  const needed = needsRichMarkdown(markdown);
  if (needed) load();
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
  if (!needed) return null;
  if (current.status === 'loaded') return current.plugins;
  return current.status === 'failed' ? 'failed' : null;
}

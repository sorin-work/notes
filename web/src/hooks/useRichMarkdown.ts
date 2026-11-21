import { useSyncExternalStore } from 'react';
import type { PluggableList } from 'unified';

/** The plugins of lib/richMarkdown, once they have loaded. */
export interface RichPlugins {
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
}

let loaded: RichPlugins | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): void {
  loading ??= import('../lib/richMarkdown')
    .then((module) => {
      loaded = { remarkPlugins: module.remarkPlugins, rehypePlugins: module.rehypePlugins };
      for (const listener of listeners) listener();
    })
    .catch(() => {
      // Without a connection for the file, the note shows as plain Markdown. The next note tries again.
      loading = null;
    });
}

/**
 * Whether a note has something only the rich plugins show: a fenced block
 * that names its language, or `$$` math. Most notes do not, and never load them.
 */
export function needsRichMarkdown(markdown: string): boolean {
  return markdown.includes('$$') || /^[ \t>]*(?:`{3,}|~{3,})[ \t]*[^\s`~]/m.test(markdown);
}

/**
 * The rich plugins for a note that needs them: null until they have
 * loaded, and for a note that does not need them.
 */
export function useRichMarkdown(markdown: string): RichPlugins | null {
  const needed = needsRichMarkdown(markdown);
  if (needed && !loaded) load();
  const plugins = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => loaded,
  );
  return needed ? plugins : null;
}

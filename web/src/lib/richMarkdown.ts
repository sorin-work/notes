// The parts of the preview that only some notes need: colours for code,
// and formulas. Loaded on demand (see useRichMarkdown), so the main bundle
// does not carry them. KaTeX's styles and fonts are files of the build,
// served from this host like the rest, so the policy of item 19 holds:
// KaTeX writes its layout as style properties, which React sets through
// the DOM, not as inline style attributes the policy would refuse.
import 'katex/dist/katex.min.css';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';

export const remarkPlugins: PluggableList = [
  // Math only between `$$`: a single `$` stays a dollar, so "costs $5 or $10" is not a formula.
  [remarkMath, { singleDollarTextMath: false }],
];

export const rehypePlugins: PluggableList = [
  [
    rehypeKatex,
    {
      // A formula with a mistake shows its source, marked, instead of breaking the preview.
      throwOnError: false,
      errorColor: 'var(--danger)',
      strict: 'ignore',
      // No \href, \url or \includegraphics from a note, and bounded work for macros.
      trust: false,
      maxExpand: 1000,
      maxSize: 50,
    },
  ],
  // Only blocks that name their language are coloured. Guessing would colour prose in plain blocks.
  [rehypeHighlight, { detect: false }],
];

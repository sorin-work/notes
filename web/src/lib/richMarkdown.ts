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
import type { Nodes, Root } from 'mdast';
import type { PluggableList } from 'unified';

/** How much math one note gets drawn: formulas, and characters of their source. The rest shows as code. */
export const MAX_FORMULAS = 500;
export const MAX_MATH_SOURCE = 200_000;

/**
 * Keeps KaTeX's work for one note bounded: past MAX_FORMULAS formulas or
 * MAX_MATH_SOURCE characters of them, in document order, a formula becomes
 * code with its source, which costs nothing to show.
 */
export function remarkMathBudget() {
  return (tree: Root) => {
    let formulas = 0;
    let source = 0;
    const stack: Nodes[] = [tree];
    const order: Nodes[] = [];
    while (stack.length) {
      const node = stack.pop() as Nodes;
      order.push(node);
      if ('children' in node)
        for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index] as Nodes);
    }
    for (const node of order) {
      if (node.type !== 'math' && node.type !== 'inlineMath') continue;
      formulas++;
      source += node.value.length;
      if (formulas <= MAX_FORMULAS && source <= MAX_MATH_SOURCE) continue;
      // Turned into code in place: the same value, and none of the data that tells rehype-katex to draw it.
      const code = node as unknown as { type: string; value: string; lang?: null; meta?: null; data?: unknown };
      delete code.data;
      if (node.type === 'math') {
        code.type = 'code';
        code.lang = null;
        code.meta = null;
      } else {
        code.type = 'inlineCode';
      }
    }
  };
}

export const remarkPlugins: PluggableList = [
  // Math only between `$$`: a single `$` stays a dollar, so "costs $5 or $10" is not a formula.
  [remarkMath, { singleDollarTextMath: false }],
  remarkMathBudget,
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

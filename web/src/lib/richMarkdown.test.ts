import type { Root } from 'mdast';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { MAX_FORMULAS, remarkMathBudget } from './richMarkdown';

const typesOf = (markdown: string): string[] => {
  const processor = unified().use(remarkParse).use(remarkMath, { singleDollarTextMath: false }).use(remarkMathBudget);
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  const types: string[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    if (['math', 'inlineMath', 'code', 'inlineCode'].includes(node.type)) types.push(node.type);
    for (const child of node.children ?? []) walk(child as { type: string; children?: unknown[] });
  };
  walk(tree);
  return types;
};

describe('remarkMathBudget', () => {
  it('draws formulas up to the limit and shows the rest as code', () => {
    const many = Array.from({ length: MAX_FORMULAS + 2 }, (_, index) => `$$x_${index}$$`).join(' ');
    const types = typesOf(`${many}\n\n$$\ny\n$$`);
    expect(types.filter((type) => type === 'inlineMath')).toHaveLength(MAX_FORMULAS);
    expect(types.slice(MAX_FORMULAS)).toEqual(['inlineCode', 'inlineCode', 'code']);
  });

  it('leaves a note within the limits as it is', () => {
    expect(typesOf('$$a$$ and\n\n$$\nb\n$$')).toEqual(['inlineMath', 'math']);
  });
});

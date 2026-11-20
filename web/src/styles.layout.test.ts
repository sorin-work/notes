import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
const narrowAt = css.indexOf('@media (max-width: 820px)');

describe('the shade behind the menu', () => {
  // The page tests run without styles, so this reads the stylesheet. An open
  // menu on a wide screen once turned the shade into a column of the layout
  // and squeezed the page under the sidebar.
  it('is not part of the layout on a wide screen', () => {
    expect(narrowAt).toBeGreaterThan(0);
    expect(css.slice(0, narrowAt)).toMatch(/\.scrim \{\n {2}display: none;\n\}/);
  });

  it('covers the page behind the menu on a narrow one', () => {
    expect(css.slice(narrowAt)).toMatch(/\.scrim \{\n {4}display: block;\n {4}position: fixed;/);
  });

  it('uses the width that Layout asks about', () => {
    const layout = readFileSync(join(import.meta.dirname, 'components/Layout.tsx'), 'utf8');
    expect(layout).toContain("const NARROW_SCREEN = '(max-width: 820px)';");
  });
});

describe('the graph', () => {
  // A grid column is as wide as its longest word unless it is told otherwise.
  // One title without spaces once made every row of the list wider than the page.
  it('wraps a title without spaces in the list', () => {
    expect(css).toMatch(/\.graph-list \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.graph-list li \{\n {2}overflow-wrap: anywhere;\n\}/);
  });

  it('sizes the titles in the picture in pixels', () => {
    expect(css).toMatch(/\.graph-node text \{[^}]*font-size: 12px;/);
  });
});

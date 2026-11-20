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

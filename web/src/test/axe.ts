import { expect } from 'vitest';
import { configureAxe } from 'vitest-axe';

const axe = configureAxe({
  rules: {
    // jsdom does not lay out or paint, so axe cannot see colours here. src/styles.contrast.test.ts checks the palette.
    'color-contrast': { enabled: false },
  },
});

/**
 * Fails the test when axe finds an accessibility problem in what is on screen.
 * Pass `part: true` for a page or component rendered without the layout
 * around it, where the rule that all content sits inside a landmark cannot hold.
 */
export async function expectNoAxeViolations({ part = false }: { part?: boolean } = {}): Promise<void> {
  const results = await axe(document.body, {
    rules: {
      // Only off for parts of a page. Whole pages are checked with it on.
      region: { enabled: !part },
    },
  });
  const found = results.violations.map(
    (violation) => `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => `  ${node.html}`).join('\n')}`,
  );
  expect(found).toEqual([]);
}

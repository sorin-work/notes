import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');

/**
 * jsdom cannot tell what colour anything is, so axe cannot check contrast in
 * the page tests. This reads the palette from the stylesheet instead and
 * checks the pairs of colours that the styles put on top of each other.
 * A new combination in styles.css needs a line here.
 */

/** Text on its background: WCAG AA asks for 4.5:1. */
const TEXT: [text: string, background: string][] = [
  // Body text, on the page, on cards, in the sidebar, on the selected row, on a search match, on a hovered menu row.
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['text', 'accent-soft'],
  ['text', 'mark'],
  ['text', 'border'],
  // Secondary text: dates, counts, excerpts and hints in the same places.
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface-2'],
  ['muted', 'accent-soft'],
  ['muted', 'border'],
  // Links, and the selected menu entry, view switch and tag chips.
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent', 'surface-2'],
  ['accent', 'accent-soft'],
  // The labels of the primary and the delete buttons.
  ['accent-text', 'accent'],
  ['danger-text', 'danger'],
  // Error text, quiet delete buttons (also hovered), and the error and trash banners.
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['danger', 'surface-2'],
  ['danger', 'danger-soft'],
  ['success', 'bg'],
  ['success', 'surface'],
  // Links to notes that do not exist yet.
  ['missing', 'surface'],
];

/** Shapes that carry meaning without text: WCAG AA asks for 3:1. */
const SHAPES: [shape: string, background: string][] = [
  // The outline of text fields and selects.
  ['control-border', 'bg'],
  ['control-border', 'surface'],
  ['control-border', 'surface-2'],
  // The focus ring.
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent', 'surface-2'],
  // The favourite star in the note list, also on the selected and the hovered row.
  ['favourite', 'surface'],
  ['favourite', 'surface-2'],
  ['favourite', 'accent-soft'],
];

/** The colour variables of the first rule with this selector. */
function palette(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map(([, name, value]) => [name, value]),
  );
}

/** Relative luminance as WCAG 2 defines it. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one: string, other: string): number {
  const [darker = 0, lighter = 0] = [luminance(one), luminance(other)].sort((a, b) => a - b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The pairs that fall short, as readable lines. An empty list means all of them pass. */
function tooFaint(colours: Record<string, string>, pairs: [string, string][], needed: number): string[] {
  return pairs.flatMap(([front, back]) => {
    const [a, b] = [colours[front], colours[back]];
    if (!a || !b) return [`${front} or ${back} is not in the palette`];
    const ratio = contrast(a, b);
    return ratio >= needed ? [] : [`${front} ${a} on ${back} ${b} is ${ratio.toFixed(2)}:1, needs ${needed}:1`];
  });
}

const themes = {
  light: palette(':root'),
  dark: palette(":root[data-theme='dark']"),
};

describe('colour contrast', () => {
  it.each(Object.entries(themes))('meets WCAG AA in the %s theme', (_name, colours) => {
    expect(tooFaint(colours, TEXT, 4.5)).toEqual([]);
    expect(tooFaint(colours, SHAPES, 3)).toEqual([]);
  });

  it('gives the system dark mode the same colours as the dark theme', () => {
    expect(palette(":root:not([data-theme='light'])")).toEqual(themes.dark);
  });

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

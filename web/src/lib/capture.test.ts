import { describe, expect, it } from 'vitest';
import { captureDraft } from './capture';

const draft = (query: string) => captureDraft(new URLSearchParams(query));

describe('captureDraft', () => {
  it('takes the title and puts a link to the page on the first line', () => {
    expect(draft('title=Bread%20basics&url=https%3A%2F%2Fexample.com%2Fbread%3Fa%3D1')).toEqual({
      title: 'Bread basics',
      content: '[Bread basics](<https://example.com/bread?a=1>)\n\n',
    });
  });

  it('keeps brackets and parentheses from breaking the link', () => {
    const { content } = draft(
      `title=${encodeURIComponent('Arrays [part 1]')}&url=${encodeURIComponent('https://example.com/a_(b)?q=<x> y')}`,
    );
    expect(content).toBe('[Arrays \\[part 1\\]](<https://example.com/a_(b)?q=%3Cx%3E%20y>)\n\n');
  });

  it('uses the address as the link text when there is no title', () => {
    expect(draft('url=https%3A%2F%2Fexample.com%2F')).toEqual({
      title: '',
      content: '[https://example.com/](<https://example.com/>)\n\n',
    });
  });

  it('does not make a link of anything but an http address', () => {
    expect(draft('title=x&url=javascript%3Aalert(1)').content).toBe('javascript:alert(1)\n\n');
    expect(draft('title=x&url=not%20an%20address').content).toBe('not an address\n\n');
  });

  it('copes with nothing at all, and cuts a title that is too long', () => {
    expect(draft('')).toEqual({ title: '', content: '' });
    expect(draft(`title=${'a'.repeat(300)}`).title).toHaveLength(200);
    expect(draft('title=%20two%0Alines%20').title).toBe('two lines');
  });
});

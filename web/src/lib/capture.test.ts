import { describe, expect, it } from 'vitest';
import { captureDraft } from './capture';

const draft = (values: { title?: string; url?: string }) => {
  const params = new URLSearchParams();
  if (values.title !== undefined) params.set('title', values.title);
  if (values.url !== undefined) params.set('url', values.url);
  return captureDraft(params);
};

describe('captureDraft', () => {
  it('takes the title as the title and the address as a link on a line of its own', () => {
    expect(draft({ title: 'Bread basics', url: 'https://example.com/bread?a=1' })).toEqual({
      title: 'Bread basics',
      content: '<https://example.com/bread?a=1>\n\n',
      urlDropped: false,
    });
  });

  it('keeps the title out of the Markdown, so it cannot bring a link or dress one up', () => {
    // A second live link inside what used to be the link text.
    expect(draft({ title: 'x <https://evil.example> y', url: 'https://ok.example/' }).content).toBe(
      '<https://ok.example/>\n\n',
    );
    // One site's name over another site's address.
    expect(draft({ title: 'https://bank.example', url: 'https://evil.example/' }).content).toBe(
      '<https://evil.example/>\n\n',
    );
    expect(draft({ title: '![](https://evil.example/p.gif) [Sign in](https://evil.example)' }).content).toBe('');
  });

  it('leaves out anything that is not an http or https address, and says that it did', () => {
    const smuggled = '![](https://evil.example/p.gif)\n\n[Sign in again](https://evil.example)';
    for (const url of [smuggled, 'javascript:alert(1)', 'not an address', 'ftp://example.com/file', '//example.com']) {
      expect(draft({ title: 'x', url })).toEqual({ title: 'x', content: '', urlDropped: true });
    }
  });

  it('leaves out an address that names one site and goes to another', () => {
    expect(draft({ url: 'https://bank.example@evil.example/' })).toMatchObject({ content: '', urlDropped: true });
  });

  it('writes the address so that nothing in it ends the link or starts another', () => {
    const { content } = draft({ url: 'https://example.com/a_(b)?q=<x> [y](z)\n\n[more](https://evil.example)' });
    const address = content.slice(1, content.indexOf('>'));
    expect(content).toBe(`<${address}>\n\n`);
    expect(address).not.toMatch(/[\s<>]/);
    expect(address.startsWith('https://example.com/a_(b)?q=%3Cx%3E%20[y](z)')).toBe(true);
  });

  it('cuts a long title, drops a long address, and makes one line of both', () => {
    expect(draft({ title: 'a'.repeat(300) }).title).toHaveLength(200);
    expect(draft({ title: ' two\nlines \r\n here ' }).title).toBe('two lines here');
    expect(draft({ url: `https://example.com/${'a'.repeat(2000)}` })).toMatchObject({ content: '', urlDropped: true });
  });

  it('copes with nothing at all', () => {
    expect(captureDraft(new URLSearchParams())).toEqual({ title: '', content: '', urlDropped: false });
  });
});

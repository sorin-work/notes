import { parseFrontMatter, serializeFrontMatter } from './front-matter';

describe('parseFrontMatter', () => {
  it('returns the text unchanged when there is no front matter', () => {
    expect(parseFrontMatter('# Title\n\nBody')).toEqual({ data: {}, body: '# Title\n\nBody' });
  });

  it('reads strings, booleans and inline lists', () => {
    const text = '---\ntitle: "Weekly: review"\npinned: true\nfavorite: false\ntags: ["two words", work]\n---\nBody';
    expect(parseFrontMatter(text)).toEqual({
      data: { title: 'Weekly: review', pinned: true, favorite: false, tags: ['two words', 'work'] },
      body: 'Body',
    });
  });

  it('unquotes every quoted list item, not only the first', () => {
    const text = "---\ntags: [work, \"two words\", 'it''s']\n---\nBody";
    expect(parseFrontMatter(text).data.tags).toEqual(['work', 'two words', "it's"]);
  });

  it('reads block lists', () => {
    const text = '---\ntags:\n  - one\n  - "two"\nauthor: me\n---\n\nBody';
    expect(parseFrontMatter(text).data).toEqual({ tags: ['one', 'two'], author: 'me' });
    expect(parseFrontMatter(text).body).toBe('Body');
  });

  it('ignores comments and lines it does not understand', () => {
    const text = '---\n# a comment\ntitle: Plan # trailing\n  stray line\n---\nBody';
    expect(parseFrontMatter(text).data).toEqual({ title: 'Plan' });
  });

  it('handles Windows line endings and a byte order mark', () => {
    const text = '﻿---\r\ntitle: Plan\r\ntags: [a]\r\n---\r\nLine one\r\nLine two';
    expect(parseFrontMatter(text)).toEqual({ data: { title: 'Plan', tags: ['a'] }, body: 'Line one\r\nLine two' });
  });

  it('treats an unclosed block as normal text', () => {
    const text = '---\ntitle: Plan\nno end';
    expect(parseFrontMatter(text)).toEqual({ data: {}, body: text });
  });

  it('accepts "..." as the closing line', () => {
    expect(parseFrontMatter('---\ntitle: X\n...\nBody').data).toEqual({ title: 'X' });
  });
});

describe('serializeFrontMatter', () => {
  it('writes plain values without quotes', () => {
    expect(serializeFrontMatter({ title: 'Project Atlas', tags: ['work', 'atlas'], pinned: true })).toBe(
      '---\ntitle: Project Atlas\ntags: [work, atlas]\npinned: true\n---\n',
    );
  });

  it('quotes values that YAML would misread', () => {
    const out = serializeFrontMatter({ title: 'Plan: v2 "draft"', other: 'true', date: '2026-01-01T00:00:00.000Z' });
    expect(out).toContain('title: "Plan: v2 \\"draft\\""');
    expect(out).toContain('other: "true"');
    expect(out).toContain('date: "2026-01-01T00:00:00.000Z"');
  });

  it('round-trips through parseFrontMatter', () => {
    const data = { title: '#1: «Ideas» & more', tags: ['a, b', 'c'], pinned: true };
    expect(parseFrontMatter(`${serializeFrontMatter(data)}Body`)).toEqual({ data, body: 'Body' });
  });
});

import { encodePathPart, linkAttachments } from './attachment-links';

describe('encodePathPart and linkAttachments', () => {
  it('bring an exported link with spaces, brackets and other letters back to its file', () => {
    for (const name of ['photo (1).png', 'Ünïcode ✓ it’s.png', "it's a (big) one!.png", 'a*b.png']) {
      const path = `attachments/00000000-0000-4000-8000-000000000001/${name}`;
      const href = path.split('/').map(encodePathPart).join('/');
      const found: string[] = [];
      linkAttachments(
        `![x](../${href})`,
        'Notebook/Note.md',
        (candidate) => {
          found.push(candidate);
          return candidate === path ? candidate : undefined;
        },
        () => 'id',
      );
      expect(found).toEqual([path]);
    }
  });

  it('leaves links to the web, to anchors and out of the archive alone', () => {
    const text = '![a](https://example.com/a.png) [b](#top) ![c](../../../outside.png)';
    expect(
      linkAttachments(
        text,
        'Note.md',
        () => 'x.png',
        () => 'id',
      ),
    ).toBe(text);
  });
});

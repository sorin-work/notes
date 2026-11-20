import { sniffType } from './sniff';

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));

describe('sniffType', () => {
  it('knows the allowed types by their first bytes, whatever the file is called', () => {
    expect(sniffType(bytes([0x89], 'PNG\r\n\x1a\n', 'rest'))).toEqual({ contentType: 'image/png', inline: true });
    expect(sniffType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ contentType: 'image/jpeg', inline: true });
    expect(sniffType(bytes('GIF89a...'))).toEqual({ contentType: 'image/gif', inline: true });
    expect(sniffType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toEqual({ contentType: 'image/webp', inline: true });
    expect(sniffType(bytes('%PDF-1.7\n'))).toEqual({ contentType: 'application/pdf', inline: false });
    expect(sniffType(bytes('Shopping list\nmilk'))).toEqual({
      contentType: 'text/plain; charset=utf-8',
      inline: false,
    });
  });

  it('refuses SVG, HTML and other markup, binaries it does not know, and text that is not UTF-8', () => {
    for (const refused of [
      bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      bytes('  \n<!DOCTYPE html><p>hi'),
      bytes('\uFEFF<?xml version="1.0"?>'),
      bytes('PK', [3, 4, 0, 0]),
      bytes('MZ', [0x90, 0]),
      bytes([0xc3, 0x28]),
      bytes('text with a', [0], 'nul'),
      bytes(),
    ]) {
      expect(sniffType(refused)).toBeNull();
    }
  });
});

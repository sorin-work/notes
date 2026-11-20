/** A type an attachment may have, decided from its first bytes. */
export interface SniffedType {
  contentType: string;
  /**
   * Whether the browser may show it in the page. Images only: everything
   * else is served as a download, so nothing in a file can run as part of
   * the app.
   */
  inline: boolean;
}

const startsWith = (bytes: Buffer, prefix: number[], at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * What the bytes are, among the types an attachment may have: PNG, JPEG,
 * GIF, WebP, PDF and plain UTF-8 text. Null for anything else, whatever the
 * name or the upload says. SVG and HTML are text that a browser would run,
 * so text that starts like markup is refused as well, and text is never
 * served inline anyway.
 */
export function sniffType(bytes: Buffer): SniffedType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return image('image/png');
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return image('image/jpeg');
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return image('image/gif');
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return image('image/webp');
  if (startsWith(bytes, ascii('%PDF-'))) return { contentType: 'application/pdf', inline: false };
  if (isPlainText(bytes)) return { contentType: 'text/plain; charset=utf-8', inline: false };
  return null;
}

function image(contentType: string): SniffedType {
  return { contentType, inline: true };
}

function isPlainText(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Markup of any kind, SVG and HTML among it, is not taken as text.
  return !/^﻿?\s*</.test(text);
}

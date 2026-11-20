/** A note title can be this long, in the editor and in the API. */
const MAX_TITLE_LENGTH = 200;
/** Longer than any address worth keeping. A longer one is left out, not cut: a cut address is another address. */
const MAX_URL_LENGTH = 2000;

export interface CaptureDraft {
  title: string;
  content: string;
  /** True when `url` was given and left out of the draft, so the page can say so. */
  urlDropped: boolean;
}

/** Line breaks and runs of spaces become one space, in the title and the address alike. */
function oneLine(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The address in the form it is written into the note, or null when it is
 * not a plain web address. `URL` does the checking, and its `href` has every
 * space and angle bracket percent-encoded, so nothing in it can end the
 * `<...>` it goes into.
 */
function webAddress(value: string): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // "https://bank.example@evil.example/" reads like one site and goes to another.
  if (url.username || url.password) return null;
  return /[\s<>]/.test(url.href) ? null : url.href;
}

/**
 * The note that `/capture?title=&url=` offers to save. Both values come
 * from whoever made the link, which can be any site, so neither is trusted
 * to be what it says:
 *
 * - The title only becomes the note's title, which is plain text wherever
 *   it is shown. It is never put into the Markdown of the note, not even as
 *   the text of the link, so it cannot add a link or an image of its own or
 *   show one address over another.
 * - The address goes in as an autolink on a line of its own. An autolink
 *   shows exactly the address it leads to, and nothing inside one is read
 *   as Markdown.
 * - Anything that is not a well-formed http or https address is left out.
 */
export function captureDraft(params: URLSearchParams): CaptureDraft {
  const title = oneLine(params.get('title')).slice(0, MAX_TITLE_LENGTH);
  const given = oneLine(params.get('url'));
  const address = webAddress(given);
  return {
    title,
    content: address ? `<${address}>\n\n` : '',
    urlDropped: given !== '' && address === null,
  };
}

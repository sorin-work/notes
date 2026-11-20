/** A note title can be this long, in the editor and in the API. */
const MAX_TITLE_LENGTH = 200;

export interface CaptureDraft {
  title: string;
  content: string;
}

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The note that `/capture?title=&url=` offers to save: the page's title, and
 * a Markdown link to it as the first line. Only http and https addresses
 * become links. Anything else, a `javascript:` address for one, is left as
 * the text it is.
 */
export function captureDraft(params: URLSearchParams): CaptureDraft {
  const title = (params.get('title') ?? '').replace(/\s+/g, ' ').trim();
  const url = (params.get('url') ?? '').trim();

  let content = '';
  if (isWebAddress(url)) {
    // Brackets in the text and angle brackets in the address would end the link early.
    const text = (title || url).replace(/[\\[\]]/g, '\\$&');
    const address = url.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\s/g, '%20');
    content = `[${text}](<${address}>)\n\n`;
  } else if (url) {
    content = `${url}\n\n`;
  }
  return { title: title.slice(0, MAX_TITLE_LENGTH), content };
}

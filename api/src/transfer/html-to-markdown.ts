import TurndownService from 'turndown';

/**
 * Turns the HTML of an imported note into Markdown. The HTML is parsed as
 * HTML, by the DOM that turndown brings, which knows the fixed set of HTML
 * entities and nothing else: no DTD is read and nothing is fetched.
 *
 * What comes out is plain Markdown. Elements without a Markdown form give
 * their text, and the ones with no text for a reader (scripts, styles,
 * embedded objects) give nothing, so no HTML of the source survives.
 * Evernote's attachments (en-media) and encrypted blocks (en-crypt) are left
 * out as well: attachments are a later item.
 */
/** What is used here of the DOM turndown parses into. The API is built without the DOM types. */
interface DomElement {
  nodeName: string;
  isBlock?: boolean;
  textContent: string | null;
  children: ArrayLike<DomElement>;
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<DomElement>;
}
const dom = (node: unknown) => node as DomElement;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  hr: '---',
  // An element with nothing in it gets this instead of its rule. Evernote's
  // check box is such an element and still has to come out as a box.
  blankReplacement: (_content, node) => {
    if (node.nodeName === 'EN-TODO') return todo(dom(node));
    return dom(node).isBlock ? '\n\n' : '';
  },
});

function todo(node: DomElement): string {
  return node.getAttribute('checked') === 'true' ? '[x] ' : '[ ] ';
}

turndown.remove(['script', 'style', 'head', 'title', 'object', 'embed', 'iframe', 'en-media', 'en-crypt'] as never);

// Evernote's check boxes, so that a checked one comes out as a ticked task.
turndown.addRule('evernote-todo', {
  filter: (node) => node.nodeName === 'EN-TODO',
  replacement: (_content, node) => todo(dom(node)),
});

// Tables as Markdown tables, one line per row, the first row as the header.
turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    // The DOM turndown brings has no iterable node lists, hence Array.from over children.
    const rows = Array.from(dom(node).getElementsByTagName('tr')).map((row) =>
      Array.from(row.children)
        .filter((cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD')
        .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')),
    );
    if (rows.length === 0) return '';
    const width = Math.max(...rows.map((row) => row.length), 1);
    const line = (cells: string[]) =>
      `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`;
    const [head, ...body] = rows;
    return `\n\n${[line(head), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n')}\n\n`;
  },
});

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * Evernote writes XHTML, where <en-todo/> is a whole element. Read as HTML it
 * would open an element that swallows the rest of the note, so such tags are
 * written out as an opening and a closing tag first.
 */
function closeSelfClosing(html: string): string {
  return html.replace(/<([a-zA-Z][\w:-]*)(\s[^<>]*?)?\s*\/>/g, (tag, name: string, attributes = '') =>
    VOID.has(name.toLowerCase()) ? tag : `<${name}${attributes}></${name}>`,
  );
}

export function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(closeSelfClosing(html))
    // Evernote spaces with &nbsp; all over. In Markdown that is just a space.
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

import { contentDisposition } from './attachments.controller';

describe('contentDisposition', () => {
  it('gives an ASCII name and the full one encoded the RFC 5987 way', () => {
    expect(contentDisposition('attachment', "it's (big)*!.pdf")).toBe(
      `attachment; filename="it's (big)*!.pdf"; filename*=UTF-8''it%27s%20%28big%29%2A%21.pdf`,
    );
    expect(contentDisposition('inline', 'Ünïcode "q".png')).toBe(
      `inline; filename="_n_code _q_.png"; filename*=UTF-8''%C3%9Cn%C3%AFcode%20%22q%22.png`,
    );
  });
});

import { Readable } from 'node:stream';
import { readBackupStream } from './backup-stream';

const at = '2026-01-01T00:00:00.000Z';
const note = (id: string) =>
  JSON.stringify({
    id,
    title: id,
    content: 'x',
    notebookId: null,
    tags: [],
    pinned: false,
    favorite: false,
    isTemplate: false,
    dailyDate: null,
    dailyReleased: false,
    revision: 0,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    versions: [],
  });
const file = JSON.stringify({ id: 'f1', noteId: 'a', fileName: 'x.png', createdAt: at, data: 'aGk=' });
const head = `"format":"notes-backup","version":1,"exportedAt":"${at}"`;
const sink = () => {
  const seen: string[] = [];
  return {
    seen,
    sink: {
      notebooks: async () => void seen.push('notebooks'),
      tags: async () => void seen.push('tags'),
      attachment: async (read: { id: string }) => void seen.push(`attachment ${read.id}`),
      note: async (read: { id: string }) => void seen.push(`note ${read.id}`),
    },
  };
};
/** A file in many small pieces, the way an upload comes in. */
const pieces = (text: string) => Readable.from(text.match(/[\s\S]{1,7}/g) ?? []);

describe('readBackupStream', () => {
  it('hands on each part as it is read, the notes one by one', async () => {
    const { seen, sink: handlers } = sink();
    const summary = await readBackupStream(
      pieces(
        `{${head},"preferences":null,"notebooks":[],"tags":[],"shareLinks":[],"attachments":[${file}],"notes":[${note('a')},${note('b')}],"later":{"x":[1]}}`,
      ),
      handlers,
    );
    expect(seen).toEqual(['notebooks', 'tags', 'attachment f1', 'note a', 'note b']);
    expect(summary).toMatchObject({ notes: 2, shareLinks: 0 });
  });

  it('refuses notes that come before the notebooks, and a file that stops in the middle', async () => {
    await expect(readBackupStream(pieces(`{${head},"notes":[${note('a')}]}`), sink().sink)).rejects.toThrow(
      /notes come before the notebooks/,
    );
    await expect(
      readBackupStream(pieces(`{${head},"notebooks":[],"notes":[${note('a')}`), sink().sink),
    ).rejects.toThrow(/ends too early/);
    await expect(
      readBackupStream(pieces(`{${head},"notebooks":[],"notes":[],"attachments":[${file}]}`), sink().sink),
    ).rejects.toThrow(/attachments come after the notes/);
    await expect(readBackupStream(pieces(`{"format":"other","notebooks":[]}`), sink().sink)).rejects.toThrow(
      /is not a notes-backup file/,
    );
  });

  it('stops reading a note that is larger than any the app can hold, before it is all in memory', async () => {
    let sent = 0;
    // An endless string, sent a megabyte at a time.
    const endless = new Readable({
      read() {
        if (sent === 0) this.push(`{${head},"notebooks":[],"notes":[{"content":"`);
        sent++;
        this.push('x'.repeat(1024 * 1024));
      },
    });
    await expect(readBackupStream(endless, sink().sink)).rejects.toThrow(/notes\[0\] is larger than anything/);
    // The text of a note and fifty versions, about 51 MB, and not much more.
    expect(sent).toBeLessThan(60);
  });
});

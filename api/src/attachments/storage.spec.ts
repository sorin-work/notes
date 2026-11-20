import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../config/config';
import { AttachmentStorage } from './storage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('AttachmentStorage', () => {
  let dir: string;
  let storage: AttachmentStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attachments-'));
    storage = new AttachmentStorage({ attachmentsDir: dir } as AppConfig);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('keeps a file under its id only, and will not take any other name', async () => {
    await storage.write(ID(1), Buffer.from('hello'));
    expect((await storage.read(ID(1))).toString()).toBe('hello');
    expect(await readdir(dir)).toEqual([ID(1)]);
    await expect(storage.write('../escape', Buffer.from('x'))).rejects.toThrow('Not an attachment id');
  });

  it('sweeps old files that have no row, and leaves new ones and other files alone', async () => {
    const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    for (const n of [1, 2, 3]) await storage.write(ID(n), Buffer.from('x'));
    await writeFile(join(dir, 'README'), 'not ours');
    for (const name of [ID(1), ID(2), 'README']) await utimes(join(dir, name), old, old);

    const removed = await storage.sweep(async (ids) => new Set(ids.filter((id) => id === ID(1))), 60 * 60 * 1000);

    expect(removed).toBe(1);
    // 1 has a row, 2 has none and is old, 3 has none but was just written.
    expect((await readdir(dir)).sort()).toEqual([ID(1), ID(3), 'README'].sort());
  });
});

import { Inject, Injectable } from '@nestjs/common';
import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config/config';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The files of attachments, in one folder, each under its attachment's id.
 * No name that came with an upload is ever part of a path.
 */
@Injectable()
export class AttachmentStorage {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private path(id: string): string {
    if (!ID.test(id)) throw new Error(`Not an attachment id: ${id}`);
    return join(this.config.attachmentsDir, id);
  }

  /** Writes the file in full under a temporary name first, so a half-written file is never served. */
  async write(id: string, bytes: Buffer): Promise<void> {
    const target = this.path(id);
    await mkdir(this.config.attachmentsDir, { recursive: true, mode: 0o700 });
    const partial = join(this.config.attachmentsDir, `.${id}.partial`);
    await writeFile(partial, bytes, { mode: 0o600 });
    await rename(partial, target);
  }

  open(id: string): ReadStream {
    return createReadStream(this.path(id));
  }

  read(id: string): Promise<Buffer> {
    return readFile(this.path(id));
  }

  async remove(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => rm(this.path(id), { force: true })));
  }

  /**
   * Removes the files that `known` does not claim, once they are older than
   * `graceMs`: an upload writes its file just before its row, and that file
   * must not go in between. Answers how many were removed.
   */
  async sweep(known: (ids: string[]) => Promise<Set<string>>, graceMs: number, now = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.config.attachmentsDir);
    } catch {
      return 0;
    }
    const candidates: string[] = [];
    for (const name of names) {
      const id = name.startsWith('.') && name.endsWith('.partial') ? name.slice(1, -'.partial'.length) : name;
      if (!ID.test(id)) continue;
      const info = await stat(join(this.config.attachmentsDir, name)).catch(() => null);
      if (info && now - info.mtimeMs > graceMs) candidates.push(name);
    }
    if (candidates.length === 0) return 0;
    const kept = await known(candidates.filter((name) => ID.test(name)));
    const gone = candidates.filter((name) => !kept.has(name));
    await Promise.all(gone.map((name) => rm(join(this.config.attachmentsDir, name), { force: true })));
    return gone.length;
  }
}

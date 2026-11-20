import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ParsedNote } from './prose';
import type { Mention } from './wikilinks';

/** What a worker is asked: find the mention of `title` in `text` that can be linked, or the one at `at`. */
export interface ParseJob {
  id: number;
  text: string;
  title: string;
  at?: { offset: number; text: string };
  /** The tree of `text` from an earlier parse, so it is not parsed again. */
  parsed?: ParsedNote | null;
}

/** The tree of the note (null when it cannot be parsed) and the mention, if there is one. */
export interface ParseAnswer {
  id: number;
  parsed: ParsedNote | null;
  mention: (Mention & { linked: string }) | null;
}

/** How many workers parse at the same time. */
export const PARSE_WORKERS = 2;
/** How long one job may take. A worker that takes longer is stopped and replaced. */
export const PARSE_DEADLINE_MS = 500;

/**
 * Under Jest the worker's own file is TypeScript. Then it is compiled on the
 * way in, the way ts-jest does it for the tests. A built API has the
 * compiled file next to this one and does not need this.
 */
const TYPESCRIPT_BOOTSTRAP = `
const { workerData } = require('node:worker_threads');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  });
  module._compile(outputText, file);
};
require(workerData);
`;

interface Slot {
  worker: Worker;
  /** Loading the parser takes a moment. No job is given to a worker before it says it is ready. */
  ready: boolean;
  job: { id: number; resolve(answer: ParseAnswer | 'timeout'): void; timer: NodeJS.Timeout } | null;
}

interface Waiting {
  job: Omit<ParseJob, 'id'>;
  resolve(answer: ParseAnswer | 'timeout'): void;
}

/**
 * A small pool of worker threads for the Markdown parser. The parser can
 * take seconds, or for some input minutes, and on the main thread that
 * would hold up every other request. Each job gets PARSE_DEADLINE_MS: past
 * it the worker is terminated, a new one takes its place, and the job
 * answers "timeout". Jobs beyond the number of workers wait their turn.
 */
@Injectable()
export class ParsePool implements OnModuleInit, OnModuleDestroy {
  deadline = PARSE_DEADLINE_MS;
  private readonly slots: Slot[] = [];
  private readonly waiting: Waiting[] = [];
  private nextId = 1;
  private closed = false;

  /** Starts the workers with the app, so that the first request does not wait for the parser to load. */
  onModuleInit(): void {
    this.dispatch();
  }

  /** Resolves once every worker has loaded the parser. */
  async ready(): Promise<void> {
    this.dispatch();
    while (!this.closed && this.slots.some((slot) => !slot.ready)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  run(job: Omit<ParseJob, 'id'>): Promise<ParseAnswer | 'timeout'> {
    return new Promise((resolve) => {
      this.waiting.push({ job, resolve });
      this.dispatch();
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    for (const waiting of this.waiting.splice(0)) waiting.resolve('timeout');
    await Promise.all(
      this.slots.splice(0).map((slot) => {
        if (slot.job) {
          clearTimeout(slot.job.timer);
          slot.job.resolve('timeout');
        }
        return slot.worker.terminate();
      }),
    );
  }

  private dispatch(): void {
    while (!this.closed && this.slots.length < PARSE_WORKERS) this.spawn();
    while (!this.closed && this.waiting.length > 0) {
      const slot = this.slots.find((candidate) => candidate.ready && candidate.job === null);
      if (!slot) return;
      const { job, resolve } = this.waiting.shift()!;
      const id = this.nextId++;
      const timer = setTimeout(() => this.replace(slot, 'timeout'), this.deadline);
      slot.job = { id, resolve, timer };
      slot.worker.postMessage({ ...job, id });
    }
  }

  private spawn(): Slot {
    const compiled = join(__dirname, 'parse-worker.js');
    const worker = existsSync(compiled)
      ? new Worker(compiled)
      : new Worker(TYPESCRIPT_BOOTSTRAP, { eval: true, workerData: join(__dirname, 'parse-worker.ts') });
    // The pool keeps no process alive by itself.
    worker.unref();
    const slot: Slot = { worker, ready: false, job: null };
    worker.on('message', (answer: ParseAnswer | 'ready') => {
      if (answer === 'ready') {
        slot.ready = true;
        this.dispatch();
        return;
      }
      if (slot.job?.id !== answer.id) return;
      clearTimeout(slot.job.timer);
      const { resolve } = slot.job;
      slot.job = null;
      resolve(answer);
      this.dispatch();
    });
    // A worker that fails is replaced like one that ran out of time.
    worker.on('error', () => this.replace(slot, 'timeout'));
    this.slots.push(slot);
    return slot;
  }

  /** Stops the worker of `slot`, answers its job, and starts a new worker in its place. */
  private replace(slot: Slot, answer: 'timeout'): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) return;
    this.slots.splice(index, 1);
    if (slot.job) {
      clearTimeout(slot.job.timer);
      slot.job.resolve(answer);
      slot.job = null;
    }
    void slot.worker.terminate();
    if (!this.closed) this.dispatch();
  }
}

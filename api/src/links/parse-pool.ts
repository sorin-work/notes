import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ParsedNote, TaskItem } from './prose';
import type { Mention } from './wikilinks';

/**
 * What a worker is asked: find the mention of `title` in `text` that can be
 * linked, or the one at `at`. With `kind: 'tasks'`, read the task list items
 * of `text` instead.
 */
export interface ParseJob {
  id: number;
  kind?: 'mention' | 'tasks';
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
  /** For a tasks job: the tasks, or null when the note cannot be parsed. */
  tasks?: TaskItem[] | null;
}

/** How many workers parse at the same time. */
export const PARSE_WORKERS = 2;
/** How long one job may take in a worker. A worker that takes longer is stopped and replaced. */
export const PARSE_DEADLINE_MS = 500;
/**
 * How long one job may take in all, waiting for a worker included, and a
 * worker that is still loading. Past it the job answers "unavailable".
 */
export const TOTAL_DEADLINE_MS = 2_000;
/** How many jobs may wait for a worker. One more answers "busy" at once. */
export const MAX_WAITING = 32;
/** Memory for one worker. A parse that needs more stops that worker, which is replaced. */
const WORKER_MEMORY_MB = 256;
/** A worker that fails to load is started again after this, doubled each time it fails in a row, up to the second number. */
const RESTART_DELAY_MS = 100;
const MAX_RESTART_DELAY_MS = 10_000;

/** "timeout": the parse ran out of time. "unavailable": no worker got to it in time. "busy": too many jobs wait already. */
export type ParseResult = ParseAnswer | 'timeout' | 'unavailable' | 'busy';

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
  job: { id: number; resolve(answer: ParseResult): void; timer: NodeJS.Timeout } | null;
}

interface Waiting {
  job: Omit<ParseJob, 'id'>;
  resolve(answer: ParseResult): void;
  /** When the job has to have been answered, by the clock of performance.now. */
  due: number;
  expiry: NodeJS.Timeout;
}

/**
 * A small pool of worker threads for the Markdown parser. The parser can
 * take seconds, or for some input minutes, and on the main thread that
 * would hold up every other request. Each job gets PARSE_DEADLINE_MS: past
 * it the worker is terminated, a new one takes its place, and the job
 * answers "timeout". Jobs beyond the number of workers wait their turn, at
 * most MAX_WAITING of them, and every job is answered within
 * TOTAL_DEADLINE_MS, waiting included.
 */
@Injectable()
export class ParsePool implements OnModuleInit, OnModuleDestroy {
  deadline = PARSE_DEADLINE_MS;
  totalDeadline = TOTAL_DEADLINE_MS;
  private readonly slots: Slot[] = [];
  private readonly waiting: Waiting[] = [];
  private nextId = 1;
  private closed = false;
  /** Workers that failed to load in a row, and the timer of the next start after such a failure. */
  private failures = 0;
  private restart: NodeJS.Timeout | null = null;

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

  run(job: Omit<ParseJob, 'id'>): Promise<ParseResult> {
    if (this.closed) return Promise.resolve('unavailable');
    if (this.waiting.length >= MAX_WAITING) return Promise.resolve('busy');
    return new Promise((resolve) => {
      const waiting: Waiting = {
        job,
        resolve,
        due: performance.now() + this.totalDeadline,
        expiry: setTimeout(() => {
          const index = this.waiting.indexOf(waiting);
          if (index === -1) return;
          this.waiting.splice(index, 1);
          resolve('unavailable');
        }, this.totalDeadline),
      };
      this.waiting.push(waiting);
      this.dispatch();
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    if (this.restart) clearTimeout(this.restart);
    for (const waiting of this.waiting.splice(0)) {
      clearTimeout(waiting.expiry);
      waiting.resolve('unavailable');
    }
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
    while (!this.closed && this.restart === null && this.slots.length < PARSE_WORKERS) this.spawn();
    while (!this.closed && this.waiting.length > 0) {
      const slot = this.slots.find((candidate) => candidate.ready && candidate.job === null);
      if (!slot) return;
      const { job, resolve, due, expiry } = this.waiting.shift()!;
      clearTimeout(expiry);
      // Too little time left for a parse to finish within the whole deadline.
      if (due - performance.now() < this.deadline) {
        resolve('unavailable');
        continue;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => this.replace(slot, 'timeout'), this.deadline);
      slot.job = { id, resolve, timer };
      slot.worker.postMessage({ ...job, id });
    }
  }

  private spawn(): Slot {
    const compiled = join(__dirname, 'parse-worker.js');
    const resourceLimits = { maxOldGenerationSizeMb: WORKER_MEMORY_MB };
    const worker = existsSync(compiled)
      ? new Worker(compiled, { resourceLimits })
      : new Worker(TYPESCRIPT_BOOTSTRAP, {
          eval: true,
          workerData: join(__dirname, 'parse-worker.ts'),
          resourceLimits,
        });
    // The pool keeps no process alive by itself.
    worker.unref();
    const slot: Slot = { worker, ready: false, job: null };
    worker.on('message', (answer: ParseAnswer | 'ready') => {
      if (answer === 'ready') {
        slot.ready = true;
        this.failures = 0;
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
    // A worker that fails, runs out of memory or stops is replaced like one that ran out of time.
    worker.on('error', () => this.replace(slot, 'timeout'));
    worker.on('exit', () => this.replace(slot, 'timeout'));
    this.slots.push(slot);
    return slot;
  }

  /**
   * Stops the worker of `slot`, answers its job, and starts a new worker in
   * its place. A worker that never got as far as loading the parser is
   * started again only after a pause that grows with each failure, so a
   * broken install does not start workers in a loop.
   */
  private replace(slot: Slot, answer: 'timeout'): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) return;
    this.slots.splice(index, 1);
    if (!slot.ready && !this.closed && this.restart === null) {
      const delay = Math.min(RESTART_DELAY_MS * 2 ** this.failures, MAX_RESTART_DELAY_MS);
      this.failures++;
      this.restart = setTimeout(() => {
        this.restart = null;
        this.dispatch();
      }, delay);
      this.restart.unref();
    }
    if (slot.job) {
      clearTimeout(slot.job.timer);
      slot.job.resolve(answer);
      slot.job = null;
    }
    void slot.worker.terminate();
    if (!this.closed) this.dispatch();
  }
}

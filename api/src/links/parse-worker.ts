import { parentPort } from 'node:worker_threads';
import { parseNote, parseTasks } from './prose';
import type { ParseAnswer, ParseJob } from './parse-pool';
import { linkableMention } from './wikilinks';

// Runs in a worker thread of ParsePool: every Markdown parse for mentions
// and tasks happens here, never on the thread that answers requests.
parentPort?.on('message', (job: ParseJob) => {
  if (job.kind === 'tasks') {
    const answer: ParseAnswer = { id: job.id, parsed: null, mention: null, tasks: parseTasks(job.text) };
    parentPort?.postMessage(answer);
    return;
  }
  const parsed = job.parsed !== undefined ? job.parsed : parseNote(job.text);
  const mention = parsed ? linkableMention(job.text, job.title, job.at, parsed) : null;
  const answer: ParseAnswer = { id: job.id, parsed, mention };
  parentPort?.postMessage(answer);
});
// The modules are loaded: the pool may now start the clock on jobs.
parentPort?.postMessage('ready');

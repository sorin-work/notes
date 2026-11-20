import { MAX_WAITING, PARSE_DEADLINE_MS, ParseAnswer, ParsePool, ParseResult } from './parse-pool';

/** The answer of a job that was parsed, or a failed test. */
function parsed(result: ParseResult): ParseAnswer {
  if (typeof result === 'string') throw new Error(`the job answered "${result}"`);
  return result;
}

// The inputs of the review that held the parser for seconds to a minute, each under 100,000 characters.
const N = 99_990;
const fill = (piece: string) => piece.repeat(Math.floor(N / piece.length)).slice(0, N - 6) + ' Atlas';
const backticks = () => {
  let text = '';
  for (let run = 1; text.length < N - 500; run++) text += `${'`'.repeat(run)} `;
  return `${text} Atlas`;
};
const HOSTILE: [string, string][] = [
  ['quotes and lists', fill('> - > - Atlas\n')],
  ['stars and underscores', fill('*_')],
  ['quote marks without spaces', fill('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> Atlas\n')],
  ['growing backtick runs', backticks()],
];

describe('ParsePool', () => {
  const pool = new ParsePool();
  // Under Jest a new worker compiles its TypeScript first, which can take longer than the app's whole deadline.
  pool.totalDeadline = 10_000;
  afterAll(() => pool.onModuleDestroy());

  it('parses in a worker and finds the mention', async () => {
    const answer = await pool.run({ text: 'We met about the atlas.', title: 'Atlas' });
    expect(answer).toMatchObject({ mention: { start: 17, end: 22, linked: 'We met about the [[atlas]].' } });
    expect(parsed(answer).parsed?.prose.length).toBeGreaterThan(0);
  });

  it.each(HOSTILE)(
    'gives up on %s within its deadline, and the thread that answers requests is never held up',
    async (_name, text) => {
      // A tick every 20 ms on this thread: with the parse on it, there would be none for seconds.
      let longest = 0;
      let last = Date.now();
      const ticker = setInterval(() => {
        longest = Math.max(longest, Date.now() - last);
        last = Date.now();
      }, 20);
      const started = Date.now();
      const answer = await pool.run({ text, title: 'Atlas' });
      const took = Date.now() - started;
      clearInterval(ticker);

      // Either the parse finished in time or the worker was stopped. Nothing is found either way here.
      expect(['timeout', 'parsed']).toContain(typeof answer === 'string' ? answer : 'parsed');
      if (answer !== 'timeout') expect(parsed(answer).mention).toBeNull();
      expect(took).toBeLessThan(PARSE_DEADLINE_MS + 1_500);
      expect(longest).toBeLessThan(200);
      // A new worker took the place of a stopped one, and the next job is answered.
      await expect(pool.run({ text: 'The atlas.', title: 'Atlas' })).resolves.toMatchObject({ mention: { start: 4 } });
    },
  );

  it('answers other jobs while one is stuck', async () => {
    // Both workers up first: one that replaced a stopped one takes a moment to load the parser.
    await pool.ready();
    const stuck = pool.run({ text: HOSTILE[0][1], title: 'Atlas' });
    const started = Date.now();
    await expect(pool.run({ text: 'An atlas.', title: 'Atlas' })).resolves.toMatchObject({ mention: { start: 3 } });
    expect(Date.now() - started).toBeLessThan(PARSE_DEADLINE_MS);
    await stuck;
  });

  it('does not parse again when it is given the tree', async () => {
    const first = parsed(await pool.run({ text: 'The atlas.', title: 'Atlas' }));
    const again = await pool.run({ text: 'The atlas.', title: 'Atlas', parsed: first.parsed });
    expect(again).toMatchObject({ parsed: first.parsed, mention: { start: 4 } });
  });
});

describe('ParsePool when it cannot keep up', () => {
  const pool = new ParsePool();
  afterAll(() => pool.onModuleDestroy());

  it('answers every job within its whole deadline, waiting included, and turns jobs away when too many wait', async () => {
    await pool.ready();
    pool.totalDeadline = 800;
    const started = Date.now();
    // Two stuck jobs hold both workers for their 500 ms, and a new worker then has to load.
    const jobs = [
      pool.run({ text: HOSTILE[0][1], title: 'Atlas' }),
      pool.run({ text: HOSTILE[1][1], title: 'Atlas' }),
      // The two above went to the workers. These wait, as many as may.
      ...Array.from({ length: MAX_WAITING }, () => pool.run({ text: 'The atlas.', title: 'Atlas' })),
    ];
    // The queue is full: the next one is answered at once.
    await expect(pool.run({ text: 'The atlas.', title: 'Atlas' })).resolves.toBe('busy');
    const answers = await Promise.all(jobs);
    expect(Date.now() - started).toBeLessThan(800 + 300);
    expect(answers.slice(0, 2)).toEqual(['timeout', 'timeout']);
    // The rest found no worker with time enough left.
    expect(answers.slice(2).every((answer) => answer === 'unavailable')).toBe(true);
  });
});

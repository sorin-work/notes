export interface DemoVersion {
  /** Days before the note's last edit. */
  daysEarlier: number;
  title?: string;
  content: string;
}

export interface DemoNote {
  title: string;
  /** ["Work"] or ["Work", "Project Atlas"]; empty for notes outside a notebook. */
  notebook: string[];
  tags?: string[];
  pinned?: boolean;
  favorite?: boolean;
  createdDaysAgo: number;
  updatedDaysAgo: number;
  trashedDaysAgo?: number;
  shared?: { views: number };
  versions?: DemoVersion[];
  content: string;
}

export const DEMO_NOTEBOOKS: { name: string; children?: string[] }[] = [
  { name: 'Work', children: ['Project Atlas', 'Meetings'] },
  { name: 'Personal', children: ['Recipes', 'Travel'] },
  { name: 'Reading' },
  { name: 'Learning', children: ['Rust'] },
];

const atlasOverview = `# Project Atlas

Atlas replaces the old reporting exports with a self-service dashboard for
the operations team. Target for the first release is **end of Q2**.

## Goals

- Operations can build their own weekly reports without asking engineering
- Report data is at most 15 minutes old
- The old CSV export job can be switched off

## People

- Priya (product) owns the roadmap
- Tomás and I on the backend, Mei on the frontend
- Weekly sync on Tuesdays, notes in [[Atlas weekly sync]]

## Open questions

1. Do we need row-level permissions for the first release? See [[Atlas data model]].
2. Which charts are must-haves? Priya is collecting examples.

Decisions so far are in [[Atlas decision log]].`;

const atlasDataModel = `# Atlas data model

The reporting tables are fed by change-data-capture from the orders
database into a separate Postgres instance.

| Table           | Grain                 | Refresh   |
| --------------- | --------------------- | --------- |
| \`fact_orders\`   | one row per order     | 5 minutes |
| \`fact_shipments\`| one row per parcel    | 5 minutes |
| \`dim_customer\`  | one row per customer  | hourly    |
| \`dim_warehouse\` | one row per warehouse | daily     |

## Row-level permissions

Regional managers should only see their own warehouses. Postgres row level
security would do it, but it makes the query planner's job harder:

\`\`\`sql
CREATE POLICY region_only ON fact_orders
  USING (warehouse_id = ANY (current_setting('atlas.warehouses')::uuid[]));
\`\`\`

We agreed to leave this out of the first release, see [[Atlas decision log]].

Related: [[Project Atlas]]`;

const atlasDecisions = `# Atlas decision log

Short entries, newest first. Each one says what we decided and why.

### No row-level permissions in v1

Only six people will use the first release and all of them may see every
region. Revisit before the regional rollout. Discussed in [[Atlas weekly sync]].

### Postgres, not a warehouse product

Data volume is small (about 40 GB) and the team already runs Postgres.
A warehouse would add a second bill and a new tool to learn.

### Charts with Vega-Lite

The specs are JSON, so saved reports are just rows in a table.

Back to [[Project Atlas]].`;

const atlasSync = `# Atlas weekly sync

## Tuesday

- Mei demoed the report builder, drag and drop works
- CDC lag spiked to 40 minutes on Friday, Tomás is adding an alert
- Priya: the ops team wants exports to Excel. We said CSV first.

**Actions**

- [x] Alert when CDC lag is over 15 minutes (Tomás)
- [ ] Draft the permissions proposal (me)
- [ ] Collect five example reports from ops (Priya)

## The week before

- Agreed on the table list in [[Atlas data model]]
- Release date stays end of Q2

See [[Project Atlas]] for the overview.`;

const oneOnOne = `# 1:1 with Dana

Running notes, newest at the top.

## This month

- Talked about taking over the on-call rotation schedule
- Dana suggested I write up the Atlas architecture for the wider team
- Feedback: be more explicit in code reviews about what is blocking and
  what is a suggestion

## Last month

- Conference budget approved, booked the ticket
- Goal for next quarter: lead the Atlas regional rollout

Related: [[Project Atlas]], [[Career goals]]`;

const retro = `# Sprint retro notes

**Went well**

- Shipped the report builder a day early
- Pairing sessions between frontend and backend

**Could be better**

- Too many meetings on Wednesdays
- Flaky end-to-end tests blocked two merges

**We will try**

- No-meeting Wednesday afternoons
- Quarantine flaky tests instead of retrying them`;

const sourdough = `# Sourdough bread

Makes one loaf. Start the evening before.

## Ingredients

- 100 g active starter
- 375 g water
- 500 g bread flour (450 g white, 50 g wholemeal)
- 10 g salt

## Method

1. Mix starter, 350 g water and the flour. Rest 45 minutes.
2. Add the salt and the remaining 25 g water, squeeze it in.
3. Four sets of stretch and folds, 30 minutes apart.
4. Bulk ferment until about 50% bigger, 4–5 hours at 24 °C.
5. Shape, put in a floured banneton, overnight in the fridge.
6. Bake in a Dutch oven at 250 °C: 20 minutes lid on, 25 minutes lid off.

> Wait at least an hour before cutting it. It is still cooking inside.

Keep the starter going with [[Starter feeding schedule]].`;

const sourdoughV1 = `# Sourdough bread

Makes one loaf.

- 100 g starter
- 350 g water
- 500 g flour
- 10 g salt

Mix, fold every 30 minutes, overnight in the fridge, bake at 250 °C.`;

const starter = `# Starter feeding schedule

- **Daily (on the counter):** discard all but 50 g, feed 50 g flour and 50 g water
- **Weekly (in the fridge):** feed on Sunday, use or discard by Thursday
- Ready to bake when it has doubled in 4–6 hours

Used for [[Sourdough bread]].`;

const lentilSoup = `# Red lentil soup

Quick weeknight dinner, about 30 minutes.

- 1 onion, 2 carrots, 2 cloves garlic
- 1 tbsp cumin, 1 tsp smoked paprika
- 250 g red lentils
- 1.2 l vegetable stock
- Juice of a lemon

Soften the vegetables, add spices for a minute, then lentils and stock.
Simmer 20 minutes and blend half of it. Lemon juice at the end.`;

const lisbon = `# Lisbon trip

## Plan

- [x] Flights booked
- [x] Hotel in Alfama, 4 nights
- [ ] Book the Sintra day trip
- [ ] Restaurant for the last evening

## Places

- Miradouro da Senhora do Monte for the sunset
- LX Factory on Sunday
- Pastéis de Belém, go early to avoid the queue
- Tram 28, but only first thing in the morning

## Packing

Use the [[Packing list]] and add a light rain jacket.`;

const packing = `# Packing list

**Always**

- Passport / ID
- Phone charger and adapter
- Headphones
- Medication

**Clothes**

- One outfit per day, minus one
- Comfortable walking shoes
- A warm layer

**Before leaving**

- Water the plants
- Take the bins out
- Turn the heating down`;

const deepWork = `# Deep Work (Cal Newport)

Rating: ★★★★☆

The argument: the ability to focus without distraction on hard problems is
getting rarer and more valuable at the same time.

## Ideas worth keeping

- **Time blocking.** Plan every minute of the working day, and re-plan when
  it goes wrong, which it will.
- **Shutdown ritual.** Finish the day by writing down what is open, so it
  stops living in your head.
- Treat shallow work (email, chat) as something to batch, not to react to.

## How I am using it

Two 90-minute blocks a day without chat, see [[Weekly review template]].

Also related: [[Atomic Habits]]`;

const atomicHabits = `# Atomic Habits (James Clear)

Rating: ★★★☆☆

Useful framework, could have been half as long.

- Make it obvious, attractive, easy and satisfying
- "You do not rise to the level of your goals, you fall to the level of
  your systems."
- Habit stacking: after I pour my coffee, I write three lines in my journal

Pairs well with [[Deep Work]].`;

const readingList = `# Reading list

## Now

- [[Deep Work]] — finishing the last chapter

## Next

- *The Pragmatic Programmer*, 20th anniversary edition
- *Designing Data-Intensive Applications*, again
- *Four Thousand Weeks*

## Done this year

- [[Atomic Habits]]
- *The Manager's Path*`;

const rustOwnership = `# Rust ownership

Every value has exactly one owner. When the owner goes out of scope, the
value is dropped.

\`\`\`rust
let a = String::from("hello");
let b = a;          // a is moved into b
// println!("{a}"); // does not compile: a was moved
\`\`\`

## Borrowing

- Any number of shared references (\`&T\`) **or** one mutable reference (\`&mut T\`)
- References must not outlive the value they point to

Lifetimes are the compiler's way of checking that second rule. Writing
\`[[like this]]\` inside code is not a link.

Next: [[Rust error handling]]`;

const rustErrors = `# Rust error handling

- \`Result<T, E>\` for errors that can be handled, \`panic!\` for bugs
- The \`?\` operator returns early with the error, converting it with \`From\`
- \`thiserror\` for library error types, \`anyhow\` in applications

\`\`\`rust
fn read_config(path: &Path) -> anyhow::Result<Config> {
    let text = fs::read_to_string(path).context("reading config")?;
    Ok(toml::from_str(&text)?)
}
\`\`\`

Back to [[Rust ownership]].`;

const sqlIndexes = `# Postgres index cheat sheet

| Index  | Good for                                    |
| ------ | ------------------------------------------- |
| B-tree | equality and ranges, the default            |
| GIN    | full-text search, arrays, \`jsonb\` contains  |
| GiST   | geometry, ranges, nearest neighbour         |
| BRIN   | huge tables where values follow insert order |

- \`EXPLAIN (ANALYZE, BUFFERS)\` before and after
- Multi-column indexes: equality columns first, then the range column
- A partial index (\`WHERE deleted_at IS NULL\`) keeps it small

Used this for the [[Atlas data model]].`;

const weeklyReview = `# Weekly review template

Friday afternoon, 30 minutes.

1. Empty the inbox, the desk and the downloads folder
2. Look at the calendar: last week, then the next two weeks
3. Go through every project note and write down the next action
4. Pick the three things that would make next week a good week
5. Block time for them

## Questions

- What did I finish?
- What is stuck, and why?
- What am I avoiding?

Inspired by [[Deep Work]].`;

const careerGoals = `# Career goals

## This year

- Lead a project end to end (Atlas counts)
- Give one internal talk
- Mentor a new joiner

## Skills

- Distributed systems: read DDIA again, take notes in [[Reading list]]
- Get comfortable with Rust, see [[Rust ownership]]`;

const ideas = `# Ideas

Unsorted. Move anything that turns into a project into its own note.

- A small CLI that turns meeting notes into calendar follow-ups
- Write about how we run the weekly sync for [[Project Atlas]]
- Cook through one cuisine a month (started with [[Red lentil soup]])
- Home server: replace the old NAS`;

const welcome = `# Welcome to notes

A few things to try:

- **Write in Markdown.** The preview updates as you type. Switch between
  edit, split and preview with the buttons above the editor (or Ctrl+E).
- **Link notes** by typing \`[[\` and choosing a title, for example
  [[Project Atlas]]. Notes that link here show up under *Backlinks*.
- **Organise** with notebooks (one level of nesting), tags, pins and
  favourites.
- **Search** everything from the search box. Words match as prefixes,
  so "meet" finds "meeting".
- **History:** versions are saved as you edit, at most every ten minutes.
  Open *History* to look at or restore an older one.
- **Share** a read-only link to a single note, and turn it off again at
  any time.

Deleted notes stay in the trash for 30 days.`;

export const DEMO_NOTES: DemoNote[] = [
  {
    title: 'Welcome to notes',
    notebook: [],
    pinned: true,
    createdDaysAgo: 330,
    updatedDaysAgo: 330,
    content: welcome,
  },
  {
    title: 'Project Atlas',
    notebook: ['Work', 'Project Atlas'],
    tags: ['atlas', 'planning'],
    pinned: true,
    favorite: true,
    createdDaysAgo: 120,
    updatedDaysAgo: 3,
    content: atlasOverview,
    versions: [
      {
        daysEarlier: 40,
        content: `# Project Atlas\n\nSelf-service reporting for operations.\n\n## Goals\n\n- Operations can build their own reports\n- Switch off the CSV export job`,
      },
      {
        daysEarlier: 12,
        content: `# Project Atlas\n\nAtlas replaces the old reporting exports with a self-service dashboard for\nthe operations team.\n\n## Goals\n\n- Operations can build their own weekly reports without asking engineering\n- Report data is at most 15 minutes old\n- The old CSV export job can be switched off\n\nWeekly sync notes in [[Atlas weekly sync]].`,
      },
    ],
  },
  {
    title: 'Atlas data model',
    notebook: ['Work', 'Project Atlas'],
    tags: ['atlas', 'postgres'],
    createdDaysAgo: 110,
    updatedDaysAgo: 9,
    content: atlasDataModel,
  },
  {
    title: 'Atlas decision log',
    notebook: ['Work', 'Project Atlas'],
    tags: ['atlas', 'decisions'],
    favorite: true,
    createdDaysAgo: 100,
    updatedDaysAgo: 6,
    content: atlasDecisions,
  },
  {
    title: 'Atlas weekly sync',
    notebook: ['Work', 'Meetings'],
    tags: ['atlas', 'meeting'],
    createdDaysAgo: 98,
    updatedDaysAgo: 1,
    content: atlasSync,
    shared: { views: 7 },
  },
  {
    title: '1:1 with Dana',
    notebook: ['Work', 'Meetings'],
    tags: ['meeting'],
    createdDaysAgo: 200,
    updatedDaysAgo: 8,
    content: oneOnOne,
  },
  {
    title: 'Sprint retro notes',
    notebook: ['Work', 'Meetings'],
    tags: ['meeting', 'team'],
    createdDaysAgo: 45,
    updatedDaysAgo: 15,
    content: retro,
  },
  {
    title: 'Sourdough bread',
    notebook: ['Personal', 'Recipes'],
    tags: ['baking', 'recipe'],
    favorite: true,
    createdDaysAgo: 260,
    updatedDaysAgo: 20,
    content: sourdough,
    shared: { views: 23 },
    versions: [{ daysEarlier: 90, content: sourdoughV1 }],
  },
  {
    title: 'Starter feeding schedule',
    notebook: ['Personal', 'Recipes'],
    tags: ['baking'],
    createdDaysAgo: 255,
    updatedDaysAgo: 120,
    content: starter,
  },
  {
    title: 'Red lentil soup',
    notebook: ['Personal', 'Recipes'],
    tags: ['recipe', 'quick'],
    createdDaysAgo: 75,
    updatedDaysAgo: 75,
    content: lentilSoup,
  },
  {
    title: 'Lisbon trip',
    notebook: ['Personal', 'Travel'],
    tags: ['travel', 'todo'],
    pinned: true,
    createdDaysAgo: 30,
    updatedDaysAgo: 2,
    content: lisbon,
  },
  {
    title: 'Packing list',
    notebook: ['Personal', 'Travel'],
    tags: ['travel', 'checklist'],
    createdDaysAgo: 300,
    updatedDaysAgo: 30,
    content: packing,
  },
  {
    title: 'Deep Work',
    notebook: ['Reading'],
    tags: ['books', 'productivity'],
    favorite: true,
    createdDaysAgo: 60,
    updatedDaysAgo: 10,
    content: deepWork,
  },
  {
    title: 'Atomic Habits',
    notebook: ['Reading'],
    tags: ['books', 'productivity'],
    createdDaysAgo: 150,
    updatedDaysAgo: 140,
    content: atomicHabits,
  },
  {
    title: 'Reading list',
    notebook: ['Reading'],
    tags: ['books'],
    createdDaysAgo: 320,
    updatedDaysAgo: 10,
    content: readingList,
  },
  {
    title: 'Rust ownership',
    notebook: ['Learning', 'Rust'],
    tags: ['rust', 'programming'],
    createdDaysAgo: 50,
    updatedDaysAgo: 18,
    content: rustOwnership,
  },
  {
    title: 'Rust error handling',
    notebook: ['Learning', 'Rust'],
    tags: ['rust', 'programming'],
    createdDaysAgo: 40,
    updatedDaysAgo: 25,
    content: rustErrors,
  },
  {
    title: 'Postgres index cheat sheet',
    notebook: ['Learning'],
    tags: ['postgres', 'programming'],
    favorite: true,
    createdDaysAgo: 140,
    updatedDaysAgo: 35,
    content: sqlIndexes,
  },
  {
    title: 'Weekly review template',
    notebook: [],
    tags: ['productivity', 'checklist'],
    createdDaysAgo: 210,
    updatedDaysAgo: 4,
    content: weeklyReview,
  },
  {
    title: 'Career goals',
    notebook: [],
    tags: ['planning'],
    createdDaysAgo: 280,
    updatedDaysAgo: 50,
    content: careerGoals,
  },
  {
    title: 'Ideas',
    notebook: [],
    tags: ['ideas'],
    createdDaysAgo: 180,
    updatedDaysAgo: 5,
    content: ideas,
  },
  {
    title: 'Old meeting template',
    notebook: ['Work', 'Meetings'],
    createdDaysAgo: 310,
    updatedDaysAgo: 200,
    trashedDaysAgo: 4,
    content: '# Meeting\n\n**Date:**\n**People:**\n\n## Agenda\n\n## Notes\n\n## Actions\n',
  },
  {
    title: 'Groceries',
    notebook: [],
    tags: ['todo'],
    createdDaysAgo: 12,
    updatedDaysAgo: 12,
    trashedDaysAgo: 11,
    content: '- [x] Oat milk\n- [x] Lemons\n- [ ] Bread flour\n- [ ] Coffee beans\n',
  },
];

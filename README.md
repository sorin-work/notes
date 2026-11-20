# notes

A place to keep your thoughts and information organised: Markdown notes with a
live preview, notebooks, tags, `[[wiki links]]` between notes with backlinks,
full-text search, version history, a trash, read-only share links and
Markdown import/export.

## Features

- **Markdown editor** with edit, split and preview modes. GitHub flavoured
  Markdown: tables, task lists, strikethrough and autolinks. Notes save
  automatically a moment after you stop typing.
- **Task lists**: clicking a `- [ ]` box in the preview ticks it in the note,
  the same as typing the `x`. Boxes are read-only on shared pages, in version
  history and for notes in the trash.
- **Notebooks**, nested one level deep (e.g. _Work -> Meetings_). Selecting a
  top-level notebook shows the notes in the notebooks inside it too. Deleting
  a notebook moves its notes to the trash.
- **Tags** typed under the title (`#book club` becomes `book-club`). Tags can
  be renamed, merged and deleted in Settings.
- **Pinned notes** stay at the top of every list; **favourites** have their
  own view.
- **Templates**: "Template" in a note's toolbar turns it into a template.
  Templates have a list of their own and stay out of the other lists, the
  search, the quick switcher, link suggestions and backlinks. Choose one in
  "New from template" under the new-note button and press "Create" to start
  a note from it, with `{{date}}` and `{{time}}` filled in. "Duplicate" makes
  a plain copy of any note.
- **Daily note**: "Today" in the sidebar opens the note of the day and starts
  it when there is none. Settings say which notebook it goes into, which
  template it starts from and how the date is written in its title, and
  those choices follow the account to every device.
- **Filters**: two selects above the note list narrow it to a notebook, a tag
  or both, on top of the Pinned and Favourites views. The choice is kept in
  the URL (`?notebook=`, `?tag=`, `?view=`), so a filtered list can be
  bookmarked.
- **Wiki links**: `[[Note title]]` or `[[Note title|link text]]`. Typing `[[`
  suggests titles. Links to notes that do not exist yet are shown dashed;
  clicking one creates the note. Each note lists its **backlinks**, with the
  paragraph the link is in. After a note is renamed, the editor offers to
  update the links other notes have to its old title.
- **Full-text search** over titles and text, using Postgres full-text search.
  Words match as prefixes, titles rank above body text, matches are
  highlighted. Words in `"double quotes"` are a phrase: they have to follow
  each other and are not prefixes. A phrase can also match where a title ends
  and the text begins, because both are indexed as one run of words. The same
  two selects narrow a search to a notebook and a tag, and results load 30 at
  a time.
- **Quick switcher**: `Ctrl+K` (`Cmd+K` on a Mac) opens a small dialog with
  the notes edited last. Type part of a title, press Enter, and you are in
  that note with the cursor in its text, or on the preview when only the
  preview is showing.
- **Version history**: while you edit, the previous text is saved as a
  version at most every ten minutes (the last 50 are kept). Any version can be
  previewed and restored; restoring saves the current text first. The Changes
  view shows line by line what differs between a version and the note as it
  is now, with a changed title above it.
- **Edit conflicts**: with a note open in two tabs or on two devices, a save
  that would overwrite the other one is held back, and the editor asks what
  to keep: your text, theirs, or yours with theirs saved in the history.
- **Trash**: deleted notes can be restored or deleted for good, and are
  purged automatically after 30 days (`TRASH_RETENTION_DAYS`).
- **Share links**: a read-only public page at `/s/<token>` for a single note,
  or for a notebook with everything in it, the notebooks inside it and the
  notes you add later included. A link has a view count that leaves out your
  own visits, and can be given a date on which it runs out and a password
  that readers have to type. In a shared notebook, `[[links]]` between its
  notes work for readers. Anywhere else a link works only when the other note
  has a link of its own with no password that has not run out; every other
  link shows as its words. Notes and notebooks that a shared notebook makes
  public say so, and moving something into a shared notebook asks first.
  Stopping sharing kills the link; notes in the trash are never served.
  A shared notebook never shows its templates: they are not listed, cannot
  be opened through it, and a link to one reads as its words.
- **Import/export**: export everything as a zip of Markdown files (notebooks
  become folders, tags and dates go in YAML front matter) or a single note as
  `.md`. Import `.md`/`.txt` files or zips, such as an Obsidian vault or a
  Notion export (page ids are stripped and links between pages become
  `[[wiki links]]`), and Evernote `.enex` files (each file becomes a notebook,
  attachments are left out). Importing the same files again leaves out the
  notes that are there already. A full JSON backup of one account (trash,
  history and all) restores into an empty account. "Print" in the browser
  gives the note alone, ready to save as PDF.
- **Account**: change your name, email and password in Settings, sign out
  everywhere at once, or delete the account with everything in it. A
  forgotten password can be reset through a link sent by mail, on servers
  that have SMTP settings.
- **Capture**: `/capture?title=...&url=...` opens a new note with a page's
  title and its address, ready to save. A bookmarklet makes that one click
  on any page, see [Saving a page from the browser](#saving-a-page-from-the-browser).
- **API tokens** for scripts: made and revoked in Settings, shown once, and
  read-only if you want. A token stands in for a login on everything except
  the account itself.
- **Backups**: with Docker, an optional service dumps the whole database once
  a day and keeps the last seven dumps. See
  [Backup and restore](#backup-and-restore).
- **Keyboard and screen readers**: skip links lead past the sidebar to the
  content and to the open note, dialogs keep Tab inside them, the arrow keys
  move through the note list, and the link suggestions and the quick switcher
  are announced. Colours meet WCAG AA contrast in both themes, and nothing
  spins or slides when the system asks for reduced motion.
- Light and dark themes, keyboard shortcuts and a layout that works on phones.

| Shortcut             | Action                            |
| -------------------- | --------------------------------- |
| `Alt+N`              | New note                          |
| `/`                  | Search                            |
| `Ctrl+K` / `Cmd+K`   | Go to a note by its title         |
| `Ctrl+S` / `Cmd+S`   | Save now                          |
| `Ctrl+E` / `Cmd+E`   | Switch between edit/split/preview |
| `↑` `↓` `Home` `End` | Move through the note list        |

### Saving a page from the browser

Make a bookmark and give it this as its address, with the address of your
own notes in place of `http://localhost:5181`:

```
javascript:(()=>{window.open('http://localhost:5181/capture?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href))})()
```

Clicking it on any page opens the notes app in a new tab, with a note that
has the page's title as its title and the page's address as its first line.
Nothing is saved until you press "Save note", and if you are not signed in
you are asked to sign in first. It needs no API token and no CORS setting,
because the note is made by the web app itself.

Any site can make such a link, so the draft takes little from it. The title
is only ever the note's title, never part of its text. The address goes in
as a plain link that shows exactly where it leads, and only if it is an
ordinary `http` or `https` address. Anything else is left out, and the page
says so.

Ideas for what could come next are in [ROADMAP.md](ROADMAP.md).

## Stack

| Part     | Tech                                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| API      | TypeScript, NestJS 11, Prisma 6, PostgreSQL 17, JWT auth, class-validator          |
| Web      | React 19, TypeScript, Vite, React Router, TanStack Query, react-markdown           |
| Tests    | Jest + Supertest for the API, Vitest + Testing Library + axe for the web app       |
| Tooling  | ESLint, Prettier, GitHub Actions                                                   |
| Delivery | Docker Compose: Postgres, the API, and nginx serving the web app and proxying /api |

## Running with Docker

```bash
cp .env.example .env   # optional, the defaults work
docker compose up --build
```

Then open http://localhost:5181 and sign in with the demo account:

- **Email:** `demo@example.com`
- **Password:** `demo-password`

The demo account is created on first start with notebooks, about twenty
linked notes, tags, a template, a few earlier versions, two notes in the
trash and two shared notes. Set `SEED_DEMO=false` to start with an empty
database.

| Service | Port (host)           | Notes                                       |
| ------- | --------------------- | ------------------------------------------- |
| web     | http://localhost:5181 | nginx, proxies `/api` to the API            |
| api     | http://localhost:4401 | `GET /api/health` checks the database too   |
| db      | `localhost:5441`      | Postgres 17, user/password/database `notes` |
| mailpit | http://localhost:8041 | Shows the mail the API sends, delivers none |

The ports can be changed with `WEB_PORT`, `API_PORT`, `DB_PORT` and
`MAILPIT_UI_PORT`. The API container runs `prisma migrate deploy` before it
starts. Data lives in the `db-data` volume; `docker compose down -v` removes
it. [Backup and restore](#backup-and-restore) is about keeping a copy of it.

### Mail

The API sends one kind of mail: the link behind "Forgot password?" on the
sign-in page. In the Compose stack that mail goes to
[mailpit](https://mailpit.axllent.org), which keeps it and shows it at
http://localhost:8041 instead of delivering it. So to try a reset with the
demo account, ask for the link and pick it up there. The mailpit page is
bound to `127.0.0.1` and its SMTP port is not published at all, because
whoever can read that page can open every reset link.

For real mail, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and, if the server
wants a login, `SMTP_USER` and `SMTP_PASSWORD` in `.env`, and set `APP_URL`
to the address people open the app at, since the links in the mails start
with it. Mail to a server of your own only goes out over TLS: from the first
byte on port 465, through STARTTLS on any other port, and not at all if the
server does not offer it. `SMTP_REQUIRE_TLS=false` lifts that, which is what
the stack does for mailpit and nothing else should need. `SMTP_HOST=` with
nothing after it switches mail off: the sign-in page then does not offer a
reset.

### Limits per visitor

Logins, sign-ups, password resets, the account changes that ask for the
password, and reading shared notes are limited per client address. The API sits behind nginx, so the
stack sets `TRUST_PROXY=1`: the API then takes the address nginx reports in
`X-Forwarded-For` instead of nginx's own, which would be the same for
everyone and let one visitor use up the allowance of all. Requests made
with an API token are counted per token instead, wherever they come from.

That header is only worth believing when it comes from nginx. The stack also
publishes the API port itself (4401), and whoever talks to that port
directly can put any address in the header and so get a fresh allowance for
every request. On a machine that others can reach, take the `ports` entry out
of the `api` service, or set `TRUST_PROXY=0`.

## Backup and restore

"Export all notes" in Settings leaves out the trash, version history and
share links. "Download a full backup" next to it keeps them: see
[The JSON backup](#the-json-backup) below. For a copy of the whole database,
every account in it, there is a `backup` service that dumps it with
`pg_dump`. It is behind a Compose profile, so it only runs when
asked for:

```bash
docker compose --profile backup up -d
```

To have it start with every `docker compose up`, put `COMPOSE_PROFILES=backup`
in `.env`.

Dumps land in `./backups` as `notes-<UTC date and time>.dump`. When the
service starts it makes one, unless the newest dump is less than a day old,
so restarting the stack does not add dumps. On a new stack it first waits for
the API to create the tables. After that it makes one dump a day. It looks at
the clock once a minute instead of sleeping for a whole day, so a machine
that was suspended or switched off catches up when it is back.

After each dump only the newest seven are kept. Files with any other name are
left alone: rename a dump to keep it for good. How old a dump is, and which
ones are the oldest, is read from the time in the file name and never from
the file's modification time. A dump dated in the future, which is what a
clock that was wrong leaves behind, counts as made now and not as overdue.
Such dumps are never removed and do not count towards the seven, so they
cannot push out the real ones. The same goes for a name with a day that does
not exist, such as 31 February. Every run names them in a warning in the
log, and deleting them is up to you.

| Variable                  | Default     | Purpose                               |
| ------------------------- | ----------- | ------------------------------------- |
| `BACKUP_DIR`              | `./backups` | Folder on the host the dumps go to    |
| `BACKUP_KEEP`             | `7`         | How many dumps to keep                |
| `BACKUP_INTERVAL_SECONDS` | `86400`     | Seconds from one dump to the next one |

A dump right now, for example before an upgrade:

```bash
docker compose --profile backup run --rm backup once
```

To restore, stop what is connected to the database, name the dump and start
things again. That is the API, and the backup service too, since a dump that
is being made holds a connection as well:

```bash
docker compose --profile backup stop api backup
docker compose --profile backup run --rm backup restore notes-20261120T030000Z.dump
docker compose --profile backup start api backup
```

Leave `backup` out of the first and the last line if you do not run the
backup service.

`restore` without a file name lists the dumps. The restore replaces the whole
database, so everything written after the dump is gone. It goes in three
steps. The dump is loaded into a new database. Then, in one transaction, the
old database is renamed aside and the new one gets its name. Last, the old
one is dropped. So a damaged file leaves the data as it was, and so does
anything still connected to the database: the script then lists who is
connected. At no point is there no database, also if the restore is killed
half way. If only the last step fails, the restore is done and the script
says which old copy is left to remove. When the API starts again it applies
any migrations that are newer than the dump.

After losing the volume, or on another machine, it is the same command: put
the dump in `./backups`, run the `restore` line (it starts the database by
itself), then `docker compose up -d`.

Good to know:

- A dump holds every note and the password hashes, and it is not encrypted.
  The files can only be read by their owner. On Linux that is the owner of
  the folder they are in, not root.
- The dumps sit on the same disk as the database unless `BACKUP_DIR` points
  somewhere else. Copying them to another machine is up to you.
- Nothing warns you when a dump fails. `docker compose logs backup` shows
  every dump and every failure, and a failed dump is tried again a minute
  later.
- `docker compose down -v` removes the database volume, not the dumps.

### The JSON backup

`GET /export/backup` (Settings, "Download a full backup") writes one
account's data as a JSON file. It is written out as it is read, a batch of
notes at a time. The format is versioned. This is version 1:

```json
{
  "format": "notes-backup",
  "version": 1,
  "exportedAt": "2026-11-20T21:00:00.000Z",
  "preferences": {
    "dailyNotes": { "notebookId": "…", "templateId": "…", "dateFormat": "iso" }
  },
  "notebooks": [
    {
      "id": "…",
      "name": "Work",
      "parentId": null,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "tags": [{ "name": "q1", "createdAt": "…" }],
  "shareLinks": [
    {
      "noteId": "…",
      "notebookId": null,
      "hasPassword": true,
      "expiresAt": null,
      "viewCount": 4,
      "createdAt": "…"
    }
  ],
  "notes": [
    {
      "id": "…",
      "title": "Plan",
      "content": "Markdown",
      "notebookId": "…",
      "tags": ["q1"],
      "pinned": false,
      "favorite": false,
      "isTemplate": false,
      "dailyDate": "2026-11-20",
      "dailyReleased": false,
      "revision": 7,
      "createdAt": "…",
      "updatedAt": "…",
      "deletedAt": null,
      "versions": [{ "title": "Plan", "content": "…", "createdAt": "…" }]
    }
  ]
}
```

All times are UTC. `deletedAt` is set for a note in the trash. `versions` is
the note's history, oldest first. Notebooks come before the notebooks inside
them. `shareLinks` is a record of what was shared. It has no link addresses
and no password hashes, so the file opens nothing for whoever holds it.
Templates are notes with `isTemplate`, and `dailyDate` marks the daily note
of a day. `preferences` holds the daily note choices, with ids from the file.

`POST /import/backup` with the file as `file` (Settings, "Restore") puts a
backup into an account that has no notes, notebooks or tags yet: the same
notes with their history, revisions, tags, notebooks, trash, templates,
daily notes and daily note choices, under new ids, with links synced. The whole file is checked against the app's limits
first, and it is written in one transaction, so a refused or failed restore
leaves the account empty. An account that has something in it gets `409`. A
backup may be up to 200 MB. Share links are not made again: a new link would
have a new address, and a link that had a password would come back without
one. Share again what should be shared.

## Running locally

You need Node 22+ and Postgres. The easiest is to run only the database in
Docker:

```bash
docker compose up -d db
```

API (listens on :4401):

```bash
cd api
cp .env.example .env
npm install
npx prisma migrate deploy
set -a; . ./.env; set +a
npm run start:dev
```

Web (Vite on :5181, proxies `/api` to localhost:4401):

```bash
cd web
npm install
npm run dev
```

### Configuration

| Variable                   | Default    | Purpose                                                                  |
| -------------------------- | ---------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`             | (required) | Postgres connection string                                               |
| `JWT_SECRET`               | (required) | Signs login tokens, at least 32 characters                               |
| `JWT_EXPIRES_IN`           | `7d`       | How long a login lasts                                                   |
| `PORT`                     | `4401`     | API port                                                                 |
| `CORS_ORIGINS`             | (none)     | Comma-separated browser origins, only needed without nginx               |
| `LOG_LEVEL`                | `info`     | `debug`, `info`, `warn` or `error`                                       |
| `SEED_DEMO`                | `false`    | Create the demo account on start-up                                      |
| `TRASH_RETENTION_DAYS`     | `30`       | Days before trashed notes are deleted for good                           |
| `AUTH_THROTTLE_LIMIT`      | `10`       | Per-minute limit on the routes that take a password                      |
| `API_TOKEN_THROTTLE_LIMIT` | `120`      | Requests a minute that one API token may make                            |
| `PUBLIC_THROTTLE_LIMIT`    | `60`       | Shared notes that one client may open in a minute                        |
| `API_DOCS`                 | `true`     | `false` turns off the page and the document at `/api/docs`               |
| `SMTP_HOST`                | (none)     | SMTP server. Without it no mail is sent and password reset is off        |
| `SMTP_PORT`                | `587`      | Its port. `465` is TLS from the start, any other port uses STARTTLS      |
| `SMTP_FROM`                | (none)     | Sender of the mails, required with `SMTP_HOST`                           |
| `SMTP_USER`                | (none)     | Login for the SMTP server, if it wants one                               |
| `SMTP_PASSWORD`            | (none)     | Password for that login                                                  |
| `SMTP_REQUIRE_TLS`         | `true`     | `false` lets mail go out without TLS, for a test server like mailpit     |
| `APP_URL`                  | (none)     | Address of the web app for the links in mails, required with `SMTP_HOST` |
| `TRUST_PROXY`              | `0`        | Reverse proxies in front of the API whose `X-Forwarded-For` counts       |

The API on its own sends no mail unless `SMTP_HOST` is set, and mailpit's
SMTP port is not reachable from outside the Compose network. To work on
password reset with the API running locally, point `SMTP_HOST` at any SMTP
server you can reach.

## Tests and checks

```bash
# API
cd api
npm run lint
npm run typecheck
npm test                    # unit tests, no database needed
DATABASE_URL="postgresql://notes:notes@localhost:5441/notes?schema=e2e" \
  JWT_SECRET=e2e-secret-that-is-long-enough-0123456789 \
  npm run test:e2e          # end-to-end tests against Postgres

# Web
cd web
npm run lint
npm run typecheck
npm test
```

The end-to-end tests apply the migrations to the database they are given and
sign up a fresh user per test, so pointing them at a separate schema (as
above) keeps them away from your own notes.

The web tests run axe (through `vitest-axe`) over the main pages and the
dialogs, so a field without a label or a heading out of order fails the
build. axe cannot judge colours without a real browser, so
`web/src/styles.contrast.test.ts` reads the palette from `styles.css` and
checks the colour pairs in use against WCAG AA, for both themes.

A restore that is never tested is not a backup, so CI also runs
`scripts/check-backup.sh` on the database the end-to-end tests leave behind.
It takes three dumps while keeping two, restores the newest into a scratch
database and compares the row count of every table. To run it against the
database of the Compose stack (it needs rows in the application's tables, and
nothing writing to it meanwhile):

```bash
docker compose --profile backup run --rm --entrypoint sh backup /scripts/check-backup.sh
```

It starts with `scripts/check-backup-loop.sh`, which needs neither Docker nor
a database and can be run by itself. That one drives the daily loop with
stand-ins for `pg_dump` and `sleep` and with dump files dated in the past and
in the future, and fails if the loop makes more than one dump, makes two
without a pause, or leaves fewer dumps behind than it should. It also walks
a restore through its steps with stand-ins and fails if the database would
be touched when the dump does not load or the swap is refused. With the real
database the check then restores over a database that holds something else,
tries a damaged dump, and tries with a second client connected.

## Project layout

```
api/
  prisma/               schema and migrations
  src/
    auth/               sign-up, login, JWT guard, account changes
    notebooks/          notebooks and their one level of nesting
    notes/              notes, filters and sorting, note export
    tags/               tag names, renaming and merging
    links/              [[wiki link]] parsing, link storage and backlinks
    versions/           version history and restore
    trash/              trash, restore and the hourly purge
    search/             Postgres full-text search
    shares/             read-only share links
    transfer/           zip export, Markdown/Evernote/Notion import
    mail/               outgoing mail over SMTP
    seed/               demo account
    common/, config/    shared helpers and environment configuration
  test/                 end-to-end tests
web/
  src/
    api/                typed API client
    auth/               auth context and route guards
    components/         editor, preview, sidebar, dialogs
    hooks/              autosave, theme and small state helpers
    lib/                wiki links, task lists, templates, line diff, dates, text
    pages/              one component per route
scripts/
  backup.sh             the backup service: daily dumps, pruning and restore
  check-backup.sh       dumps, restores and compares row counts, run by CI
  check-backup-loop.sh  the daily loop and the pruning against made-up clocks
backups/                where the dumps go by default, ignored by git
```

## How links and versions work

Links point at titles, not ids. `[[Atlas]]` matches the note titled "Atlas"
ignoring case and extra spaces; if several notes share a title, the most
recently edited one wins. Renaming a note therefore leaves links to the old
title dangling (they show up dashed), and a new note with the old title picks
them up again. Links inside code blocks and inline code are ignored.

When a rename leaves links dangling, the editor shows how many notes still
link to the old title and offers to update them, naming both titles. The
offer waits until the new title is finished: the cursor has left the title
field and the title is saved. Nothing is rewritten before you click. The
update changes only the title inside `[[ ]]`: a `#heading`, an `|alias` and
links in code stay as they are. The rewritten notes keep their place in "last
edited" lists, and each one gets a version first, so the change can be undone
from its history.

There is no offer, and nothing is rewritten:

- while another note has the old title, since the links still lead somewhere;
- when another note has the new title as well, since the links could then
  lead to that one;
- for a note left without a title, which is stored as "Untitled";
- when the new title contains `[`, `]`, `|`, `#` or a backtick, which cannot
  be written as a link.

Notes in the trash and the links a note has to itself are left alone. A note
that is being saved at that very moment, or that would grow past the size
limit, is left as it is. The editor then says how many were left and keeps
the offer. The offer is made in the editor where the rename happened and is
gone once you leave the note.

Versions hold the text a note had _before_ an edit. The first change after a
ten minute pause saves the old text as a version; further changes in the
next ten minutes do not. Pinning, favouriting, tags and moving between
notebooks do not create versions. Ticking a task box in the preview changes
the text, so it counts as an edit.

The Changes view in the history compares a version with what is in the
editor at that moment, saved or not. Lines marked `-` are only in the
version, lines marked `+` only in the note now, and long unchanged stretches
are left out. Line endings are not compared. How long the note is does not
matter, only how much changed: up to 2,000 added and removed lines are worked
out, and past that the view says so and shows no diff. A single block that
was only added or only removed is shown whatever its size. The view lists
2,000 rows at most and then says how many more lines changed.

Every note has a revision, a number that goes up by one whenever its title or
text changes: a save, a restored version, links rewritten after a rename.
Pinning, favourites, tags, moving a note and the trash leave it alone. The
editor sends the revision its text is based on with every save. When the note
has moved on since, the save is refused and the editor asks what to keep.
"Take theirs" fetches the note as it is at that moment. Closing the question
decides nothing: the text stays in the editor, unsaved, and the browser warns
before the tab is closed. Restoring a version first saves what is typed, and
does not go ahead if that fails. A save that names no revision, as from a tab
that was loaded before this existed or from a script, is never refused: the
last write wins, as it always did.

Leaving a note never drops what was typed in it without a word:

- With the question still open, or when the other change is only noticed by
  the save that leaving sets off, your text is saved and the other version
  goes into the history of the note. A notice in the corner says so
  afterwards, because nobody was looking when it happened.
- When the text cannot be saved at all, because there is no connection or the
  session has ended, it is kept in that browser tab under your account. A
  notice says so, and the note offers to put the changes back the next time
  you open it there. They are removed once they are saved or you discard
  them, and are gone when the tab is closed. Another account never sees them.
- "Sign out" saves the open note first. If that fails, it asks before it
  throws the changes away.

If the answer to a save gets lost on the way, the next save is told that the
note has changed. The editor recognises its own text in that change and goes
on without asking.

A note made from a template gets the template's text and tags. Three
placeholders are filled in, and no others: `{{date}}` (as `2026-11-20`),
`{{time}}` (as `19:30`) and `{{title}}`, the title given for the new note.
Date and time are those of the browser's clock, because the server does not
know what day it is where you are. Anything else in double braces, and a
placeholder without a value, is left as written. The note does not take the
template's title: it starts as "Untitled" with the cursor in the title, and
`{{title}}` stays in the text until you replace it. Its `[[links]]` are real
links from then on, while the links written in a template do not count as
backlinks. A link to a template's title still leads to the template, unless
a note has the same title: a note always goes first. The notebook list
counts templates apart from notes, and deleting a notebook says how many of
each go to the trash with it. Neither
a note from a template nor a duplicate takes the pin, the star, the share
link or the history of the original. Turning a note into a template is no
edit: it changes neither "last edited" nor the revision.

"Today" asks for the daily note of a day. The day is the one the browser's
clock shows, and the server never works out a date. An account has one daily
note per day: clicking twice, or in two tabs at the same moment, opens the
same note, which the database guarantees with a unique index. The note is
found by its day and not by its title, so it stays the note of that day when
it is renamed or when the date format is changed. A note written by hand
under the title of the day, in any of the three formats, is taken for the
note of that day the first time "Today" finds it. That is so for any note
titled with the day, also one that has nothing to do with it: "Not the daily
note" in its toolbar takes it off the day, and from then on neither the day
nor its title makes it the daily note again. The next "Today" starts a new
one. The title of a new daily note is written by the server, in the format
the account has when the note is made, so a tab left open while the format
was changed elsewhere still gets it right. A daily note in the trash
makes room: "Today" starts a new one, and the old one comes back from the
trash as an ordinary note. The three formats are `2026-11-20`,
`20 November 2026` and `November 20, 2026`. In the template of a daily note
`{{title}}` is the day as the title has it, and `{{date}}` is always
`2026-11-20`. The notebook, the template and the format are preferences kept
with the account. Theme and editor mode are not: they belong to a screen and
stay in the browser.

## API overview

The API describes itself. With the stack running, http://localhost:5181/api/docs
(port 4401 when the API runs by itself) is a page that lists every endpoint
with its parameters, a line on what it does and the credentials it takes,
and lets you try it. The OpenAPI document
behind it is at `/api/docs-json`. Both need no login, and `API_DOCS=false`
turns both off. The request side of the document is built from the classes
the API validates with, so it cannot fall behind the code. The answers are
not described in it yet. The page loads nothing from other hosts.

What follows is what the document does not say, or what is worth knowing
before opening it.

All endpoints are under `/api` and, apart from sign-up, login, password
reset, the health check and shared notes, need an
`Authorization: Bearer <token>` header. Errors use Nest's shape:
`{"statusCode": 400, "message": [...], "error": "Bad Request"}`.

`GET /notes/:id` returns the note's `revision`. `PATCH /notes/:id` takes it
back as `revision`, the one the new title or content was based on. If the
note has changed since, nothing is written and the answer is a `409` that
carries the note as it is now:
`{"statusCode": 409, "error": "Conflict", "code": "stale_revision", "message": "...", "note": {...}}`.
The check only applies when `title` or `content` is sent, and a request
without `revision` is never refused. With `"keepVersion": true` the text that
a save replaces is kept as a version whatever the usual interval.

`POST /notes` with `"templateId"` makes the note from that template, and
`"placeholders": {"date": "...", "time": "..."}` gives the text to fill in,
and `"title"` is the title of the new note and the value of `{{title}}`.
The API only puts in what it is sent and never works out a date by itself.
`GET /notebooks` gives each notebook a `noteCount` and, apart, a
`templateCount`.
`PATCH /notes/:id` with `"isTemplate"` turns a note into a template or back.

`POST /notes/daily` with `{"date": "2026-11-20"}` answers with the daily note
of that day and makes it when there is none, titled in the account's date
format. `placeholders` can come along for the template. A note has a
`dailyDate` when it is a daily note, and `DELETE /notes/:id/daily` takes it
off its day. `GET /auth/me` has the account's `preferences`, and
`PATCH /auth/preferences` changes the ones that are sent and answers with
them as a read gives them:
`{"dailyNotes": {"notebookId": null, "templateId": "...", "dateFormat": "long"}}`.
`notebookId` and `templateId` can be `null` for none. `dateFormat` cannot.

A login token lasts seven days (`JWT_EXPIRES_IN`), or until the password
changes or `POST /auth/logout-all` is called. Each token carries the
account's token version, and the API compares it with the database on every
request, so those two end all sessions at once. `PATCH /auth/password`
answers with a new token for the browser that made the change. Changing the
email and deleting the account ask for the password again; a wrong one is a
`403`, not a `401`, because the session itself is still good. The three
routes that check the password count their requests twice against
`AUTH_THROTTLE_LIMIT`: per client address on each route, and per account
across all three, so a stolen login gets ten guesses a minute in total.

`POST /auth/password-reset` with `{ email }` mails a link to
`/reset-password#token=...` in the web app, and answers `204` whether or not
the address has an account. The token is random, only its SHA-256 hash is
stored, and it works once within an hour. It is in the fragment of the link,
which browsers keep to themselves, so it does not show up in a server log.
`POST /auth/password-reset/confirm` with `{ token, password }` sets the
password, bumps the token version, so every session of the account ends, and
ends the account's other links. It revokes the account's API tokens as
well, because a reset is the way back into an account that someone else may
have got into. Asking again does not cancel a link that is
already out. An account has three of them at a time at most, which also
means three mails an hour at most, and further requests do nothing until one
runs out or is used. The mail holds fixed text and the link, nothing from
the account. Without `SMTP_HOST` both routes answer `404`, and
`GET /auth/password-reset` says `{ "enabled": false }`, which is how the
sign-in page knows to hide the link.

A script does not have to log in. A personal API token from Settings goes in
the same header:

```bash
curl -H "Authorization: Bearer nt_..." http://localhost:5181/api/notes
```

Making a token takes the account's password, because a token outlives
every login and a stolen login must not be able to make itself one. The
token is shown once, when it is made, and only its SHA-256 hash is stored. It acts as the account it belongs to, with these limits:

- A read-only token gets a `403` on everything that is not a `GET`.
- No token can touch the account: listing, making or revoking tokens,
  changing the name, email, password or preferences, deleting the account and
  signing out everywhere all answer `403`. `GET /auth/me` works. Sign in for
  the rest.
  In the code a route takes a token only when it is marked
  `@AllowApiToken()`, so a route added later is closed to tokens until
  someone opens it.
- Each token may make `API_TOKEN_THROTTLE_LIMIT` requests a minute, 120
  unless set. After that the answer is `429` with a `Retry-After` header.

Tokens do not expire. Signing out everywhere and changing the password end
logins, not tokens: a script that stops without a word is worse than one
that goes on. After a password change the web app says how many tokens
still work and offers to revoke them all in one click
(`DELETE /auth/tokens`). A password reset by mail does revoke them all. A
token also ends when it is revoked by itself or the account is deleted. An
account can have 20 of them.

A shared note is read with `GET /public/notes/:token`, without a login. Three
things can come back besides the note:

- `404` for a link that was mistyped, was revoked, has run out, or whose note
  is in the trash. The answer is the same for all of them, so nobody outside
  can tell which, or that a link ever existed.
- `403` with `"passwordRequired": true` for a link with a password. The note
  then comes from `POST /public/notes/:token` with `{ "password": "..." }`.
  The password is only ever sent in a body, never in an address, where it
  would end up in logs and histories. A wrong password gets the same `403`.
- `429` when a client reads more than `PUBLIC_THROTTLE_LIMIT` shared notes a
  minute, or sends more than `AUTH_THROTTLE_LIMIT` passwords a minute. A link
  also takes only `AUTH_THROTTLE_LIMIT` wrong passwords a minute in total,
  from all clients together, so guessing from many addresses does not get
  more tries. A right password does not count against the link. Once the
  wrong ones are used up, the link refuses every password, the right one
  too, until the minute that began with the first wrong one is over, and
  the `429` carries `Retry-After`. So someone who keeps guessing can keep
  readers out for as long as they keep at it, without getting closer to the
  note. The owner, signed in, is never counted or refused by the link's
  limit.

Every answer of the public routes carries `Cache-Control: no-store`, so that
a link that is revoked, runs out or gets a password stops working at once
everywhere. A request that carries the owner's login is not counted as a
view. The owner sets the options with `PATCH /notes/:id/share`:
`{ "expiresAt": "2026-03-01T12:00:00Z", "password": "..." }`, where `null`
takes either away. The password is stored as a hash, made the same way as
account passwords.

A notebook is shared the same way under `/notebooks/:id/share`. Its link
answers with `"kind": "notebook"`, the name and the list of its notes, and
`GET /public/notes/:token/:noteId` gives one of them. Which notes belong to
the notebook is looked up with every request: a note added later is there,
and one that is moved out, put in the trash or turned into a template
answers `404` from then on.
The answer to the right password has an `access` value. Sent back in an
`X-Share-Access` header it opens the notes of the notebook for an hour, so
the password is typed once and only real attempts count against the limit.
It is worth nothing for another link, or after the password changed.

In a shared note a `[[link]]` stays a link only where the reader may follow
it. Its title is looked up first among the notes of the same shared
notebook, when the note is read through one, and then among the notes whose
own link has no password and has not run out. A note outside those never
counts, so a private note with the same title changes nothing. `links` in
the answer says where each kept link leads. Every other link is replaced by
the words a reader sees for it, the alias or else the title as written. That
covers a link to a private note, to a note behind a password, to one whose
link has run out, to one that does not exist, and, from a single shared
note, to a note that only a shared notebook covers: `[[Private plan]]`
becomes `Private plan`, with `links: {}`.

`GET /notes/:id` and `GET /notebooks` carry `sharedThrough`, the notebook
whose live link makes the note or notebook public, or `null`.

`POST /import` takes up to 50 files as `files`, 20 MB each, and the form
field `skipExisting` (`true` unless `false` is sent), which leaves out notes
whose title, notebook and text the account already has. The answer counts
what was imported, the notebooks made, the notes left out as `duplicates`
and the Evernote attachments that were not imported, and lists every file it
skipped with the reason. Imported notes get the same limits as typed ones
and their links are synced. Their text is stored as Markdown and never shown
as HTML. Zips are read within limits: 10,000 entries, 12 folders deep, 4 MB
unpacked per file and 100 MB per import, counted while unpacking. An entry
whose path leads out of the zip is skipped, and a zip inside a zip is not
opened. An `.enex` file is read without its DTD: one that declares a DTD of
its own, or uses an entity beyond XML's five, is refused. Front matter is
read as YAML with the core schema only (no custom tags, no aliases); a block
that is not clean YAML stays at the top of the note as text.

The endpoints a script is most likely to want. The rest is in `/api/docs`.

| Method & path                                | What it does                              |
| -------------------------------------------- | ----------------------------------------- |
| `POST /auth/login`                           | Returns `{ token, user }`                 |
| `GET /notes?notebookId=&tag=&sort=&page=`    | Note list (`notebookId=none` for unfiled) |
| `POST /notes`, `GET/PATCH/DELETE /notes/:id` | Notes (`DELETE` moves to the trash)       |
| `GET /search?q=&notebookId=&tag=&page=`      | Full-text search, `"phrases"` in quotes   |
| `GET /export`, `GET /notes/:id/export`       | Everything as a zip, one note as `.md`    |
| `GET /export/backup`, `POST /import/backup`  | The JSON backup, and its restore          |
| `POST /import`                               | Markdown, text, `.enex` or zip, `files`   |

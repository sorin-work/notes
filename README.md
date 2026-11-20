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
- **Filters**: two selects above the note list narrow it to a notebook, a tag
  or both, on top of the Pinned and Favourites views. The choice is kept in
  the URL (`?notebook=`, `?tag=`, `?view=`), so a filtered list can be
  bookmarked.
- **Wiki links**: `[[Note title]]` or `[[Note title|link text]]`. Typing `[[`
  suggests titles. Links to notes that do not exist yet are shown dashed;
  clicking one creates the note. Each note lists its **backlinks**, with the
  paragraph the link is in.
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
- **Trash**: deleted notes can be restored or deleted for good, and are
  purged automatically after 30 days (`TRASH_RETENTION_DAYS`).
- **Share links**: a read-only public page for a single note at `/s/<token>`,
  with a view count. Stopping sharing kills the link; notes in the trash are
  never served.
- **Import/export**: export everything as a zip of Markdown files (notebooks
  become folders, tags and dates go in YAML front matter) or a single note as
  `.md`. Import `.md`/`.txt` files or zips, such as an Obsidian vault.
- **Account**: change your name, email and password in Settings, sign out
  everywhere at once, or delete the account with everything in it. A
  forgotten password can be reset through a link sent by mail, on servers
  that have SMTP settings.
- **Capture**: `/capture?title=...&url=...` opens a new note with a page's
  title and a link to it, ready to save. A bookmarklet makes that one click
  on any page, see [Saving a page from the browser](#saving-a-page-from-the-browser).
- **API tokens** for scripts: made and revoked in Settings, shown once, and
  read-only if you want. A token stands in for a login on everything except
  the account itself.
- **Backups**: with Docker, an optional service dumps the whole database once
  a day and keeps the last seven dumps. See
  [Backup and restore](#backup-and-restore).
- Light and dark themes, keyboard shortcuts and a layout that works on phones.

| Shortcut           | Action                            |
| ------------------ | --------------------------------- |
| `Alt+N`            | New note                          |
| `/`                | Search                            |
| `Ctrl+K` / `Cmd+K` | Go to a note by its title         |
| `Ctrl+S` / `Cmd+S` | Save now                          |
| `Ctrl+E` / `Cmd+E` | Switch between edit/split/preview |

### Saving a page from the browser

Make a bookmark and give it this as its address, with the address of your
own notes in place of `http://localhost:5181`:

```
javascript:(()=>{window.open('http://localhost:5181/capture?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href))})()
```

Clicking it on any page opens the notes app in a new tab, with a note that
has the page's title and a link to the page as its first line. Nothing is
saved until you press "Save note", and if you are not signed in you are
asked to sign in first. It needs no API token and no CORS setting, because
the note is made by the web app itself.

Ideas for what could come next are in [ROADMAP.md](ROADMAP.md).

## Stack

| Part     | Tech                                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| API      | TypeScript, NestJS 11, Prisma 6, PostgreSQL 17, JWT auth, class-validator          |
| Web      | React 19, TypeScript, Vite, React Router, TanStack Query, react-markdown           |
| Tests    | Jest + Supertest for the API, Vitest + Testing Library for the web app             |
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
linked notes, tags, a few earlier versions, two notes in the trash and two
shared notes. Set `SEED_DEMO=false` to start with an empty database.

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

Logins, sign-ups, password resets and the account changes that ask for the
password are limited per client address. The API sits behind nginx, so the
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
share links. For a full copy there is a `backup` service that dumps the whole
database with `pg_dump`. It is behind a Compose profile, so it only runs when
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
clock that was set back leaves behind, counts as made now and not as overdue.

| Variable                  | Default     | Purpose                               |
| ------------------------- | ----------- | ------------------------------------- |
| `BACKUP_DIR`              | `./backups` | Folder on the host the dumps go to    |
| `BACKUP_KEEP`             | `7`         | How many dumps to keep                |
| `BACKUP_INTERVAL_SECONDS` | `86400`     | Seconds from one dump to the next one |

A dump right now, for example before an upgrade:

```bash
docker compose --profile backup run --rm backup once
```

To restore, stop the API, name the dump and start the API again:

```bash
docker compose stop api
docker compose --profile backup run --rm backup restore notes-20261120T030000Z.dump
docker compose start api
```

`restore` without a file name lists the dumps. The restore replaces the whole
database, so everything written after the dump is gone. The dump is loaded
into a new database first, and that one takes the place of the old one only
when the load worked: a damaged file, or an API that is still running, leaves
the data as it was. Should the very last step fail, giving the new database
its name, the script says where the restored data is and prints the command
that finishes the job. When the API starts again it applies any migrations
that are newer than the dump.

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
without a pause, or leaves fewer dumps behind than it should.

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
    transfer/           zip export, Markdown import, front matter
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
    lib/                wiki links, task lists, line diff, dates, text helpers
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

## API overview

The API describes itself. With the stack running, http://localhost:5181/api/docs
(port 4401 when the API runs by itself) is a page that lists every endpoint
with its parameters, a line on what it does and the credentials it takes,
and lets you try it. The OpenAPI document
behind it is at `/api/docs-json`. Both need no login. The request side of
the document is built from the classes the API validates with, so it cannot
fall behind the code. The answers are not described in it yet.

What follows is what the document does not say, or what is worth knowing
before opening it.

All endpoints are under `/api` and, apart from sign-up, login, password
reset, the health check and shared notes, need an
`Authorization: Bearer <token>` header. Errors use Nest's shape:
`{"statusCode": 400, "message": [...], "error": "Bad Request"}`.

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
ends the account's other links. Asking again does not cancel a link that is
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

The token is shown once, when it is made, and only its SHA-256 hash is
stored. It acts as the account it belongs to, with these limits:

- A read-only token gets a `403` on everything that is not a `GET`.
- No token can touch the account: listing, making or revoking tokens,
  changing the name, email or password, deleting the account and signing out
  everywhere all answer `403`. `GET /auth/me` works. Sign in for the rest.
- Each token may make `API_TOKEN_THROTTLE_LIMIT` requests a minute, 120
  unless set. After that the answer is `429` with a `Retry-After` header.

Tokens do not expire. Changing the password and signing out everywhere end
logins, not tokens. A token ends when it is revoked or the account is
deleted. An account can have 20 of them.

The endpoints a script is most likely to want. The rest is in `/api/docs`.

| Method & path                                | What it does                              |
| -------------------------------------------- | ----------------------------------------- |
| `POST /auth/login`                           | Returns `{ token, user }`                 |
| `GET /notes?notebookId=&tag=&sort=&page=`    | Note list (`notebookId=none` for unfiled) |
| `POST /notes`, `GET/PATCH/DELETE /notes/:id` | Notes (`DELETE` moves to the trash)       |
| `GET /search?q=&notebookId=&tag=&page=`      | Full-text search, `"phrases"` in quotes   |
| `GET /export`, `GET /notes/:id/export`       | Everything as a zip, one note as `.md`    |
| `POST /import`                               | Markdown, text or zip files, as `files`   |

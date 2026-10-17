# notes

A place to keep your thoughts and information organised: Markdown notes with a
live preview, notebooks, tags, `[[wiki links]]` between notes with backlinks,
full-text search, version history, a trash, read-only share links and
Markdown import/export.

## Features

- **Markdown editor** with edit, split and preview modes. GitHub flavoured
  Markdown: tables, task lists, strikethrough and autolinks. Notes save
  automatically a moment after you stop typing.
- **Notebooks**, nested one level deep (e.g. _Work → Meetings_). Selecting a
  top-level notebook shows the notes in the notebooks inside it too. Deleting
  a notebook moves its notes to the trash.
- **Tags** typed under the title (`#book club` becomes `book-club`). Tags can
  be renamed, merged and deleted in Settings.
- **Pinned notes** stay at the top of every list; **favourites** have their
  own view.
- **Wiki links**: `[[Note title]]` or `[[Note title|link text]]`. Typing `[[`
  suggests titles. Links to notes that do not exist yet are shown dashed;
  clicking one creates the note. Each note lists its **backlinks**, with the
  paragraph the link is in.
- **Full-text search** over titles and text, using Postgres full-text search.
  Words match as prefixes, titles rank above body text, matches are
  highlighted.
- **Version history**: while you edit, the previous text is saved as a
  version at most every ten minutes (the last 50 are kept). Any version can be
  previewed and restored; restoring saves the current text first.
- **Trash**: deleted notes can be restored or deleted for good, and are
  purged automatically after 30 days (`TRASH_RETENTION_DAYS`).
- **Share links**: a read-only public page for a single note at `/s/<token>`,
  with a view count. Stopping sharing kills the link; notes in the trash are
  never served.
- **Import/export**: export everything as a zip of Markdown files (notebooks
  become folders, tags and dates go in YAML front matter) or a single note as
  `.md`. Import `.md`/`.txt` files or zips, such as an Obsidian vault.
- Light and dark themes, keyboard shortcuts and a layout that works on phones.

| Shortcut           | Action                            |
| ------------------ | --------------------------------- |
| `Alt+N`            | New note                          |
| `/`                | Search                            |
| `Ctrl+S` / `Cmd+S` | Save now                          |
| `Ctrl+E` / `Cmd+E` | Switch between edit/split/preview |

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

The ports can be changed with `WEB_PORT`, `API_PORT` and `DB_PORT`. The API
container runs `prisma migrate deploy` before it starts. Data lives in the
`db-data` volume; `docker compose down -v` removes it.

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

## Project layout

```
api/
  prisma/               schema and migrations
  src/
    auth/               sign-up, login, JWT guard, password changes
    notebooks/          notebooks and their one level of nesting
    notes/              notes, filters and sorting, note export
    tags/               tag names, renaming and merging
    links/              [[wiki link]] parsing, link storage and backlinks
    versions/           version history and restore
    trash/              trash, restore and the hourly purge
    search/             Postgres full-text search
    shares/             read-only share links
    transfer/           zip export, Markdown import, front matter
    seed/               demo account
    common/, config/    shared helpers and environment configuration
  test/                 end-to-end tests
web/
  src/
    api/                typed API client
    auth/               auth context and route guards
    components/         editor, preview, sidebar, dialogs
    hooks/              autosave, theme and small state helpers
    lib/                wiki links, dates, text helpers
    pages/              one component per route
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
notebooks do not create versions.

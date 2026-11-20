# Roadmap

Things I might add to notes. The app does what I need day to day, so nothing
here is promised or scheduled. These are ideas, written down with enough
detail that I (or anyone else) can pick one up later without starting from
zero. Items may change, move between groups or be dropped.

What the app does today is in the [README](README.md).

- **Next**: small or well understood. I would start with these.
- **Later**: worth doing, but bigger or waiting on a decision.
- **Maybe**: not sure yet that they are worth the extra complexity.
- **Shipped**: built. The notes at the end say how each one turned out.

Sizes are rough: **S** is an evening or two, **M** a few evenings up to a
couple of weekends, **L** several weeks of spare time.

## Overview

| #   | Item                                   | Group   | Area     | Size | Depends on |
| --- | -------------------------------------- | ------- | -------- | ---- | ---------- |
| 1   | Clickable task lists in the preview    | Next    | frontend | S    | -          |
| 2   | Changes view in version history        | Next    | frontend | S    | -          |
| 3   | Quick switcher                         | Shipped | frontend | S    | -          |
| 4   | Search filters, phrases and paging     | Shipped | both     | M    | -          |
| 5   | Rename a note without breaking links   | Next    | both     | M    | -          |
| 6   | Accessibility pass                     | Next    | frontend | M    | -          |
| 7   | Scheduled backups                      | Shipped | infra    | S    | -          |
| 8   | Edit conflict detection                | Later   | both     | M    | -          |
| 9   | Attachments and pasted images          | Later   | both     | L    | -          |
| 10  | Share link options                     | Later   | both     | M    | -          |
| 11  | Account settings and sessions          | Later   | both     | M    | -          |
| 12  | More import sources and export formats | Later   | both     | M    | -          |
| 13  | Personal API tokens                    | Later   | both     | M    | -          |
| 14  | Offline mode and installable app       | Later   | both     | L    | 8          |
| 15  | Deeper notebook nesting                | Maybe   | both     | M    | -          |
| 16  | Templates and daily notes              | Maybe   | both     | M    | -          |
| 17  | Notebooks shared with other accounts   | Maybe   | both     | L    | 8          |
| 18  | Graph view and unlinked mentions       | Maybe   | both     | M    | -          |

## Next

### 1. Clickable task lists in the preview

Ticking a `- [ ]` box in the preview should tick it in the note. Today the
boxes are rendered disabled, so working through a checklist means going back
to the source and typing an `x`.

- `MarkdownPreview` gets an optional `onToggleTask(line)` and custom `li` /
  `input` renderers. `NoteEditor` flips `[ ]` and `[x]` on that line and goes
  through `change({ content })`, so autosave and versions behave as they do
  for typing.
- react-markdown passes the source position of the list item (the checkbox
  itself has none). `linkifyWikiLinks` rewrites text inside a line but never
  adds or removes lines, so line numbers still match the source. Columns do
  not.
- Stays read-only wherever no handler is passed: `SharedNotePage`,
  `VersionHistoryDialog` and notes in the trash.

### 2. Changes view in version history

History shows each version rendered, not what changed, so finding the edit
that lost a paragraph means comparing versions by eye. I want a "Changes"
toggle in `VersionHistoryDialog` that shows a line diff between the selected
version and the current text.

- No API change: `GET /notes/:id/versions/:versionId` already returns the
  full content. The current text should be passed in from `NoteEditor` rather
  than read from the query cache, so an unsaved draft is compared correctly.
- Titles are versioned too (`NoteVersion.title`), so show a title change
  above the diff.
- Undecided: add the `diff` package or write a small line-based diff in
  `web/src/lib`. A note can be a million characters (`MAX_CONTENT_LENGTH`),
  so either way it needs a cut-off for very long notes.

### 5. Rename a note without breaking links

Links point at titles, so renaming "Atlas" to "Project Atlas" leaves every
`[[Atlas]]` dangling (see "How links and versions work" in the README). When
a rename orphans links, the editor should offer "Update N links".

- `NotesService.update` already knows when the title changed, and
  `LinksService.backlinks` finds the notes linking to the old title through
  `NoteLink.targetKey`. New: a `renameLinks(markdown, from, to)` beside
  `extractWikiLinks` in `links/wikilinks.ts` that skips code the same way and
  keeps the `|alias` and `#heading` parts.
- Each rewritten note needs `LinksService.sync`, and a version saved through
  `VersionsService` so the rewrite can be undone.
- Tricky: if another note still has the old title, the links are not dangling
  and must be left alone. Bumping `updatedAt` on twenty notes would also
  reshuffle every "last edited" list, so the rewrite should probably leave it.
- Undecided: a separate `POST /notes/:id/rename-links` after the user
  confirms, or a flag on the `PATCH`. I lean towards separate, because the
  title autosaves on every pause and rewriting links halfway through typing a
  new title would be wrong.

### 6. Accessibility pass

The basics are there (labels, focus styles, `aria-current`, dialogs with
`role="dialog"`), but I have never gone through the whole app with only a
keyboard or with a screen reader. Gaps I already know about:

- `Modal` moves focus in and puts it back on close, but does not trap Tab, so
  focus can wander into the page behind the dialog.
- The `[[` suggestion list has `role="listbox"`, but the textarea does not
  point at it (`aria-controls`, `aria-activedescendant`), so the options are
  not announced.
- No "skip to content" link. Getting from the sidebar to the editor is a lot
  of tabbing.
- No `prefers-reduced-motion` rule for the spinner and the sliding sidebar in
  `styles.css`.
- Arrow keys do not move through `NoteList`.
- Add an automated check (axe, through `vitest-axe` or similar) to the page
  tests so regressions fail CI. Colour contrast in both themes needs checking
  by hand, since jsdom cannot do it.

## Later

### 8. Edit conflict detection

With a note open in two tabs, or on a laptop and a phone, the last save wins
and the other edit is gone without a word, unless a version happened to be
saved in between. Items 14 and 17 both need this first.

- `PATCH /notes/:id` takes the revision the edit was based on and answers
  `409` with the current note when it is stale. A `revision` counter on
  `Note` is cleaner than comparing `updatedAt`, which is deliberately not
  bumped by every change.
- `useAutosave` only has an `error` state and retries the same value on the
  next change, which for a `409` would never succeed. It needs a `conflict`
  state, and `NoteEditor` a dialog: keep mine, take theirs, or keep mine and
  put theirs into the history through `VersionsService`.
- Tricky: pin, favourite, notebook and tag changes (`updateMeta` in
  `NoteEditor`) are sent without content and must not conflict with typing in
  the same tab. Only check when `title` or `content` is in the request.
- Restoring a version changes the content as well and has to bump the
  revision.

### 9. Attachments and pasted images

Images only work as links to somewhere else on the web. I want to paste or
drop an image into the editor and have it uploaded and inserted as `![](...)`,
and to attach the odd PDF.

- New `Attachment` model (note, owner, file name, type, size, storage key)
  and an `attachments` module. Uploads can follow `TransferController`, which
  already uses multer through `FilesInterceptor`. Files go on a new volume in
  `docker-compose.yml`. S3-compatible storage can wait.
- Tricky: auth. The token lives in `localStorage` and is sent as a header by
  `request()`, which an `<img src>` cannot do. Either short-lived signed
  URLs, or fetch the file and hand `MarkdownPreview` an object URL. Shared
  notes (`/s/<token>`) need their images to load for anonymous readers too.
- Clean-up: `TrashService.purgeExpired` and `empty` delete rows with
  `deleteMany`, which would leave the files behind. Needs a sweep for files
  without a row.
- Export and import should carry the files. `ExportService.exportAll` writes
  only `.md`, and `ImportService` skips everything that is not Markdown or
  text, which drops the images of an Obsidian vault.
- Needs size limits per file and per account, and a list of allowed types.
  SVG is a script risk if it is served inline.

### 10. Share link options

A share link is all or nothing: one note, public until I stop sharing.

- Expiry and password: `expiresAt` and `passwordHash` on `ShareLink`, checked
  in `SharesService.view`, with the options in `ShareDialog`. A password
  means `GET /public/notes/:token` needs a way to receive it and
  `SharedNotePage` needs a prompt.
- Share a notebook: one link with an index page and the notes inside.
  `ShareLink.noteId` is required and unique today, so this is either a
  nullable `notebookId` beside it or a second model.
- Links between shared notes: `SharedNotePage` shows `[[links]]` as plain
  text because `MarkdownPreview` gets no `onWikiLink` there. When the target
  is shared as well (always true inside a shared notebook) it could link to
  that share.
- The public endpoint is not rate limited (`ThrottlerGuard` is only on
  sign-up and login) and every fetch bumps `viewCount`, my own included.
  Throttle it, and skip the count when the request carries the owner's token.

### 11. Account settings and sessions

Settings can change the password and nothing else about the account.

- Change name and email: `PATCH /auth/me`, asking for the current password
  when the email changes. The Account card in `SettingsPage` shows both
  read-only for now.
- Delete account: `DELETE /auth/me` with the password. The schema already
  cascades from `User` to notebooks, notes and tags, so it is one delete plus
  a confirm dialog that offers the export first.
- Sign out everywhere: logins are stateless JWTs valid for `JWT_EXPIRES_IN`
  (seven days) and `JwtAuthGuard` only checks the signature, so changing the
  password does not end a forgotten session. A `tokenVersion` on `User`, put
  in the token and compared in the guard, fixes that at the price of a user
  lookup per request.
- Password reset by email belongs here too, but needs outgoing mail (SMTP
  settings, and something like mailpit in compose for development). I would
  do it last.

### 12. More import sources and export formats

Import reads Markdown, text and zips of them, and export writes the same.
That covers Obsidian and this app, and not much else.

- Evernote `.enex`: one XML file with the note bodies as HTML. Needs an XML
  reader and an HTML-to-Markdown step. Tags and dates are in the file,
  notebooks are not.
- Notion export: a zip of Markdown in which file and folder names end in a
  32-character id and pages link to each other by relative path. Strip the
  ids and turn those links into `[[wiki links]]`.
- Both fit as extra readers in front of `ImportService.import`, which already
  works from a list of `{ path, text, modified }` candidates.
  `front-matter.ts` is a hand-written subset of YAML and will meet files it
  cannot read. Decide whether to keep extending it or take a YAML dependency.
- Importing the same zip twice creates every note twice. An option to skip
  notes whose title, notebook and text already exist would make a re-import
  safe.
- Export: a print stylesheet for the preview (`styles.css` has no
  `@media print` rules) gives PDF through the browser. A full JSON backup
  that includes the trash and version history would cover what the zip
  leaves out.

### 13. Personal API tokens

To script against the API today you log in with email and password and get a
seven-day JWT. I want long-lived tokens that I create and revoke in Settings,
for things like a shell alias that appends a line to a note or a cron job
that downloads the export.

- `ApiToken` model: name, hash of the token, a read-only flag, `lastUsedAt`.
  The token itself is shown once, when it is created.
- `JwtAuthGuard` gets a second path: a bearer value with a known prefix (say
  `nt_`) is looked up by hash instead of being verified as a JWT.
  `bearerToken()` stays as it is.
- Endpoints under `/auth/tokens` and a card in `SettingsPage`.
- Document the API while at it. `@nestjs/swagger` can build an OpenAPI
  document mostly from the existing DTO classes, served at `/api/docs`, and
  the endpoint table in the README can then shrink.
- Undecided: scopes beyond read-only, and rate limiting for token requests
  (only the auth routes are throttled). A "save this page" bookmarklet is
  better done as a `/capture?title=&url=` page in the web app, which needs
  neither a token nor CORS.

### 14. Offline mode and installable app

The layout works on a phone, but the app cannot be installed and needs a
connection for everything. Depends on item 8.

- Installable: a web manifest, icons (`web/public` only has `favicon.svg`)
  and a service worker that caches the app shell, for example with
  `vite-plugin-pwa`. `nginx.conf` then has to serve `index.html` and the
  worker file with `no-cache`. Only `/assets/` sets cache headers now.
- Read offline: the TanStack Query cache is memory-only (`queryClient.ts`).
  Persisting it to IndexedDB makes the notes that were already opened
  readable.
- Write offline: `request()` in `api/client.ts` throws `ApiError(0, ...)` when
  the server cannot be reached and `useAutosave` keeps the pending draft, but
  only until the tab closes. Needs an outbox that survives a reload and is
  replayed on reconnect, which is where conflict detection comes in.
- Tricky: creating notes offline needs ids made in the browser.
  `CreateNoteDto` has no `id` and the validation pipe rejects unknown fields.
- Search, backlinks and history stay online-only. Signing out has to clear
  the stored notes as well as the in-memory cache.

## Maybe

### 15. Deeper notebook nesting

Notebooks nest one level. Importing a vault with deeper folders flattens them
("A/B/C" becomes "B - C" inside "A"), which is the main reason I would want
more.

- The one-level rule is spread out: `assertCanBeParent`, `update` and
  `idsWithChildren` in `NotebooksService`, `notebookTree` and `totalNotes` in
  `web/src/lib/notebooks.ts`, the two-level markup in `Sidebar` and
  `NotebookSelect`, `notebookPath` in the importer and the folder building in
  `ExportService.exportAll`.
- Any depth means a recursive query for "this notebook and everything below
  it", a cycle check when moving a notebook, and a collapsible tree in the
  sidebar.
- Undecided: whether it is worth it at all when tags and links exist. A cap
  of three or four levels would keep the sidebar manageable.

### 16. Templates and daily notes

The demo data has a "Weekly review template" that is an ordinary note you
copy by hand.

- Templates: mark a note as a template (`isTemplate` on `Note`, left out of
  the normal lists and of search) and add "New from template" to the new-note
  button. `POST /notes` takes a `templateId` and copies content and tags,
  filling in placeholders such as `{{date}}` and `{{title}}`.
- Daily note: a "Today" entry in the sidebar that opens the note titled with
  today's date and creates it if needed. `GET /notes/resolve?title=` already
  answers whether a note with that title exists.
- A plain "Duplicate" button in the editor toolbar is a small first step and
  useful by itself.
- Tricky: "today" depends on the user's time zone, which the API does not
  know. Work out the title in the browser.
- Undecided: a column, or a reserved `template` tag that needs no migration.
  Also where per-user choices (which notebook, which template, date format)
  are kept. Preferences live in `localStorage` today (`useStoredState`,
  `useTheme`) and do not follow you to another device.

### 17. Notebooks shared with other accounts

Let a second person read or edit a notebook: invite them by email and it
shows up in their sidebar. Depends on item 8.

- The whole API assumes one owner. Every service looks notes up with
  `where: { id, userId }`. That has to become one shared access check: the
  owner, or a member of the note's notebook.
- `NotebookMember` model with a role (read or edit). Inviting an address that
  has no account yet needs outgoing mail.
- Tricky: tags belong to a user (`@@unique([userId, name])`) and `[[links]]`
  resolve by title among one user's notes (`LinksService.resolveKeys`). In a
  shared notebook, whose tags and whose titles? The simplest rule is that
  both follow the notebook's owner.
- Two people in one note need conflict detection at the very least. Live
  co-editing with cursors and merged keystrokes is a different project and
  not planned.

### 18. Graph view and unlinked mentions

Two ways to get more out of the links that are already stored.

- Graph: a page that draws notes as dots and `[[links]]` as lines, to spot
  clusters and orphans. All edges are in `note_links`. A `GET /links/graph`
  endpoint would return nodes and resolved edges in one query, reusing the
  title matching in `LinksService.resolveKeys`. Drawing it needs a force
  layout (d3-force or similar), and I doubt it stays readable beyond a few
  hundred notes.
- Unlinked mentions: under the backlinks, list notes that mention this note's
  title without linking to it, each with a "Link" button that wraps the
  mention in `[[ ]]`. Candidates can come from the full-text index, then be
  checked against the text with code blocks ignored. Short or common titles
  ("Ideas") will be noisy.
- A cheaper first step: an "Orphans" filter for notes with no links in or
  out.

## Shipped

### 3. Quick switcher

`Ctrl+K` (`Cmd+K` on a Mac, where `Ctrl+K` deletes to the end of the line)
opens a dialog built on `Modal` that lists the notes edited last and, once I
type, the titles from `GET /notes/titles?q=`, which is used as it was. Arrow
keys and Enter pick a note, and the cursor lands in its text, or on the
preview in preview mode. The arrow key handling moved out of `NoteEditor` into
`useActiveOption` and is shared with the `[[` suggestions. Beyond the design:
Enter pressed before the list is up to date waits for the answer instead of
opening a stale row, the note that is already open is left out, and the key
does nothing while another dialog is open. Still open: notebooks, tags and
actions in the list. Notes that share a title look the same there, and the
dialog has no button, so it needs a keyboard.

### 4. Search filters, phrases and paging

The search page loads results 30 at a time with "Load more", and two selects
above them narrow the search to a notebook (with the notebooks inside it, or
"Not in a notebook") and a tag. Both are kept in the URL next to `q` and go to
`GET /search` as `notebookId` and `tag`, which reach the raw SQL as bound
parameters. A phrase in double quotes is handed to `phraseto_tsquery` as it
was typed, so Postgres splits it the way it split the notes and `"node.js"`
or `"3.5 mm"` are found. There is no prefix matching inside the quotes, though
Postgres still stems, so `"meet"` finds "meeting", and a phrase can match
across the end of a title and the start of the text. A quote without a partner
is ignored, so a phrase that is still being typed searches as plain words. The
note list got the same two selects, and `NotesPage` applies `?view=`,
`?notebook=` and `?tag=` together. "Not in a notebook" moved to
`?notebook=none`, and `?view=unfiled` still works. Two fixes on the way:
results keep their order from page to page, and a search from the sidebar
while the search page is open is no longer overwritten by the text that was in
the box. Still open: `tag:foo` and `notebook:Work` typed into the box,
filtering on more than one tag, and the sidebar links, which replace the
filters instead of adding to them.

### 7. Scheduled backups

A `backup` service in `docker-compose.yml`, behind the `backup` profile, runs
`scripts/backup.sh` in the `postgres:17-alpine` image: a `pg_dump` into
`./backups` once a day, keeping the newest seven. It is a shell loop with
`sleep` rather than cron. It reads the age of the newest dump from the file
names when it starts, so a restart does not add one, and then looks at the
clock every minute. Beyond the design, the same script restores
(`backup restore <file>`), loading the dump into a new database that replaces
the old one only when the load worked. The README has the commands, and CI
runs `scripts/check-backup.sh` after the end-to-end tests: the loop and the
pruning against clocks that are wrong, three dumps while keeping two, a
restore into a scratch database and a row count of every table. Still open:
the dumps are not encrypted, they stay on the same machine unless
`BACKUP_DIR` points elsewhere, and nothing warns when a dump fails apart from
the service log.

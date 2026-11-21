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

Items 1 to 18 have shipped. An item from 19 on that starts with "Improves
item N" builds on something that has, and the Shipped note of item N says
what it left open.

Sizes are rough: **S** is an evening or two, **M** a few evenings up to a
couple of weekends, **L** several weeks of spare time.

## Overview

| #   | Item                                                | Group   | Area     | Size | Depends on |
| --- | --------------------------------------------------- | ------- | -------- | ---- | ---------- |
| 1   | Clickable task lists in the preview                 | Shipped | frontend | S    | -          |
| 2   | Changes view in version history                     | Shipped | frontend | S    | -          |
| 3   | Quick switcher                                      | Shipped | frontend | S    | -          |
| 4   | Search filters, phrases and paging                  | Shipped | both     | M    | -          |
| 5   | Rename a note without breaking links                | Shipped | both     | M    | -          |
| 6   | Accessibility pass                                  | Shipped | frontend | M    | -          |
| 7   | Scheduled backups                                   | Shipped | infra    | S    | -          |
| 8   | Edit conflict detection                             | Shipped | both     | M    | -          |
| 9   | Attachments and pasted images                       | Shipped | both     | L    | -          |
| 10  | Share link options                                  | Shipped | both     | M    | -          |
| 11  | Account settings and sessions                       | Shipped | both     | M    | -          |
| 12  | More import sources and export formats              | Shipped | both     | M    | -          |
| 13  | Personal API tokens                                 | Shipped | both     | M    | -          |
| 14  | Offline mode and installable app                    | Shipped | both     | L    | 8          |
| 15  | Deeper notebook nesting                             | Shipped | both     | M    | -          |
| 16  | Templates and daily notes                           | Shipped | both     | M    | -          |
| 17  | Notebooks shared with other accounts                | Shipped | both     | L    | 8          |
| 18  | Graph view and unlinked mentions                    | Shipped | both     | M    | -          |
| 19  | Security headers for the web app                    | Shipped | infra    | S    | -          |
| 20  | Compare two versions with each other                | Shipped | frontend | S    | -          |
| 21  | Links to headings and an outline                    | Shipped | both     | M    | -          |
| 22  | Encrypted, off-site and watched backups             | Next    | infra    | M    | -          |
| 23  | Keyboard and screen reader follow-ups               | Next    | frontend | M    | -          |
| 24  | Tasks across notes                                  | Later   | both     | M    | -          |
| 25  | Search syntax, several tags and saved searches      | Later   | both     | M    | -          |
| 26  | Code highlighting, math and diagrams in the preview | Later   | frontend | M    | -          |
| 27  | Two-step sign-in and verified email changes         | Later   | both     | M    | -          |
| 28  | Select several notes at once                        | Later   | both     | M    | -          |
| 29  | Live change notices in open notes                   | Later   | both     | M    | -          |
| 30  | Tests in a real browser                             | Later   | infra    | M    | -          |
| 31  | Embedding one note in another                       | Maybe   | both     | M    | 21         |
| 32  | A graph that copes with more notes                  | Maybe   | frontend | M    | -          |
| 33  | Thumbnails, object storage and Evernote attachments | Maybe   | both     | L    | -          |

## Next

### 22. Encrypted, off-site and watched backups

Improves item 7. The dumps are not encrypted, stay on the same disk unless
`BACKUP_DIR` points elsewhere, and a failed dump only shows in
`docker compose logs backup`.

- Encryption: with `BACKUP_ENCRYPT_TO` set to an `age` public key,
  `scripts/backup.sh` encrypts each dump and its `.files.tar` as they are
  written and keeps no plain copy. `restore` decrypts with a key file that is
  mounted only for the restore. The `postgres:17-alpine` image has no `age`,
  so the service either installs it on start or gets a small image of its own
  built from that one.
- Off-site copy: an optional `BACKUP_COPY_COMMAND` run after each good dump
  with the new files as arguments, documented with `rsync` over SSH and
  `rclone` (which reaches self-hosted S3-compatible storage too). Pruning
  copies on the other side is left to the other side.
- Watching: the service writes the time of the last good dump to a file, and
  a `healthcheck` in `docker-compose.yml` turns it unhealthy when that is
  more than a day and a bit old. An optional `BACKUP_ALERT_URL` gets a `POST`
  on every failure, which works with a self-hosted ntfy or any webhook.
- Tricky: `dumps()`, `prune()` and `newest_dump_time()` read the time from
  file names. Encrypted files end in `.age` and have to be counted the same
  way, a plain and an encrypted file of the same time are one dump, and the
  future-dated rules still hold.
- Tricky: a failed encryption must leave no plain file behind, a failed copy
  is not a failed dump but still alerts, and `check-backup-loop.sh` needs
  stand-ins for `age`, the copy and the alert to prove both.
- Undecided: installing `age` on start (needs the network every time) or a
  built image (one more thing to build). And whether the JSON backup in
  Settings should offer a passphrase too.

### 23. Keyboard and screen reader follow-ups

Improves items 6 and 15, whose notes list what is left: nobody has used the
app with a real screen reader, every note in `NoteList` is its own Tab stop,
the focus stays put when the menu opens on a narrow screen, the arrow keys do
not move through the notebook tree, and the filter selects show the whole
tree without folding.

- `NoteList`: one Tab stop for the whole list, with a roving `tabIndex` on
  the open note or else the first one. The list already handles Up, Down,
  Home and End, so Tab then gets past 500 notes in one press.
- Notebook tree in `Sidebar` and in `NotebookSelect`: Up and Down move,
  Right opens a folded notebook or goes into it, Left folds it or goes to
  the notebook above, Home and End, as in the ARIA tree pattern.
- Narrow screens: opening the menu moves the focus to its first link, and
  Escape closes it and puts the focus back on the menu button.
- `FilterSelects` and the "Inside" select of `NotebookDialog`: keep them as
  native selects, which every screen reader knows, and write each option as
  its path ("Work / Meetings") instead of relying on indentation.
- A pass with NVDA and Firefox and with VoiceOver and Safari, kept as a short
  checklist in the README, with what it finds fixed. The axe tests stay.
- Tricky: item 15 chose nested lists of links and buttons over `role="tree"`
  on purpose. Adding arrow keys to them without the role keeps the links
  readable as links, while the full tree role changes how screen readers
  read everything inside it.
- Undecided: whether the tree gets `role="tree"` after all, and whether a
  roving Tab stop in `NoteList` should remember its place when the list
  reloads.

## Later

### 24. Tasks across notes

Task boxes can be ticked in the preview (item 1), but open tasks spread over
twenty meeting notes have no list of their own.

- A Tasks page with every unticked `- [ ]` in the notes, grouped by note,
  newest note first, with the notebook and tag selects of `FilterSelects`.
  A click on the text opens the note at that line.
- Where they come from: a `NoteTask` table kept in step on every save the
  way `LinksService.sync` keeps `NoteLink`, with note, line, text and done.
  The server parser (`parseNote` in `api/src/links/prose.ts`, micromark with
  GFM) already knows task items, so they are read in the parse pool with its
  limits. A migration or a start-up step fills in the notes that exist.
- Ticking a box on the page: `POST /notes/:id/tasks` with the line, the
  state the box showed and the note's revision, written through
  `writeNoteText` the way the mention "Link" is, and only when that line
  still holds a box in that state (the rule of `toggleTask` in
  `web/src/lib/tasks.ts`). A note that changed meanwhile is a conflict, not
  an overwrite.
- Members of a shared notebook see its tasks only, through `AccessService`.
  Editors tick, readers do not.
- Tricky: templates (`workingNotes`), the trash and notes past the parser's
  limits stay out, and the page says when some notes could not be read.
  Line numbers move when a note changes, which the revision check covers.
- Undecided: due dates. A plain convention such as `due:2026-11-30` after a
  task would let the page sort and show what is late. A reminder by mail
  would need a scheduler and SMTP and is a step further; I would leave it
  out.

### 25. Search syntax, several tags and saved searches

Improves item 4, which left open `tag:foo` and `notebook:Work` typed into the
box, filtering on more than one tag, and sidebar links that replace the
filters instead of adding to them.

- `parseSearch` in `api/src/search/search-query.ts` learns `tag:` and
  `notebook:`, with double quotes for names with spaces
  (`notebook:"Reading list"`), and `-word` to leave a word out. What it reads
  goes into the same bound parameters as the selects.
- Several tags: `tag` on `SearchQuery` and `ListNotesQuery` becomes a list
  that must all match, `?tag=a&tag=b` in the URL, through `readFilters` and
  `withFilters` in `web/src/lib/filters.ts`.
- Saved searches: name a search with its filters and find it in the
  sidebar. A short list in `preferences` on `User`, validated in
  `api/src/auth/preferences.ts`, so it follows the account to every device.
- Tricky: the selects and the typed words can both name a notebook. The
  request has to merge them, and the page has to show which filter came from
  where. Notebook names repeat at different levels ("Meetings" in Work and in
  Home), so `notebook:Meetings` either means all of them or needs a path
  (`notebook:Work/Meetings`). For a member, only the shared notebook's names
  count.
- Undecided: whether a sidebar link adds to the filters or replaces them.
  Adding is what item 4 wanted, but it surprises when the old filter is out
  of sight.

### 26. Code highlighting, math and diagrams in the preview

Fenced code shows as plain monospace text, and there is no way to write a
formula or a small diagram. All three are common in notes about programming,
study or planning.

- Highlighting: a fenced block that names its language gets colours, through
  `rehype-highlight` with a set of common languages, loaded on demand like
  the graph page (`lazyPage`) so the main bundle does not grow.
- Math: `$...$` and `$$...$$` through `remark-math` and `rehype-katex`, with
  KaTeX's styles and fonts in the build, nothing from a CDN.
- Diagrams: a ` ```mermaid ` block drawn by mermaid, loaded only when
  a note has one, with `securityLevel: 'strict'`.
- Tricky: `$` in ordinary notes ("costs $5 or $10") turns into math. Single
  dollars can be switched off in `remark-math`, at the price of the most
  common way to write inline math.
- Tricky: mermaid is large and writes SVG with inline `<style>`, which a
  strict style policy from item 19 refuses. The parser in the API
  (`prose.ts`) has to agree on what is not plain text, so mentions do not
  match inside a formula, and `extractWikiLinks` may have to skip math as it
  skips code.
- The colours of the highlighting need both themes in `styles.css` and the
  pairs in `styles.contrast.test.ts`. Shared pages and print render the same.
- Undecided: whether diagrams are worth mermaid's weight, or come later.

### 27. Two-step sign-in and verified email changes

Improves item 11. A password is the only thing between the internet and every
note, a new email address is taken without checking that it works, and a
mail that could not be sent shows only in the API log.

- One-time codes from an authenticator app (TOTP, RFC 6238), built on
  `node:crypto`. Settings shows a QR code and the secret, the first code
  turns it on, and ten recovery codes are shown once and kept as hashes.
- `POST /auth/login` answers with a short-lived ticket instead of a token
  when codes are on, and `POST /auth/login/code` takes the ticket and a code.
  Throttled per account as well as per address (`AccountThrottlerGuard`), so
  the million codes cannot be tried.
- A new email address: `PATCH /auth/me` keeps it pending and mails a link to
  it, under the password reset's rules (hashed, once, an hour). The old
  address gets a notice. Without SMTP the change goes through as today.
- Tricky: a password reset by mail must still ask for the code afterwards,
  or the reset becomes the way around it. Turning codes off takes the
  password and a code. A code is accepted once, with one step of clock drift
  either side.
- Tricky: the secret is stored encrypted with a key from the environment,
  stays out of the JSON backup, and a restore of the database dump keeps it.
  API tokens keep working, but making one should ask for a code too.
- Undecided: WebAuthn passkeys instead of or beside TOTP. They need no
  shared secret but are more work in the browser and in tests.

### 28. Select several notes at once

Moving twenty imported notes into a notebook, tagging a batch, or sending a
batch to the trash is one note at a time today.

- `NoteList` gets a selection: a box per row, Shift with a click for a range,
  and a bar with Move to, Add tag, Remove tag, Pin and Move to trash.
- `POST /notes/bulk` with the ids and one action, in one transaction, up to
  500 ids, answering which notes changed and which were skipped. Each note
  goes through `AccessService`, and a member's editor role only covers tags
  (item 17), so a mixed selection is refused in part, and the answer says
  which.
- None of these touch title or content, so none can conflict (item 8). They
  need a connection, like pins and tags offline (item 14), and say so.
- Tricky: the list loads in pages (`useInfiniteQuery`), so "select all" can
  only mean the loaded rows unless the action takes the filters instead of
  ids. A move cannot be undone the way the trash can, so the bar wants an
  "Undo" notice for a while.
- Tricky: Space and Shift with the arrow keys should select from the
  keyboard, which goes with the roving Tab stop of item 23. A screen reader
  has to hear how many are selected.
- Undecided: whether selecting replaces opening a note on click, or needs a
  "Select" button first.

### 29. Live change notices in open notes

Improves items 8 and 17. A tab that only has a note open is not told that it
changed elsewhere until it saves, and a member of a shared notebook learns of
someone else's change only by opening the note.

- A stream of server-sent events at `GET /events` that says "note X is now
  at revision N" for the notes the account can see. An open note with
  nothing unsaved quietly loads the new text. One with unsaved text shows a
  line that it changed elsewhere and offers the conflict question before more
  is typed.
- The sidebar marks the notes of a shared notebook that someone else changed
  since I last opened them.
- Tricky: `EventSource` cannot send an `Authorization` header, and the token
  is in `localStorage`. Either `fetch` with a streamed body and its own
  reconnect, or a one-time ticket in the address like `DownloadTickets`,
  which then shows up in logs. nginx needs `proxy_buffering off` and a long
  timeout for that path.
- Tricky: a member who is removed, a "sign out everywhere" and a password
  change have to end the stream at once, not at the next reconnect. One API
  process can fan out from memory. With more than one, the revision trigger
  of item 8 could `pg_notify` and every process `LISTEN`.
- Undecided: one stream per tab, or one shared between tabs through a
  `BroadcastChannel`. And where "last opened" is kept for the marks. Live
  co-editing stays out, as item 17 said.

### 30. Tests in a real browser

Improves the tests of items 6, 9 and 14. jsdom has no service worker, no
real IndexedDB across a reload, no paste of a file and no colours, so the
parts most likely to break quietly are tested in pieces or not at all.

- Playwright in a folder of its own (`e2e/` at the root, with its own
  `package.json`), run against the Docker stack built from the branch, in a
  CI job after the image build. Chromium first.
- A handful of flows: sign up, write a note and find it after a reload;
  go offline (`context.setOffline`), write, reload, come back and see it
  saved; paste an image and see it in the preview; two pages on one note
  meet the conflict question; axe with `color-contrast` turned on.
- Tricky: the service worker only exists in a build, so the tests run the
  built stack, never `npm run dev`. Each test signs up its own account, as
  the API's end-to-end tests do. Waits go on state and requests, never on
  fixed times, or the job turns flaky and gets ignored.
- Undecided: whether the job blocks a merge from the start, and whether it
  runs on every pull request or only on those that touch `web/` or the
  compose files.

## Maybe

### 31. Embedding one note in another

`![[Note]]` would show another note's text inside this one, and
`![[Note#Heading]]` only that section. Depends on item 21 for the second
form.

- `linkifyWikiLinks` and `MarkdownPreview` learn the `!` form and draw the
  other note read-only in a frame with a link to open it.
- The API counts an embed as a link: `extractWikiLinks` stores it in
  `NoteLink` and `renameLinks` keeps the `!`, so backlinks, orphans and the
  graph see it.
- Tricky: loops (A embeds B, B embeds A) and depth, so a cap of a few levels
  with a plain link past it. A member must not see an embed of the owner's
  note from outside the shared notebook, and a shared page only embeds what
  its links may already open (item 10's rules); anything else stays words.
- Tricky: ten embeds are ten fetches unless there is a request for several
  titles at once. Task boxes inside an embed stay read-only, and the search
  does not find a note by the text it embeds.
- Undecided: what the zip export and print do with an embed, keep the
  syntax or write out the text.

### 32. A graph that copes with more notes

Improves item 18. The layout runs on the main thread, about a third of a
second at 300 notes, above 300 only the filters show the rest, links have no
arrowheads, dots cannot be moved and two fingers do not zoom.

- `layoutGraph` is already a plain function, so `useGraphLayout` can hand it
  to a Web Worker and show the list under the picture while it runs. The
  worker is part of the build, so the service worker keeps it too.
- A local graph: the notes around the open note, two links deep, from
  `neighbours` in `web/src/lib/graph.ts`. That is what stays readable at any
  size.
- Arrowheads sized in screen pixels like the dots, zoom with two fingers
  through pointer events, and dragging a dot.
- Tricky: the picture depends only on the notes and links, which makes it
  stable. A dragged dot breaks that unless its place is remembered, in the
  browser or not at all.
- Undecided: whether the 300 cap in `GET /links/graph` goes up, and whether
  a canvas takes over from SVG above some number of notes.

### 33. Thumbnails, object storage and Evernote attachments

Improves items 9 and 12, which left all three open.

- Thumbnails: a photo from a phone is shown and downloaded at full size.
  Scaling it down in the browser before the upload needs nothing new on the
  server, and drawing it again on a canvas also drops the location the camera
  wrote into it. Keeping the original as well is undecided.
- Object storage: `AttachmentStorage` (`write`, `exists`, `remove`, `sweep`)
  becomes an interface with a second, optional implementation for
  S3-compatible storage that can be self-hosted (MinIO, Garage), set through
  `ATTACHMENTS_S3_*`. Files still go out through the API's signed addresses.
- Evernote: in an `.enex` each `<resource>` holds the file in base64 with
  its type and an MD5 hash that `<en-media hash="...">` in the note points
  at. `enex.ts` reads as a stream and the resources come after the text, so
  a note is held until its resources are read. They go through `sniff.ts`
  and the account limits like any upload.
- Tricky: with object storage, `scripts/backup.sh` can no longer archive the
  files beside each dump, so the bucket needs a backup of its own and the
  README has to say so. The export and the JSON backup read through the
  interface and keep working.
- Undecided: whether object storage is worth it at all for a self-hosted
  notes app, where one volume is simpler.

## Shipped

### 1. Clickable task lists in the preview

Clicking a task box in the editor's preview flips `[ ]` and `[x]` on that
line of the note. The change goes through the normal autosave, so versions
behave as they do for typing. Boxes stay disabled on shared pages, in version
history and for notes in the trash. Different from the plan: `onToggleTask`
gets the line and the state the box showed, and the text only changes when
that line holds a box in that state, with a space or the end of the line
after it. Line numbers did not always match the source: `linkifyWikiLinks`
dropped a lone `\r` inside a link, which the parser counts as a line ending.
It now keeps every line ending, and boxes go read-only should the preview and
the source ever differ in their number of lines. Added on top: each box is
named after its item for screen readers, it keeps keyboard focus after a
click, and the caret in the source stays where it was. Still open: clicking
does nothing in two rare layouts, a box on a different line from its list
marker and a task on the first line of a footnote definition.

### 2. Changes view in version history

The history dialog has a Preview / Changes switch. Changes shows a line diff
from the selected version to the text in the editor, which `NoteEditor`
passes in, so an unsaved draft is compared correctly. A changed title is
shown above the diff, compared the way the API stores titles (trimmed, and
"Untitled" when empty). No API change. I wrote the diff in
`web/src/lib/diff.ts` and did not add the `diff` package: lines that match at
the start and the end are set aside, and the rest goes through Myers'
algorithm, whose work grows with how much changed and not with the length of
the note. The cut-off is 2,000 added and removed lines, past which the view
shows a plain message. A single block that was only added or only removed is
exempt. At most 2,000 rows are shown, followed by how many more lines
changed. Added on top: unchanged stretches are folded to three lines around
each change. Still open: changes inside a line are not highlighted, folded
lines cannot be expanded, and two versions cannot be compared with each
other.

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

### 5. Rename a note without breaking links

After a rename, the editor shows how many notes still link to the old title
and offers "Update N links from [[old]] to [[new]]". The offer waits until
the cursor has left the title field and the title is saved, and is not made
for a note left without a title. As planned, the rewrite is a separate
`POST /notes/:id/rename-links`, the title `PATCH` rewrites nothing, and
`renameLinks(markdown, from, to)` sits beside `extractWikiLinks` and reads
notes through the same scanner. The request names the old title, which the
editor remembers from when the note was opened, so a title that saved in
several steps still works. A `GET` on the same path gives the count for the
offer. The rewrite runs in one transaction that holds the renamed note, saves
a version of each note first and leaves `updatedAt` alone. Nothing is offered
or rewritten while a note still has the old title. Beyond the design: nothing
is rewritten when another note has the new title too, or when the new title
cannot be written as a link (`[`, `]`, `|`, `#` or a backtick in it). A note
that was edited since it was read is skipped and not overwritten, and so is a
note that would grow past the size limit. The answer lists the notes that
were rewritten, which the editor drops from its cache so that none is opened
with its old text, and counts the ones that were skipped, for which the offer
stays. Still open: the offer lives in the editor where the rename happened and
is gone after leaving the note, notes in the trash and a note's links to
itself are not rewritten, and a link with inline code between its brackets
stays as it is.

### 6. Accessibility pass

Every gap on the list is closed. `Modal` keeps Tab inside the dialog and gives
the keys to the dialog on top when two are open. Opening a second dialog from
a first leaves the focus in the second. On close the focus goes back to where
it was, or to the main region when that control is gone. The note textarea
points at the `[[` suggestions with `aria-controls` and
`aria-activedescendant`. The quick switcher already did, and now also says how
many notes it found. Two skip links lead to the content and, when a note is
open, to the note. `prefers-reduced-motion` stops the spinner, which shows its
label instead, and the sliding menu. Up, Down, Home and End move through
`NoteList`. The page and dialog tests run axe through `vitest-axe` with one
helper, on every page of the app including sign-in, sign-up and the password
reset pages. Only `color-contrast` is off, and `region` for parts rendered
without the layout. What axe found is fixed: task boxes without a name, a
heading level skipped above the backlinks, pages without a `main` landmark and
a second banner inside dialogs. Contrast is covered by
`styles.contrast.test.ts`, which computes the ratios of the colour pairs in
`styles.css` for both themes. Muted text, the accent, the danger red, the
colour of links to missing notes, the favourite star and the outline of text
fields were changed to reach AA. Beyond the list: the title field shows its
focus, on narrow screens the closed menu is out of reach of Tab, and `/` no
longer opens that menu on a wide screen, where its shade had squeezed the
page. Still open: nobody has used the app with a real screen reader yet, the
contrast test only knows the pairs listed in it, every note in `NoteList` is
still its own Tab stop, and the focus does not move into the menu when it
opens on a narrow screen.

### 7. Scheduled backups

A `backup` service in `docker-compose.yml`, behind the `backup` profile, runs
`scripts/backup.sh` in the `postgres:17-alpine` image: a `pg_dump` into
`./backups` once a day, keeping the newest seven. It is a shell loop with
`sleep` rather than cron. It reads the age of the newest dump from the file
names when it starts, so a restart does not add one, and then looks at the
clock every minute. Beyond the design, the same script restores
(`backup restore <file>`), loading the dump into a new database that takes
the place of the old one in a single transaction, and only when the load
worked. The README has the commands, and CI runs `scripts/check-backup.sh`
after the end-to-end tests: the loop and the pruning against clocks that are
wrong, three dumps while keeping two, a restore into a scratch database and
over one that holds something else, and a row count of every table. Still
open:
the dumps are not encrypted, they stay on the same machine unless
`BACKUP_DIR` points elsewhere, and nothing warns when a dump fails apart from
the service log.

### 8. Edit conflict detection

A note has a `revision` that counts the changes to its title and content.
`PATCH /notes/:id` takes the revision an edit was based on and answers `409`
with the current note when it is stale, but only when title or content is
sent, so pinning, tags and moving never conflict. The check and the write are
one conditional update, so of two saves that race from the same revision only
one gets through. Different from the plan: the counting is done by a database
trigger, as for `search_vector`, and not by the services. That way every
write of the text bumps the revision in its own statement: saves, restores,
link rewrites and code that is not written yet. `useAutosave` has a `conflict`
state and does not retry, and the editor asks what to keep: mine, theirs, or
mine with theirs put into the history. "Take theirs" fetches the note anew.
Closing the question decides nothing. Leaving the note with it open, or with
a change from elsewhere that only the last save notices, saves my text and
keeps theirs as a version, and a notice says so afterwards. A draft that
cannot be saved when a note is left, because the connection or the session is
gone, is kept in the tab under the user's id and offered when the note is
opened there again. Signing out saves first and asks before it discards. A
save whose answer got lost is recognised by its text and is no conflict. A
restore now saves what is typed first, and is refused when that fails or when
a save gets in between. A save without a revision works as before: the last
write wins. Still open: the two texts are not merged, the question shows no
diff (History does, after "keep mine, put theirs in the history"), a tab that
only has a note open is not told about a change before it saves, and a kept
draft does not outlive its tab.

### 9. Attachments and pasted images

Paste or drop an image or a PDF into a note and it is uploaded and linked as
`attachment:<id>`; a panel under the editor lists a note's files.
`Attachment` rows point at files kept under their ids on the new
`attachments` volume. The type comes from the bytes: PNG, JPEG, GIF, WebP,
PDF and plain text, never SVG or HTML, with limits per file and per account.
Files are served at addresses signed with an HMAC over the file, its owner
and an expiry five minutes ahead, so an `<img>` needs no login; images
inline, the rest as downloads, always with nosniff and a sandboxing policy.
A shared note hands out signed addresses for its own files only. Deleting
notes for good removes their files, and the purge job sweeps files without a
row on start-up and every hour. The zip export, the JSON backup and the
import carry the files; the import keeps the images and PDFs an Obsidian or
Markdown note links to. The scheduled backup archives the files beside each
dump and a restore puts them back with it, never while the API runs. Still
open: Evernote's attachments, thumbnails and S3-compatible storage.

### 10. Share link options

A share link can run out and can ask for a password: `expiresAt` and
`passwordHash` on `ShareLink`, set in the share dialog and checked in
`SharesService.view`. A link that has run out answers exactly like one that
never existed, and the dialog tells the owner. A link with a password answers
`403` so that the shared page can ask, and takes the password in the body of
a `POST`, never in the address. The public endpoint is throttled, with a
roomy limit for reading and a strict one for password attempts per client,
and each link takes only so many wrong passwords a minute from everyone
together, which a persistent guesser can use to keep readers out but never
the signed-in owner. A request with the owner's login is no longer counted
as a view, and nothing these routes answer may be cached.

The second step shares a notebook with one link. `ShareLink` got a
`notebookId` beside `noteId`, with a check in the database that exactly one
is set. The link shows a list of the notes in the notebook and in the
notebooks inside it, and each note on a page of its own. Which notes belong
is asked with every request, so a note added later is there and one moved
out or deleted is gone at once. The options are the same, and the right
password comes back with a proof that opens the other notes for an hour, so
it is typed once. A `[[link]]` leads on to a note of the same shared
notebook, looked up among those notes first, or else to a note whose own link
has no password and has not run out. Every other link is sent as its plain
words, so that no title from outside the shared notes gets out. Notes and
notebooks say when a shared notebook makes them public, and moving one into
a shared notebook asks first. Still open:
a link shows that it has a password, a notebook link has no search, and the
shared pages are not styled for printing.

### 11. Account settings and sessions

Settings can now change the name and the email (`PATCH /auth/me`, the email
only with the current password), delete the account with everything in it
(`DELETE /auth/me` with the password, behind a dialog that offers the export
first) and sign out everywhere (`POST /auth/logout-all`). Sessions end
through a `tokenVersion` on `User` that every token carries and
`JwtAuthGuard` compares on each request, at the price of one small query per
request. Changing the password bumps it too and gives the browser that made
the change a new token. Different from the design: a wrong password on these
routes answers `403` instead of `401`, because the web app signs out on any
`401`, and the routes are throttled like login.

Password reset by email came last, as planned. "Forgot password?" on the
sign-in page mails a link that works once, for an hour. Only a hash of its
token is stored, using it signs the account out everywhere and ends the
account's other links, and the request answers the same whether or not the
address has an account. An account has three links out at most, and asking
again never cancels one, so nobody can keep a stranger's link from working
or flood a mailbox. Mail goes out through nodemailer over SMTP (`SMTP_HOST`
and friends), over TLS unless told otherwise, with mailpit in
`docker-compose.yml` to catch it during development. Without SMTP settings
the reset is off and the link is hidden. Along the way the throttles learned
to count per visitor behind nginx (`TRUST_PROXY`). Still open: a new email
address is not verified, the mail is plain text in English only, and nothing
but the API log tells me when a mail could not be sent.

### 12. More import sources and export formats

The import now reads Evernote `.enex` files and Notion exports as well, as
readers in front of `ImportService.import`. An `.enex` goes through a
streaming XML parser that reads no DTD and knows no entity beyond XML's own,
so nothing in the file can expand or reach out; its notes become Markdown
through turndown, with tags and dates, in a notebook named after the file.
Attachments are counted and left out. A Notion zip loses the 32-character
ids from its names, and links between its pages become `[[wiki links]]`.
Every zip is read within limits: entries, depth, 4 MB per file and 100 MB per
import, counted while unpacking; no entry may lead out of the zip, and a zip
inside a zip is not opened. Front matter is read by the `yaml` package with
the core schema, and a block that is not clean YAML stays in the note. A
re-import leaves out notes whose title, notebook and text are there already,
unless told not to. The second step added the export formats. "Print" in the
browser gives the note alone, black on white, with link addresses written
out, so "Save as PDF" makes a clean page. A full JSON backup of one account,
versioned and streamed, holds the trash, version history, revisions,
notebooks, tags, templates, daily notes and a record of the share links without their tokens or
password hashes. It restores into an empty account in one transaction, read
as it is uploaded, so a backup of any size restores, and the browser saves a
download straight to disk through a one-time link.
Share links are not made again, since the file holds nothing that would open
them. Still open: Evernote attachments,
Notion databases (they arrive as CSV and are skipped), and a Notion export
that Notion packed twice has to be unzipped once by hand.

### 13. Personal API tokens

Settings has an "API tokens" card: name a token, tick read-only if it should
only read, copy it once. Only its SHA-256 hash is kept in the new `ApiToken`
model, with the name, the read-only flag, `lastUsedAt` and the date. In
`JwtAuthGuard` a bearer value that starts with `nt_` is looked up by that
hash instead of being verified as a JWT, and the same place refuses what a
token may not do: anything but `GET` for a read-only one, and for every token
any route that is not marked `@AllowApiToken()`. Marked are the notes
themselves and `GET /auth/me`, so the account, the tokens and whatever is
added later take a login. Decided on the open points: no scopes
beyond read-only, and requests are throttled per token
(`API_TOKEN_THROTTLE_LIMIT` a minute). `lastUsedAt` is written at most once a
minute. Making a token takes the password, so a stolen login cannot make
itself a credential that outlives it. "Sign out everywhere" and a password
change leave tokens alone, and after a password change the app says how many
still work and offers to revoke them all at once. A password reset by mail
revokes them.

The second step documented the API. `@nestjs/swagger` builds an OpenAPI
document from the DTO classes at build time and serves it, with a page to try
it on, at `/api/docs`. It names the two credentials and says for every route
which of them it takes, read from the same marks the guard goes by. The
endpoint table in the README shrank to the few a script wants. And
`/capture?title=&url=` in the web app opens a new note with the title and
the address of a page, which a bookmarklet from the README turns into one
click. Any site can send a visitor there, so it saves nothing by itself, the
title stays out of the note's text, and only a plain web address is taken.
`API_DOCS=false` turns the document off. Still open: the document describes
requests but not answers.

### 14. Offline mode and installable app

Built in three parts. The app can be installed: a manifest, icons and a
service worker written by hand rather than with `vite-plugin-pwa`, which
caches only the files of the build and never anything under `/api/`, asks
the network first for pages, and offers a reload into a new version that
every open tab follows. `web/sw-retire/sw.js` takes the worker out of use if
it ever has to go. Notes already opened can be read offline: the query cache
is kept in IndexedDB, one record per user, limited to notes, lists,
notebooks, tags and links, 5 MB and seven days per note, and deleted on every
way out of a session. Text and new notes can be written offline: an outbox
in IndexedDB sends them through the normal create and save on reconnect, in
order per note and without applying anything twice, and a change that meets a
newer note raises the usual conflict question instead of overwriting it.
`POST /notes` takes a client-made id, refused with the same answer for
anyone. Different from the plan: the outbox is kept, not wiped, when a session
ends by itself, and sent at the same user's next sign-in. Still open: pins,
tags, notebooks and the trash need a connection, and a note made offline is
not in the lists until it is sent.

### 15. Deeper notebook nesting

Notebooks nest four levels deep. I took the cap over any depth: it keeps the
sidebar readable, and four levels hold the vaults I have seen. The number is
`MAX_NOTEBOOK_DEPTH` in `NotebooksService`, which enforces it, and the same
constant in `web/src/lib/notebooks.ts` decides what the app offers.

Creating, moving and deleting a notebook each run in one transaction that
first locks the account's row (`lockTree`) and then reads the tree. The checks
for depth and for loops therefore see what they are about to change, and two
moves made at the same moment cannot put two notebooks inside each other. A
move takes along what is inside the notebook and is refused when that would
end below the fourth level. Deleting a notebook deletes the notebooks inside
it and moves the notes of all of them to the trash. `idsWithChildren` kept its
name and is one recursive query for "this notebook and everything inside it",
used by the note list, the search, the graph and the links that share a
notebook, which so cover every level inside it. `sharedThrough` looks as far
up as notebooks nest. No migration was needed, `parentId` was there already,
so one-level data is untouched.

The importer keeps folders as notebooks four levels deep and joins what is
deeper into the fourth ("D - E"), the way it used to join everything below the
first. It makes the notebooks of each note in the transaction of that note,
under the same lock as a move, so a move at the same moment cannot push them
deeper. The exporter writes nested folders, read in one snapshot. A folder
claims its name before the files next to it, so a notebook and a note that
want the same name in the zip both get in.

In the sidebar the notebooks are a nested list with a fold button in front of
every notebook that has others inside, and the folded ones are remembered in
the browser. The notebook of a note is picked from a list that folds the same
way (`NotebookSelect`), with its own memory. Both are plain nested lists of
links and buttons, so Tab, Enter and Space work them. The notebook dialog only
offers places where the notebook fits with what it holds.

Still open: the filter selects above the lists and the "Inside" select of the
notebook dialog are ordinary selects that show the whole tree indented and do
not fold. The arrow keys do not move through the tree. A notebook cannot be
dragged to another place, and the lock makes two changes to the notebooks of
one account wait for each other, which nobody will notice.

### 16. Templates and daily notes

Both are built. A note becomes a template through `isTemplate`, a column and
not a reserved tag. Templates have a view of their own and are kept out of
the lists, the search, the quick switcher, link completion, backlinks and the
counts on notebooks and tags by one condition, `workingNotes` in
`api/src/notes/note-scope.ts`, which all of those queries share.
`POST /notes` takes a `templateId` and copies the template's content and
tags. The placeholders are a closed set, `{{date}}`, `{{time}}` and
`{{title}}`. Date and time are worked out in the browser and sent as text, so
the API never guesses what day it is, and anything else in double braces is
left as written. A template's links are copied as text and stored for the
new note. Neither a note from a template nor a duplicate takes the pin, the
star, the share link or the history along. "Today" in the sidebar sends the
browser's day to `POST /notes/daily`, which opens the note of that day or
makes it, in one step. Different from the plan: the note is not found through
`GET /notes/resolve` and its title but through a `dailyDate` column with a
unique index on user and day. That is what keeps two tabs from making two
notes, and it lets the note survive a rename and a change of the date format.
The browser sends only the day, and the server writes the title in the format
stored at that moment. A note titled with the day, in any format, is taken
for the note of that day, and "Not the daily note" (`DELETE
/notes/:id/daily`) lets it go for good. The notebook, the template and the date format are a small
validated `preferences` JSON on `User`, read with `GET /auth/me` and written
through `PATCH /auth/preferences`. Theme and editor mode stay in
`localStorage`. A note from a template starts untitled with the cursor in its
title, and `{{title}}` is only filled with a title that is given. Beyond the
design: a link to a template's title still leads to it unless a note has that
title, renaming a note also updates the links in templates, notebooks count
their templates apart so that deleting one can say they go too, and export
and import keep the template flag. Still open: placeholders are also filled
inside code, a template can still be shared by a link like any note, there
is no page that lists the daily notes or steps from one day to the next, and
`{{date}}` does not follow the chosen date format.

### 17. Notebooks shared with other accounts

Built as planned, with tags and link titles following the owner. One access
check, `AccessService`, sits in front of every route that takes a note or a
notebook: owner, member of the note's notebook or of one above it, at any of
the four levels (the same recursive query as `idsWithChildren`), or a `404`.
Writes check again inside their transaction with the note row locked. The
services keep looking notes up by owner and id, with the owner the check
hands back, so a route that forgot the check fails closed; an end-to-end
test walks every note route as an outsider and expects `404`.
`NotebookMember` has a read or edit role. Invitations are accepted only with
the token of their link, under the password reset's rules plus a week of
life; the link is mailed, or without mail shown once to the owner. Sends are
counted per account an hour and per account and address a day. Members see nothing of
the owner beyond the notebook: links, backlinks, titles, mentions, the graph
and search with the notebook filter are kept to it, and templates and the
trash stay out. Two editors meet the conflict question of item 8. Owners
change roles and remove members, members leave, and a change in a member's
outbox for a note they lost is refused and listed. Different from the plan:
an editor changes text and tags, adds notes and attaches files, but pins,
moving, templates, share links, renaming or linking across the owner's
notes, duplicating and the trash stay the owner's. Still open: no
notifications when someone changes a shared note, and the demo seed has no
second account to share with.

### 18. Graph view and unlinked mentions

Both halves are built, and the Orphans view with them. Orphans is a view in
the sidebar, `GET /notes?orphans=true`, for notes with no link to or from
another note outside the trash. A link to a missing title, to the trash or to
the note itself connects nothing. It combines with the notebook and tag
selects. Under the backlinks, `UnlinkedMentions` lists the notes that write
the title of the open note without linking to it (`GET /notes/:id/mentions`).
The full-text index names the candidates with a phrase query, and
`findMention` beside `extractWikiLinks` then reads each one. The parser the
preview renders with (micromark with GFM, through `mdast-util-from-markdown`,
in `prose.ts`) says which stretches are plain text, with nothing inside a link
or image label counted, and a mention has to lie inside one of them as whole
words, with the same title key as `NoteLink.targetKey`. Titles under three
characters get no mentions, and neither do titles that cannot be written as a
link, titles that another note has too, and "Untitled". The list is paged,
only the 200 newest candidates are read, and each note comes with the line and
the position of the mention it shows and the revision of the note. "Link"
(`POST /notes/:id/mentions/:sourceId/link`) takes those three and wraps that
mention through `writeNoteText`, tied to that revision, so a note that has
changed since is left alone. Before it writes, it parses the new text again
and refuses unless the only change is one more `[[link]]` at that place. The
list offers only what "Link" would take, with the same function. Every parse
runs in a pool of two worker threads with half a second each, and its tree and
verdict are kept by note and revision. A request parses at most 1,000,000
characters or one second, skips notes over 100,000 characters, and one account
runs two such requests at a time. It saves the old text as a version, syncs
the links and leaves `updatedAt` alone.

The graph is a page of its own. `GET /links/graph` returns nodes and resolved
edges from one query, with titles matched by the SQL expression `resolveKeys`
uses, for the 300 notes edited last at most. It takes the notebook and the tag
and refuses anything else, paging included. Every node also carries the number
of links it has in all, so the list can say when they lead to notes that are
not shown. `layoutGraph` runs d3-force to its end in a plain function, after
the page has been drawn and once per answer of the server, so the page shows
the settled picture as SVG and animates nothing. The picture depends only on
which notes and links there are: notes are laid out in the order of their ids,
and there is no seed. Dots and titles are sized in pixels of the screen
whatever the zoom, a dot can be clicked within 12 pixels of its middle, and
with more than 40 notes in view titles only show for the note pointed at, in
the picture or in the list. It can be dragged, zoomed with the buttons or with
Ctrl or Cmd and the wheel, a click on a dot opens the note, and the notebook
and tag selects narrow it down. The same notes and links are listed in words
under the picture, which is what a screen reader and the keyboard get. The
page is loaded on demand, so d3-force is not in the main bundle, and
`lazyPage` keeps a failed load inside the layout with a way to try again.

Still open: a title of only very common words finds nothing, because the index
drops those words. Common titles ("Ideas") are as noisy as predicted, and
there is no way to dismiss a mention. Only the first mention in a note that
can be linked is offered at a time. In the graph, dots cannot be moved by
hand, links have no arrowheads, and above 300 notes only the filters show the
rest. The dots are not tab stops, and two fingers on a touch screen do not
zoom: the buttons do. The layout still runs on the main thread, for about a
third of a second at 300 notes.

### 19. Security headers for the web app

nginx sends a `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer` and a `Permissions-Policy` that turns off the
camera, the microphone and the location. They live in
`web/security-headers.conf`, which every location outside `/api/` includes
with `always`, so a 404 from `/assets/` has them too. `web/src/nginx.test.ts`
fails when a location lacks the include, when an `/api/` location adds
headers, or when the `server` block gets an `add_header` that a location
would drop. The policy is as designed. `no-referrer` goes on every page, not
only on `/s/<token>`: the app is one page, so the policy of the first answer
holds wherever it navigates afterwards, and the other addresses name notes.
nginx leaves `/api/` alone, and the API sends the docs page a policy of its
own that allows the inline styles of Swagger UI, `data:` images, and scripts
only from its own files. On the two open points: images from other `https:`
sites stay allowed, so notes that show them keep working, and the policy is
enforced from the start, without a `Report-Only` phase, because there is
nowhere for reports to go and the app shell has no inline script or style to
find out about. Still open: blocking images from other sites, at least on
shared pages, and `Strict-Transport-Security`, which belongs to whatever
terminates TLS in front of nginx.

### 20. Compare two versions with each other

Built as designed, with no API change. A "Compare with" select in the
Changes view offers the note now or any other version, and two versions are
always compared from the older to the newer, whichever was picked first.
`markWords` in `web/src/lib/diff.ts` pairs a block of removed lines with the
block of added lines after it in order, line for line, and runs the same
Myers search over words, spaces and single punctuation marks. Lines left over
when the blocks differ in length stay whole, as do pairs with under a third
of their text in common. The cut-offs are 200 edits or a changed stretch of
2,000 words and spaces per pair, and 100,000 words and spaces per view. Marks
are `<del>` and `<ins>`, struck through or underlined as well as coloured,
with hidden words for screen readers. `foldUnchanged` keeps the lines it hid,
and a "Show" button puts them back 500 at a time. Still open: pairing by
similarity instead of by order, and a side-by-side view.

### 21. Links to headings and an outline

Built in the web app, with no change to the API. `web/src/lib/headings.ts`
holds the one slug function, GitHub's with `-1`, `-2` for repeats, and reads
the headings of a note with the parser the preview uses (remark with GFM, over
the same linkified text), so code is skipped and Setext headings count. A
remark plugin gives the headings of the editor's preview and of shared pages
the id `h-<slug>`; the version history does not, so ids do not repeat on the
page. `[[Note#Heading]]` opens the note at `/notes/<id>#h-<slug>`, which
scrolls the preview to the heading and focuses it, and puts the cursor on its
line in the text; in "Edit" the text takes the focus. The `#` part matches by
slug, so the words of the heading and its slug both work. `[[#Heading]]` links
within the note; the web parser accepts it and the API's does not, since it
stores links between notes only. Typing `[[Note#` or `[[#` offers the headings
of that note, read from its text in the browser, and inserts the words of the
heading, or its slug where the words would not lead back to it (a repeat, or
`|` in the words). "Outline" in the toolbar shows the headings above the panes
as a list where each heading with headings under it folds, and the choice to
show it is remembered. A link whose heading is gone opens the top of the note
and says so. I left out the `targetHeading` column: backlinks do not say which
heading is linked, and only links within a note are marked when their heading
is missing, while a link to a heading of another note is only checked when it
is followed. Renaming a heading still breaks the links to it.

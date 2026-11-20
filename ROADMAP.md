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
| 1   | Clickable task lists in the preview    | Shipped | frontend | S    | -          |
| 2   | Changes view in version history        | Shipped | frontend | S    | -          |
| 3   | Quick switcher                         | Shipped | frontend | S    | -          |
| 4   | Search filters, phrases and paging     | Shipped | both     | M    | -          |
| 5   | Rename a note without breaking links   | Shipped | both     | M    | -          |
| 6   | Accessibility pass                     | Shipped | frontend | M    | -          |
| 7   | Scheduled backups                      | Shipped | infra    | S    | -          |
| 8   | Edit conflict detection                | Shipped | both     | M    | -          |
| 9   | Attachments and pasted images          | Shipped | both     | L    | -          |
| 10  | Share link options                     | Shipped | both     | M    | -          |
| 11  | Account settings and sessions          | Shipped | both     | M    | -          |
| 12  | More import sources and export formats | Shipped | both     | M    | -          |
| 13  | Personal API tokens                    | Shipped | both     | M    | -          |
| 14  | Offline mode and installable app       | Later   | both     | L    | 8          |
| 15  | Deeper notebook nesting                | Maybe   | both     | M    | -          |
| 16  | Templates and daily notes              | Shipped | both     | M    | -          |
| 17  | Notebooks shared with other accounts   | Maybe   | both     | L    | 8          |
| 18  | Graph view and unlinked mentions       | Shipped | both     | M    | -          |

## Next

Empty for now: everything that was in this group has shipped.

## Later

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

Built so far, in three parts that ship together: the app can be installed
(manifest, icons, a service worker that caches the files of the build and
never anything under `/api/`, an offer to reload into a new version), and
notes already opened can be read offline from a copy of the query cache kept
in IndexedDB per user. Writing offline follows.

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

### 17. Notebooks shared with other accounts

Let a second person read or edit a notebook: invite them by email and it
shows up in their sidebar. Depends on item 8.

- The whole API assumes one owner. Every service looks notes up with
  `where: { id, userId }`. That has to become one shared access check: the
  owner, or a member of the note's notebook.
- `NotebookMember` model with a role (read or edit). Inviting an address that
  has no account yet needs a mail, which `MailService` can send since the
  password reset.
- Tricky: tags belong to a user (`@@unique([userId, name])`) and `[[links]]`
  resolve by title among one user's notes (`LinksService.resolveKeys`). In a
  shared notebook, whose tags and whose titles? The simplest rule is that
  both follow the notebook's owner.
- Two people in one note need conflict detection at the very least. Live
  co-editing with cursors and merged keystrokes is a different project and
  not planned.

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

### 18. Graph view and unlinked mentions

The Orphans view and the unlinked mentions are built. The graph is the other
half and follows in a change of its own. Orphans is a view in the sidebar,
`GET /notes?orphans=true`, for notes with no link to or from another note
outside the trash. A link to a missing title, to the trash or to the note
itself connects nothing. It combines with the notebook and tag selects. Under
the backlinks, `UnlinkedMentions` lists the notes that write the title of the
open note without linking to it (`GET /notes/:id/mentions`). The full-text
index names the candidates with a phrase query, and `findMention` beside
`extractWikiLinks` then reads each one. The parser the preview renders with
(micromark with GFM, through `mdast-util-from-markdown`, in `prose.ts`) says
which stretches are plain text, with nothing inside a link or image label
counted, and a mention has to lie inside one of them as whole words, with the
same title key as `NoteLink.targetKey`. Titles under three characters get no
mentions, and neither do titles that cannot be written as a link, titles that
another note has too, and "Untitled". The list is paged, only the 200 newest
candidates are read, and each note comes with the line and the position of the
mention it shows and the revision of the note. "Link" (`POST
/notes/:id/mentions/:sourceId/link`) takes those three and wraps that mention
through `writeNoteText`, tied to that revision, so a note that has changed
since is left alone. Before it writes, it parses the new text again and
refuses unless the only change is one more `[[link]]` at that place. The list
offers only what "Link" would take, with the same function. Every parse runs
in a pool of two worker threads with half a second each, and its tree and
verdict are kept by note and revision. A request parses at most 1,000,000
characters or one second, skips notes over 100,000 characters, and one account
runs two such requests at a time. It saves the old text as a version, syncs
the links and leaves `updatedAt` alone. Still open: a title of only very
common words finds nothing, because the index drops those words. Common titles
("Ideas") are as noisy as predicted, and there is no way to dismiss a mention.
Only the first mention in a note that can be linked is offered at a time.

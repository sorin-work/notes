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
- **Notebooks**, nested up to four levels deep (e.g. _Work -> Meetings ->
  One-to-ones_). Selecting a notebook shows the notes in every notebook inside
  it too. In the sidebar they are a tree that folds, and what is folded is
  remembered in the browser. Moving a notebook takes what is inside it along.
  Deleting one deletes the notebooks inside it and moves the notes of all of
  them to the trash.
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
  bookmarked. The **Orphans** view lists the notes with no links in or out,
  counting only links between notes outside the trash that are not
  templates.
- **Wiki links**: `[[Note title]]` or `[[Note title|link text]]`. Typing `[[`
  suggests titles. Links to notes that do not exist yet are shown dashed;
  clicking one creates the note. Each note lists its **backlinks**, with the
  paragraph the link is in. Under them are its **unlinked mentions**: notes
  that write its title without linking to it, each with a Link button that
  puts `[[ ]]` around the mention. After a note is renamed, the editor offers
  to update the links other notes have to its old title.
- **Links to headings**: `[[Note title#Heading]]` opens the note at that
  heading, and `[[#Heading]]` goes to a heading of the same note. Typing
  `[[Note title#` suggests the headings of that note. **Outline** in the
  editor's toolbar lists the headings of the open note as a list that folds;
  a click goes to the heading.
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
  is now, or another version, with a changed title above it. Inside a line
  that changed, the words that differ are marked.
- **Edit conflicts**: with a note open in two tabs or on two devices, a save
  that would overwrite the other one is held back, and the editor asks what
  to keep: your text, theirs, or yours with theirs saved in the history.
- **Trash**: deleted notes can be restored or deleted for good, and are
  purged automatically after 30 days (`TRASH_RETENTION_DAYS`).
- **Attachments**: paste or drop an image or a PDF into a note, or attach
  one from the panel under the editor. It is uploaded and its link goes where
  the cursor is. Images show in the preview and on shared pages.
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
- **Notebooks shared with other accounts**: "Share with people" on a
  notebook invites an address to read it, or to edit it. The notebook, and
  the notebooks inside it, then show in the member's sidebar under "Shared
  with me". Readers read; editors also change the text and tags of the notes
  and add notes, which stay the owner's. Members never see the owner's other
  notebooks, notes, tags or titles, nor the notebook's templates. The owner
  can change a role or remove someone, and a member can leave.
- **Import/export**: export everything as a zip of Markdown files (notebooks
  become folders, nested like the notebooks, and tags and dates go in YAML
  front matter) or a single note as `.md`. Import `.md`/`.txt` files or zips,
  such as an Obsidian vault or a Notion export (page ids are stripped and
  links between pages become `[[wiki links]]`), and Evernote `.enex` files
  (each file becomes a notebook, attachments are left out). Folders become
  notebooks at the depth they have. Below the fourth level they are joined
  into one: `A/B/C/D/E` becomes the notebook "D - E" inside A, B and C.
  Importing the same files again leaves out the notes that are there already.
  A full JSON backup of one account (trash, history and all) restores into an
  empty account. "Print" in the browser gives the note alone, ready to save as
  PDF.
- **Account**: change your name, email and password in Settings, sign out
  everywhere at once, or delete the account with everything in it. A
  forgotten password can be reset through a link sent by mail, on servers
  that have SMTP settings. On those servers a new email address only takes
  over once the link mailed to it is opened, and the old address is told.
- **Two-step sign-in**: Settings can turn on codes from an authenticator
  app. The QR code goes into the app, its first code turns codes on, and ten
  recovery codes are shown once. After that, signing in and making an API
  token take a code as well as the password, see
  [Two-step sign-in](#two-step-sign-in).
- **Capture**: `/capture?title=...&url=...` opens a new note with a page's
  title and its address, ready to save. A bookmarklet makes that one click
  on any page, see [Saving a page from the browser](#saving-a-page-from-the-browser).
- **API tokens** for scripts: made and revoked in Settings, shown once, and
  read-only if you want. A token stands in for a login on everything except
  the account itself.
- **Backups**: with Docker, an optional service dumps the whole database once
  a day and keeps the last seven dumps. See
  [Backup and restore](#backup-and-restore).
- **Graph**: a page that draws every note as a dot and every link as a line,
  to spot clusters and notes nothing leads to. Drag it, zoom with the buttons
  or with Ctrl or Cmd and the wheel, and click a dot to open the note. A plain
  turn of the wheel scrolls the page. Dots and titles keep their size on the
  screen at every zoom. With many notes in view the titles are left out until
  one is pointed at or the picture is zoomed in. The notebook and tag selects
  narrow it down. It draws 300 notes at most, the ones edited last, and says
  so when there are more. Under the picture the same notes and links are
  listed in words, and a note whose links lead to notes that are not shown
  says so.
- **Keyboard and screen readers**: skip links lead past the sidebar to the
  content and to the open note, dialogs keep Tab inside them, and the link
  suggestions and the quick switcher are announced. The note list is one
  stop for Tab, and the arrow keys move inside it. The arrow keys also move
  through the notebooks in the sidebar and in the notebook picker of a note,
  and fold and unfold them. On a phone, opening the menu puts the focus in
  it, Tab stays in it, and Escape closes it again. The notebook selects name each notebook by
  its whole way, such as "Work / Meetings", rather than by indenting.
  Colours meet WCAG AA contrast in both themes, and nothing spins or slides
  when the system asks for reduced motion. See
  [Checking with a screen reader](#checking-with-a-screen-reader) for what
  has and has not been tried.
- Light and dark themes, keyboard shortcuts and a layout that works on phones.
- **Installable**: the browser can install the app, from the address bar on
  a desktop or with "Add to Home Screen" on a phone. A service worker keeps
  the files of the app, so it starts without a connection. When a new
  version is out, a line at the bottom offers to reload into it. Nothing
  reloads by itself, and "Reload" saves the open note first.
- **Reading offline**: the notes, lists, notebooks and tags you have seen on
  a device are kept there, so they can be read without a connection, also
  after a reload. A line at the top says when you are offline and that what
  is shown may be out of date. Search, backlinks and history need a
  connection and say so.
- **Writing offline**: text typed without a connection, and new notes made
  without one, are kept on the device and sent when the server can be
  reached again, also after a reload. A line at the top counts what is
  waiting. If the note was changed elsewhere meanwhile, the usual question
  comes up when it is opened; a change the server cannot take is listed
  until you decide. Signing out with unsent changes asks first.

| Shortcut             | Action                            |
| -------------------- | --------------------------------- |
| `Alt+N`              | New note                          |
| `/`                  | Search                            |
| `Ctrl+K` / `Cmd+K`   | Go to a note by its title         |
| `Ctrl+S` / `Cmd+S`   | Save now                          |
| `Ctrl+E` / `Cmd+E`   | Switch between edit/split/preview |
| `↑` `↓` `Home` `End` | Move through the note list        |
| `↑` `↓` `Home` `End` | Move through a notebook tree      |
| `→` / `←`            | Unfold or go in / fold or go up   |
| `Esc`                | Close the menu on a phone         |

### Checking with a screen reader

The tests run axe over every page and dialog, and check the keys above, but
neither stands in for a person with a screen reader. This is the list to go
through with NVDA and Firefox on Windows and with VoiceOver and Safari on a
Mac. It has not been gone through yet (roadmap item 34): nothing below has
been heard in a real screen reader.

- Sign in, then Tab from the top of a note page: the skip links come first
  and lead where they say.
- The note list: one Tab reaches it and the next one leaves it; the open note
  is read as the current page; the arrow keys read one note after another.
- The notebook tree in the sidebar: each notebook is read as a link with its
  count; the fold buttons say "Fold" or "Unfold" and whether they are
  expanded; the arrow keys work in focus mode (NVDA) and with VoiceOver's
  keys passed through.
- The notebook picker of a note: the button says where the note is, opening
  it puts the focus on the choice that stands, the list is a group, and
  Escape puts the focus back on the button.
- Folding with Left and Right: the notebook itself is read as expanded or
  collapsed.
- The filter selects and "Inside" in the notebook dialog: options are read
  with their whole way.
- Typing `[[` in a note: the suggestions are read as they change, and Enter
  takes one.
- The quick switcher (`Ctrl+K`): the number of notes found is read.
- A dialog: the focus starts inside it, Tab stays inside, and Escape returns
  the focus.
- On a phone-sized window: the menu button, the focus moving into the menu,
  Tab staying in it, and Escape.

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
| Web      | React 19, TypeScript, Vite, React Router, TanStack Query, react-markdown, d3-force |
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

nginx serves `index.html`, `sw.js`, `version.json` and
`manifest.webmanifest` with `Cache-Control: no-cache`, so the browser asks for
them every time and finds a new version as soon as it is deployed. The fingerprinted files under
`/assets/` are cached for a year.

### Security headers

Everything nginx serves itself, the app shell and its files, the service
worker and the manifest, comes with these headers, from
`web/security-headers.conf`:

| Header                    | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| `Content-Security-Policy` | see below                                                 |
| `X-Content-Type-Options`  | `nosniff`                                                 |
| `Referrer-Policy`         | `no-referrer`                                             |
| `Permissions-Policy`      | `camera=(), microphone=(), geolocation=()`, none are used |

The policy lets the page run scripts, load styles and send requests only to
its own host, and no other site may show it in a frame (`frame-ancestors
'none'`). The login token is in `localStorage`, so this is what stands
between it and a script that got into the page some other way. Images may
also be `blob:` and `data:`, for a pasted image before its upload is done,
and come from any `https:` site, because notes show images from the web. That
also means an image in a shared note tells the site it comes from when
someone reads the note. An image linked over plain `http:` is blocked: the
browser does not load it.

`no-referrer` holds everywhere: the address of a `/s/<token>` page is the
share link itself, and the other addresses name notes, so none of them goes
to the sites a note links to.

nginx drops the `add_header` lines of the `server` block in every
`location` that has one of its own, and most of them set `Cache-Control`. So
each location includes the file, and `web/src/nginx.test.ts` fails when one
does not. Answers under `/api/` keep the headers the API gives them:
attachments their sandboxing policy, and the page at `/api/docs` one of its
own that allows the inline styles of Swagger UI and nothing else inline.

The ports can be changed with `WEB_PORT`, `API_PORT`, `DB_PORT` and
`MAILPIT_UI_PORT`. The API container runs `prisma migrate deploy` before it
starts. Data lives in the `db-data` volume and the files of attachments in
the `attachments` volume; `docker compose down -v` removes both. [Backup and restore](#backup-and-restore) is about keeping a copy of it.

### Mail

The API sends a few kinds of mail: the link behind "Forgot password?" on the
sign-in page, the link that confirms a new email address and the notice to
the old one, invitations to shared notebooks, and a warning to the owner
when someone gives the right password and a wrong code. In the Compose stack that mail goes to
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

Dumps land in `./backups` as `notes-<UTC date and time>.dump`, or
`.dump.age` when they are encrypted. When the
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

| Variable                      | Default                        | Purpose                                               |
| ----------------------------- | ------------------------------ | ----------------------------------------------------- |
| `BACKUP_DIR`                  | `./backups`                    | Folder on the host the dumps go to                    |
| `BACKUP_KEEP`                 | `7`                            | How many dumps to keep                                |
| `BACKUP_INTERVAL_SECONDS`     | `86400`                        | Seconds from one dump to the next one                 |
| `BACKUP_ENCRYPT_TO`           | (none)                         | age public keys to encrypt every dump to              |
| `BACKUP_COPY_COMMAND`         | (none)                         | Run after every good dump, with the new files as `$@` |
| `BACKUP_COPY_TIMEOUT_SECONDS` | `3600`                         | How long a copy may take before it is stopped         |
| `BACKUP_COPY_PACKAGES`        | `rsync openssh-client`         | Alpine packages in the image for the copy command     |
| `BACKUP_ALERT_URL`            | (none)                         | Gets a `POST` when a dump or a copy fails             |
| `BACKUP_IDENTITY_FILE`        | `/run/secrets/backup-identity` | Where a restore looks for the key, in the container   |

The service runs in an image of its own, `scripts/backup.Dockerfile`: the
`postgres:17-alpine` image, whose `pg_dump` matches the server, with `age`,
`curl` and the tools of the copy command added. Compose builds it the first
time the service starts. After changing `BACKUP_COPY_PACKAGES`, build it
again with `docker compose --profile backup build backup`.

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

An encrypted dump needs the private key for the restore, and only then. Mount
it for that one command:

```bash
docker compose --profile backup run --rm \
  -v ~/notes-backup-key.txt:/run/secrets/backup-identity:ro \
  backup restore notes-20261120T030000Z.dump.age
```

The dump is decrypted as `pg_restore` reads it, through a pipe, so no plain
copy of it is written anywhere. The files archive is decrypted into the
attachments folder, checked and unpacked there, and removed. A key that does
not fit stops the restore before the database or the files are touched.

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

- A dump holds every note and the password hashes. Unless
  `BACKUP_ENCRYPT_TO` is set it is not encrypted. The files can only be read
  by their owner. On Linux that is the owner of the folder they are in, not
  root.
- `docker compose logs backup` shows every dump and every failure, and a
  failed dump is tried again a minute later.
- `docker compose down -v` removes the database volume, not the dumps.
- Beside each dump the files of attachments go into
  `notes-<time>.files.tar`, made just before the dump. A file deleted in
  between is in the archive without a row and is swept out after a restore.
  A file uploaded in between has its row in the dump but is not in the
  archive: after a restore that note shows the file as missing, and the
  export and the JSON backup leave it out and list it. A backup of a stopped
  stack has no such gap. Only regular files named like an attachment id go
  in, never a link. A restore puts the files back after the database, and
  refuses an archive that holds anything else, a hard link included, or that
  unpacks into anything but plain files. It also refuses
  to start while the API is connected, because the API writes and removes
  files as it goes. A dump without an archive, from before there were
  attachments, restores the database and leaves the files as they are.

### Encryption, copies and alerts

All three are off until their variable is set in `.env`.

**Encryption.** Make a key pair with [age](https://age-encryption.org) and
put the public key in `BACKUP_ENCRYPT_TO`:

```bash
age-keygen -o ~/notes-backup-key.txt   # prints the public key, age1...
```

Keep the key file away from the backups, on another machine or on paper. The
service only ever sees the public key. `pg_dump` and `tar` write into `age`,
and only what `age` writes reaches the disk, so there is no plain copy even
for a moment. If `age` fails, the half-written file is removed and the dump
counts as failed. Dumps made before encryption was switched on stay plain
until they are pruned. A plain and an encrypted file with the same time in
their names count as one dump, and go together when it is pruned. A key that
`age` does not take stops the service when it starts.

**A copy on another machine.** `BACKUP_COPY_COMMAND` runs after every good
dump, with the new dump and its files archive as `"$@"`. It runs in the
container, so whatever it needs to log in with has to be mounted there. A
`docker-compose.override.yml` beside the main file does that:

```yaml
services:
  backup:
    volumes:
      - ./backup-config:/config:ro
```

With rsync over SSH, a key and a `known_hosts` file in `./backup-config`, and
a user on the other machine that may write to `notes/`:

```bash
BACKUP_COPY_COMMAND='rsync -t -e "ssh -i /config/id_ed25519 -o UserKnownHostsFile=/config/known_hosts" "$@" backup@nas.example.com:notes/'
```

With rclone, which also reaches S3-compatible storage of your own such as
MinIO or Garage, add it to the image with `BACKUP_COPY_PACKAGES=rclone` and
put its `rclone.conf` in `./backup-config`:

```bash
BACKUP_COPY_COMMAND='for file; do rclone --config /config/rclone.conf copy "$file" offsite:notes || exit 1; done'
```

The single quotes keep `"$@"` from being read when `.env` is. The command
runs in a session of its own. When it takes longer than
`BACKUP_COPY_TIMEOUT_SECONDS`, the whole session is stopped, the loop and
every rclone, rsync or ssh it started, and whatever the command leaves
running when it ends is stopped too. So a copy never runs on beside the next
one, or while old dumps are pruned. A copy that fails or is stopped is not
a failed dump: the dump is there and counts. It is logged and alerted, and the next
dump is copied as usual. Only the new files are copied, so a dump whose copy
failed is not sent again later. Pruning old copies on the other side is up
to the other side.

**Alerts.** `BACKUP_ALERT_URL` gets a `POST` with a line of text when a dump
fails and when a copy fails. That is what a topic on a self-hosted
[ntfy](https://ntfy.sh) takes, and any other webhook that reads the body. The
loop tries a failed dump again every minute, so while one kind of failure
goes on it is sent at most once an hour, and again at once if it comes back
after a dump or a copy that worked. An alert that cannot be sent is logged,
and the address itself is never logged, since it often holds a token.

**Health.** After every good dump the service writes the time to
`.last-good-dump` in the backup folder, and the healthcheck of the service
runs `backup.sh health`, which reads it. The service turns `unhealthy` in
`docker compose ps` once the last good dump is more than a day and two hours
old (the interval and a twelfth of it). That catches what an alert cannot,
such as a `pg_dump` that hangs or an alert address that does not answer.
Docker only shows the state; to hear about it, point whatever watches the
machine at `docker compose ps` or `docker inspect`. A service that is not
running has no state at all. On a first start the service has ten minutes
before a missing dump counts against it.

### The JSON backup

`GET /export/backup` writes one account's data as a JSON file. It is written
out as it is read, a batch of notes at a time. Settings, "Download a full
backup", gets a link from `POST /export/backup/link` that works once, within
a minute, without a login, and lets the browser follow it, so the browser
saves the file to disk as it comes in instead of holding it in memory. The
format is versioned. This is version 2:

```json
{
  "format": "notes-backup",
  "version": 2,
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
  "attachments": [
    {
      "id": "…",
      "noteId": "…",
      "fileName": "beach.png",
      "createdAt": "…",
      "data": "iVBORw0KGgo…"
    }
  ],
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
`attachments` holds every file, in base64, with the note it belongs to. It
comes before the notes, and a restore gives the notes' `attachment:` links the
new ids. Its type is not in the file: a restore decides it from the bytes, as
an upload does, and counts the files against the account limit.
`missingAttachments` lists the ids of files that were missing from storage
when the backup was made; they are left out rather than failing the whole
backup. Version 1 had neither list, and a restore still reads it.

`POST /import/backup` (Settings, "Restore") takes the file itself as the
request body, sent as `application/octet-stream`, and puts it into an
account that has no notes, notebooks or tags yet: the same notes with their
history, revisions, tags, notebooks, trash, templates, daily notes and daily
note choices, under new ids, with links synced. The file is read while it
comes in and checked part by part against the app's own limits, so any
backup the app writes restores, whatever its size, and only a batch of notes
is in memory at a time. The parts come in the order the app writes them; the
notebooks have to come before the notes. Everything is written in one
transaction, so a refused or failed restore leaves the account empty. An
account that has something in it gets `409`. Share links are not made again:
a new link would have a new address, and a link that had a password would
come back without one. Share again what should be shared.

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

There is no service worker under `npm run dev`. It is only built and
registered by `npm run build`, so try it with `npm run preview` or the
Docker stack.

### Configuration

| Variable                   | Default              | Purpose                                                                  |
| -------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`             | (required)           | Postgres connection string                                               |
| `JWT_SECRET`               | (required)           | Signs login tokens, at least 32 characters                               |
| `JWT_EXPIRES_IN`           | `7d`                 | How long a login lasts                                                   |
| `PORT`                     | `4401`               | API port                                                                 |
| `CORS_ORIGINS`             | (none)               | Comma-separated browser origins, only needed without nginx               |
| `LOG_LEVEL`                | `info`               | `debug`, `info`, `warn` or `error`                                       |
| `SEED_DEMO`                | `false`              | Create the demo account on start-up                                      |
| `TRASH_RETENTION_DAYS`     | `30`                 | Days before trashed notes are deleted for good                           |
| `AUTH_THROTTLE_LIMIT`      | `10`                 | Per-minute limit on the routes that take a password                      |
| `API_TOKEN_THROTTLE_LIMIT` | `120`                | Requests a minute that one API token may make                            |
| `PUBLIC_THROTTLE_LIMIT`    | `60`                 | Shared notes that one client may open in a minute                        |
| `API_DOCS`                 | `true`               | `false` turns off the page and the document at `/api/docs`               |
| `SMTP_HOST`                | (none)               | SMTP server. Without it no mail is sent and password reset is off        |
| `SMTP_PORT`                | `587`                | Its port. `465` is TLS from the start, any other port uses STARTTLS      |
| `SMTP_FROM`                | (none)               | Sender of the mails, required with `SMTP_HOST`                           |
| `SMTP_USER`                | (none)               | Login for the SMTP server, if it wants one                               |
| `SMTP_PASSWORD`            | (none)               | Password for that login                                                  |
| `SMTP_REQUIRE_TLS`         | `true`               | `false` lets mail go out without TLS, for a test server like mailpit     |
| `APP_URL`                  | (none)               | Address of the web app for the links in mails, required with `SMTP_HOST` |
| `TRUST_PROXY`              | `0`                  | Reverse proxies in front of the API whose `X-Forwarded-For` counts       |
| `ATTACHMENTS_DIR`          | `./data/attachments` | Folder for the files of attachments                                      |
| `ATTACHMENT_MAX_MB`        | `10`                 | Most one attached file may have, 50 at most                              |
| `ATTACHMENT_ACCOUNT_MB`    | `500`                | Most all files of one account may have together                          |
| `TWO_STEP_KEY`             | (none)               | 32 bytes as 64 hex digits, encrypts the secrets of two-step sign-in      |

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
be touched when the dump does not load or the swap is refused. Stand-ins
for `age`, the copy command and `curl` check that an encryption that fails
leaves no file, that a plain and an encrypted file of one time are pruned as
one dump, that a failed copy alerts without failing the dump, that a dump
failing in every round alerts once, that a missing or wrong key touches
nothing, and when the healthcheck passes. With the real database the check
then restores over a database that holds something else, tries a damaged
dump, tries with a second client connected, and makes an encrypted dump with
a real key, restores it, and fails to with another key. That last part needs
`age`, which is why CI runs the check in the image of the backup service.

## Project layout

```
api/
  prisma/               schema and migrations
  src/
    auth/               sign-up, login, JWT guard, account changes
    notebooks/          notebooks and their nesting, four levels deep
    notes/              notes, filters and sorting, note export
    tags/               tag names, renaming and merging
    links/              [[wiki link]] parsing, link storage, backlinks and the graph
    mentions/           unlinked mentions and the link that fixes one
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
    sw/                 the service worker and what it does with each request
  build/                the build step that writes the service worker
  nginx.conf            how the container serves the app and passes /api on
  security-headers.conf the headers every location of nginx.conf includes
scripts/
  backup.sh             the backup service: daily dumps, pruning and restore,
                        encryption, copies, alerts and the healthcheck
  backup.Dockerfile     its image: postgres with age, curl, rsync and ssh
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

An unlinked mention is a title written out in the plain text of another note,
as whole words, ignoring case and extra spaces. The API reads the note with
the Markdown parser the preview renders it with (micromark with GFM), so plain
text is what shows as plain text: not code of any kind, not a link or an image
with anything in its label, not a reference, a URL or HTML, and not an
existing `[[link]]`. Notes that already link to the title are left out. A
title gets no mentions when it is shorter than three characters, when it
cannot be written as a link (with `[`, `]`, `|`, `#` or a backtick in it),
when another note outside the trash has the same title, or when the note is
still called "Untitled": a link has to lead to this note and no other. The
search index picks the candidates, so a title made only of very common words
("The Who") finds nothing, and only the 200 notes edited last that match are
read.

The parser is slow on some notes, seconds or more for a small one built to
trip it, so it never runs on the thread that answers requests. Two worker
threads parse, and each parse gets half a second. A worker that takes longer
is stopped and replaced, and the note offers no mentions until it is edited:
the verdict is kept by account, note, revision and a hash of the text, and so
is the tree of a note that was parsed, so each revision is parsed once. Both
caches are bounded by an estimate of the memory they take, and each worker by
256 MB. A note waits at most two seconds in all for a worker, and at most 32
wait at a time. Past either, the list answers 503 (try again in a moment), and
Link answers 400 or 429. Before that, a note longer than 100,000 characters,
with more than 2,000 closing brackets, or with quotes or lists nested more
than 16 deep is not parsed at all, and a note that does not write the title is
passed over. One request parses at most 1,000,000 characters and spends at
most a second on it. Past either limit the list stops and says it may be
missing some notes. One account runs two mention requests at a time, and a
third answers 429. The list is loaded when a note is opened and after its
title changes, not after every save.

The list shows the line of the mention that the Link button will wrap, and
only mentions that Link will take: the first one in each note for which it
works. Link puts the brackets in, parses the new text again and writes it only
when it holds exactly one `[[link]]` more, at that place, every piece of code,
HTML, every link, image, reference and definition exactly as before, and every
emphasis, strong and strikethrough where it was. Brackets next to `*`, `_` or
`~` can change how those pair up, so then there is no mention. Nor right after
a `!`, where the brackets would open an image, nor in a table cell beyond the
columns of the header, which the preview does not show. A note that Link
cannot parse in time answers 400. The button changes the other note: its old
text is saved as a version first, so the change can be undone from its
history, and its "last edited" time stays as it was. The request names the
revision of the note that the mention was found in. If the note has been
edited since, nothing is changed and the list is loaded again.

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

A link can name a heading after a `#`: `[[Atlas#Next steps]]`. Each heading
in the preview gets an id made from its words, the way GitHub makes them
(lower case, punctuation dropped, spaces as `-`, and `-1`, `-2` for a heading
whose words come again), with `h-` in front so it cannot clash with the ids
of the app. The `#` part matches by that slug, so `[[Atlas#next-steps]]` leads
to the same heading, and `[[Atlas#intro-1]]` to the second "Intro". Headings
are read with the parser the preview uses, so a `#` line in code is none and a
line underlined with `===` or `---` is one. Following such a link opens
`/notes/<id>#h-<slug>`: the preview scrolls to the heading, and in the text
the cursor goes to its line. Shared pages do the same. Headings are not
stored: when a heading is renamed, links to it open the top of the note and
say that the heading is not there. A link within the note, `[[#Heading]]`, is
shown dashed when the note has no such heading. A rename of the note keeps
the `#heading` part, and only links to other notes count as links for
backlinks, the graph and orphans.

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

"Compare with" above the changes picks what the version is compared with:
the note now, or another version. Two versions are always compared from the
older to the newer, whichever was selected first. Where a block of removed
lines faces a block of added lines, the first removed line is paired with the
first added one, the second with the second, and so on, and the words that
differ are marked in each (struck through on the removed line, underlined on
the added one, and read out as "removed" and "added" by a screen reader).
Lines left over when the blocks are not the same length stay whole, and so do
pairs with less than a third of their text in common, where marks would cover
almost everything. A pair with more than 200 words and spaces changed, or
more than 2,000 between the first and the last change, or more than 100,000
characters in all, is shown whole too. One view does a fixed amount of work
on words, about a million steps counting the pairs it gave up on, and shows
the rest of the lines whole after that. A folded
stretch has a "Show" button that puts back its lines, 500 at a time.

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

## Offline and the installed app

The service worker (`web/src/sw/worker.ts`, built into `/sw.js` by
`web/build/service-worker.ts`) keeps the files of one build: the scripts,
the styles, `index.html`, the icons and the manifest. Those are the same for
everyone. It never stores anything under `/api/`, so no note, token or other
private data sits in its cache. A page of the app is asked from the network
first, and the cached `index.html` is used only when the network has not
answered within three seconds, so the app starts without a connection but
always sees a new `index.html` when there is one. Requests to the API,
`/api/docs`, `/healthz` and `/version.json` go to the network as if there were
no worker.

A new build is found when the tab comes back into view and once an hour, by
the worker and by comparing the build id in `/version.json` (served with
`no-cache`) with the one the tab was built with. It installs next to the one
in use and waits. "Reload" in the offer at the bottom saves the open note and
lets the new worker take over. Every open tab then reloads, after saving its
own open note, because the old files are gone with the old cache. A tab that
cannot save puts the draft aside in the tab, where the note offers it again,
and asks to be reloaded instead of running on with the old version.

If the worker ever has to go, `web/sw-retire/sw.js` takes it out of use:
deploy it in place of the built `/sw.js` (copy it over `dist/sw.js` before the
image is built). Browsers that had the old worker pick it up at their next
visit. It deletes the caches of the app, unregisters itself and reloads the
open tabs, which then run straight from the network.

What can be read offline is kept apart from the worker, in IndexedDB
(`web/src/lib/offlineCache.ts`): the TanStack Query cache, written at most once
a second, one record per user under the user's id. Only notes, note lists,
notebooks, tags and the links of a note are written. Search results,
backlinks, history, the settings pages, share links and the login token never
are. The token stays in `localStorage`, where it always was. Each note or
list carries the time it was fetched, and one fetched more than seven days ago
is left out, however often the copy is written since. Past 5 MB the queries
loaded longest ago are left out too. A refetch that fails because there is no
connection, or because the server has a problem, keeps what was there. Only a
404 or a 403 for a note takes it out.

Started without a connection, the app reads the user id from the token and
opens that user's copy, with no request to the server. If there is none, it
says that it needs a connection. Once the connection is back it asks the
server who is signed in, as usual.

The copy is deleted when you sign out, when the server answers 401 (the
session ended, the password changed, or "Sign out everywhere" was used on
another device), when another tab of this browser signs out, when the account
is deleted, and when a different user signs in on the same browser. A tab
that sees another user signed in from another tab puts its open draft aside,
lets go of what it holds and starts again as that user. A copy is only ever
written while the token names its user. A device that never comes back online
keeps its copy until then, up to seven days per note.

Writing without a connection goes through an outbox (`web/src/lib/outbox.ts`),
in IndexedDB as well, one entry per note and per user. When a save cannot
reach the server, the editor puts the text there, and every later save of
that note goes there too until it has been sent, so the changes to a note
arrive in order. "+ New note" without a connection makes the note in the
browser with an id of its own (a random UUID), which `POST /notes` accepts as
`id`. The outbox sends when the browser is back online, when the app starts
and every half minute while something waits, one tab at a time (a Web Lock),
through the same `PATCH` as the editor, on the revision the text was written
on. So a note changed elsewhere meanwhile is never overwritten: the entry is
kept and the editor asks the usual question when the note is opened. A text
the server already has (the answer to an earlier send got lost) is taken as
sent, and a create whose id turns out to be the user's own note is too, so a
connection that comes and goes applies nothing twice. A change the server
refuses for another reason (the note is in the trash, say) stays, with the
reason, until the user discards it.

The outbox and the draft stash of the editor do not overlap: the outbox has
what the server never saw, and the stash, in the tab's `sessionStorage`, only
a draft the server refused when nobody was left to ask (the session had
ended, or the note changed once more on the way out).

What waits in the outbox belongs to the user who wrote it. It goes when that
user signs out and agrees to throw it away, when the account is deleted and
when another user signs in on this browser, who is asked first. It stays when
the session ends by itself (a 401, "Sign out everywhere", or a sign-out in
another tab): unsent changes stay in that browser until the same person signs
in there again and they are sent, or someone else signs in there and they are
deleted. Settings says so beside "Sign out everywhere". Unsent text has no
expiry, and nothing can wipe it remotely: on a lost or stolen device it stays
in that browser's storage, readable by whoever can open the browser profile,
until one of those things happens there. Only text and new notes wait: a pin,
a tag, a notebook or a move to the trash still need a connection.

A change is only ever queued on top of text the editor has seen. Each save
names the text the editor started from. If the note already has text waiting
that came from another tab, and is not that text, nothing is written over it:
the editor asks the usual question, with the other tab's text as "theirs".
"Keep mine, put theirs in the history" keeps the other text as a new note of
its own, made once however often it is tried. "Keep mine" replaces the other
text only while it is still exactly what the question showed. A note left with
the question open keeps the other tab's waiting text untouched, and this tab's
text becomes a new note, "(kept when leaving)"; a notice says which holds
which, and the draft counts as saved only once that note is safely queued. In the same way, the revision a change is based on is the one this
editor loaded or saved, or one this tab sent itself. When another tab sends a
change of the note, an editor open on it here only says that it is out of
date; its next change meets the other one as a conflict.

Every send checks that the login token still names the user the change
belongs to, so a sign-in as someone else in another tab never sends it under
their name. Changes are written and read under a lock shared by the tabs (Web
Locks), held only briefly. A text is marked as maybe sent before its request
goes, and a send is put back only if the entry did not change meanwhile; a
newer text written on top of it stays and goes next, on the revision the
answer named. Each request of a send gives up after 15 seconds, and signing
out waits at most 10 seconds for what is being sent. A server error is tried
again later, waiting longer each time, up to ten minutes. A change to a note
that is gone, no longer shared, or in the trash is listed with "Save as a new
note", "Copy text" and "Discard this change", and is tried again every few
minutes, so restoring the note from the trash sends it. New text of that note
never goes into such a stuck change. A change discarded while its request was
already on its way may still reach the server; then a notice says so, and the
text before it is in the history of the note.

Writing offline needs a secure context: the app served over HTTPS, or from
localhost, because Web Locks and `crypto.randomUUID` exist only there. Served
over plain HTTP from another address, the outbox is off. The offline line says
so, saving works as before while there is a connection, and text that cannot
be saved stays in the editor as an unsaved change.

## Notebooks shared with other accounts

Every route that takes a note or a notebook first asks one access check
(`api/src/access/access.service.ts`): the owner may do everything, a member of
a shared notebook may read or edit the notes in it and in every notebook
below it, at any depth, and anyone else gets a `404`, the same as for a note
that does not exist. "Below it" is one recursive query
(`api/src/notebooks/subtree.ts`), the same one the owner's note list, search
and graph use, so all of them agree on what a shared notebook holds. The
check hands back the owner's id, and the services go on looking notes up by
owner and id with it, so a route that forgot to ask would only ever find the
caller's own notes. A write checks again inside its own transaction, with
the note's row locked and the memberships read with a share lock, so a move
of the note or the removal of the member in the meantime cannot let it
through. An end-to-end test walks every note route as an outsider, and as a
member on a note outside the shared notebook, and expects `404` from each.

A member works on the owner's notes. Tags set by an editor are the owner's
tags, `[[links]]` resolve among the owner's titles, and new notes in the
shared notebook belong to the owner. But a member only ever sees what is in
the shared notebook: links to anything else read as missing, and backlinks,
link suggestions, unlinked mentions, the graph (with the notebook as filter)
and search with the notebook as filter stay inside it, link counts included.
Their own lists, tags, search, graph and "Go to a note" stay their own.
Templates and notes in the trash are never shown to members. Two people saving
one note meet the conflict question of item 8, as two tabs do. An editor
changes title, text and tags, attaches files (counted against the owner's
room) and restores versions; pinning, stars, moving, templates, share links,
renaming links across notes, linking mentions in other notes, duplicating and
the trash stay the owner's (`403`). Members see the names of the others in
the notebook; only the owner sees their addresses and the open invitations.

An invitation is accepted only with the token of its link, which works once,
for a week. Like the password reset, the token is in the fragment and only
its hash is stored. Whoever is signed in when the link is opened joins, as
themselves: the token is the proof, not the address, which nothing here has
checked. Nothing lists invitations by address, so registering with an
invited address gets nobody in. When the server can send mail, the link goes
by mail, which says nothing that came from the inviting account: not their
name, not the notebook's. It says to open the link while signed in to the
account that should join, and not to pass it on. When it cannot, the owner gets the link once, in
the answer to the invitation, to pass on; it is never shown again. Sends are
counted apart from the invitations, so withdrawing or renewing one makes no
room: ten an hour from one account, three a day from one account to one
address (so one account cannot keep others from inviting it), and twenty
open invitations per notebook. Mention lookups of a member are counted
against the member, so they never use up the owner's. A change waiting in a member's outbox for a
note they can no longer reach is listed as stuck ("gone, or not shared with
you any more").

The routes are under `/api/notebooks/:id/members` and `/api/invites/accept`,
closed to API tokens.

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

`POST /notes` takes an `"id"`, a random UUID made by the client, for a note
made offline. If any note has that id the answer is a `409` with
`"code": "note_exists"`, the same whoever's note it is.

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

### Two-step sign-in

With codes on, `POST /auth/login` answers `{ "twoStep": true, "ticket": "..." }`
for the right password, and no token. `POST /auth/login/code` with
`{ ticket, code }` gives the token, for six digits from the app or a
recovery code. The ticket is good for five minutes and five wrong codes, and
stops working like a token when the password changes or every session ends.
It is never a login token: the API refuses it as one.

The codes are TOTP (RFC 6238): SHA-1, six digits, thirty seconds, which every
authenticator app reads from the QR code. The API takes the codes of one
step before and after the current one, for a phone whose clock is a little
off, and each code once: the step of the last code taken is kept, and a code
has to come after it. Recovery codes are 16 letters and digits each, kept as
SHA-256 hashes, and deleted when used.

Wrong codes are counted per client address, and per account and address,
but never per account alone. Codes tried from one place therefore cannot
lock the owner out from another one. What stops guessing instead is that
every five codes cost a new sign-in with the password, which is throttled
too, and that the owner gets a mail, at most once an hour, saying that
someone gave the right password and a wrong code.

| Method & path                        | What it does                                                |
| ------------------------------------ | ----------------------------------------------------------- |
| `GET /auth/two-step`                 | `{ available, on, recoveryCodesLeft }`                      |
| `POST /auth/two-step/setup`          | With the password: a new secret and its `otpauth://` URI    |
| `POST /auth/two-step/enable`         | With the first code: on, a new token and the recovery codes |
| `POST /auth/two-step/disable`        | With the password and a code: off                           |
| `POST /auth/two-step/recovery-codes` | With the password and a code: ten new recovery codes        |

Turning codes on ends every other session, which was signed in without a
code. Making an API token takes a code too, as `code` next to
`currentPassword`. Tokens made before keep working. A password reset by mail
changes the password and nothing else: the next sign-in asks for the code as
before, so a reset is no way around it. Someone who loses both the phone and
the recovery codes needs whoever runs the server, who can clear
`two_step_since` and `two_step_secret` for the account in the database.

The secret is kept encrypted with AES-256-GCM under `TWO_STEP_KEY`, bound to
the account it belongs to. Without the key the database holds nothing that
makes codes. The JSON backup leaves it out, with the recovery codes. A dump
of the database keeps both, so restoring it on a server with the same key
keeps two-step sign-in working. Restored with another key, or with none,
codes from the app no longer work and recovery codes still do. Without
`TWO_STEP_KEY` the server offers no setup at all.

### Changing the email address

With mail set up, `PATCH /auth/me` with a new `email` and `currentPassword`
does not change the address yet. The answer has it as `pendingEmail`, a link
to `/confirm-email#token=...` goes to the new address, and the old address
gets a notice. The page asks for a press of a button before it sends the
token to `POST /auth/email/confirm`, so a mail scanner that opens links does
not confirm it. The link follows the rules of a reset link: random, kept as
a hash, once, for an hour. An account has one new address waiting at a
time. Changing the password, signing out everywhere and a password reset
cancel it. If the mail to the new address cannot be sent, the answer is
`503` and nothing changes. Without `SMTP_HOST` the address changes at once,
as before.

### API tokens

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

### Shared notes

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
answers with `"kind": "notebook"`, the name and the list of its notes and of
the notes in the notebooks inside it, at any depth, each with the way to its
notebook below the shared one ("Bread / Sour"), and `GET
/public/notes/:token/:noteId` gives one of them. Which notes belong to the
notebook is looked up with every request: a note added later is there, and one
that is moved out, put in the trash or turned into a template answers `404`
from then on. The answer
to the right password has an `access` value. Sent back in an `X-Share-Access`
header it opens the notes of the notebook for an hour, so the password is
typed once and only real attempts count against the limit. It is worth nothing
for another link, or after the password changed.

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
whose live link makes the note or notebook public, or `null`: the notebook
itself or the nearest one it is inside, however far up.

### Attachments and imports

A note's files are uploaded with `POST /notes/:id/attachments`, one per
request, as `file`. The type is read from the bytes and has to be PNG, JPEG,
GIF, WebP, PDF or plain UTF-8 text. SVG, HTML and anything else is a `400`,
whatever the name says. A file may have `ATTACHMENT_MAX_MB`, an account
`ATTACHMENT_ACCOUNT_MB` in all, and past either the answer is `413`. The
files are kept under their ids in `ATTACHMENTS_DIR`, never under a name a
user chose. A note links to a file as `attachment:<id>`, which is what the
editor puts in. `GET /notes/:id/attachments` lists the files, each with a
`url` that works without a login for five minutes:
`/api/attachments/<id>?expires=…&signature=…`, an HMAC over the file, its
owner and the expiry, so an `<img>` can load it. The web app asks again
before they run out. The answer always has `X-Content-Type-Options: nosniff`
and a sandboxing `Content-Security-Policy`, images come `inline`, and PDF
and text only as downloads. A shared note's answer has `attachments`, the
signed addresses of that note's own files only, and only once its password
was given. A shared page renews them with `GET
/public/notes/:token/attachments` (or `/:token/:noteId/attachments` in a
shared notebook), which goes through the same checks and is not counted as a
view. Deleting a note for good, emptying the trash, the purge and deleting
the account remove the files with the rows. The purge job also sweeps out
files that have no row, on start-up and every hour. The zip export puts the
files under `attachments/<id>/` and links the notes to them by relative
path, with every character a Markdown address could trip on encoded. It is
written out as it is made, one file at a time, and a file missing from
storage is left out and named in `attachments/MISSING.txt`. The import takes
the images and PDFs a note links to or embeds (Obsidian's `![[photo.png]]`
too) and makes them the note's attachments; one no note links to is skipped.
Evernote attachments are still left out. The server never fetches anything
from an address in a note.

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

### Endpoints for scripts

The endpoints a script is most likely to want. The rest is in `/api/docs`.

| Method & path                                | What it does                                |
| -------------------------------------------- | ------------------------------------------- |
| `POST /auth/login`                           | `{ token, user }`, or `{ twoStep, ticket }` |
| `POST /auth/login/code`                      | The ticket and a code, returns a token      |
| `GET /notes?notebookId=&tag=&sort=&page=`    | Note list (`notebookId=none` for unfiled)   |
| `POST /notes`, `GET/PATCH/DELETE /notes/:id` | Notes (`DELETE` moves to the trash)         |
| `GET /search?q=&notebookId=&tag=&page=`      | Full-text search, `"phrases"` in quotes     |
| `GET /export`, `GET /notes/:id/export`       | Everything as a zip, one note as `.md`      |
| `GET /export/backup`, `POST /import/backup`  | The JSON backup, and its restore            |
| `GET/POST /notes/:id/attachments`            | A note's files, upload one as `file`        |
| `DELETE /attachments/:id`                    | Remove a file                               |
| `POST /import`                               | Markdown, text, `.enex` or zip, `files`     |

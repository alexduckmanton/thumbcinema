# thumbcinema

An online flipbook animation tool. Draw a sketch, add a page, draw the next one,
play it back. Originally built 2012–2015 on WordPress; the server was switched off
years later. This repo is the 2025 revival: **the original front end, unchanged, on
a new back end.**

Live at `thumbcinema.alexduckmanton.com`.

---

## The one rule

**The front end is a museum piece. Do not modernise it.**

Everything under `public/script/` (except `public/script/general/*` files listed as
new below) and all of `public/style/` is 2013 code, copied byte-for-byte out of the
old WordPress theme. It is Backbone 1.0, Underscore, jQuery 1.9.1 and paper.js 0.8,
all vendored locally. It works. The point of the project is that it still works.

Do not:

- convert it to ES modules, classes, or a build step
- upgrade jQuery/Backbone/paper.js
- reformat it, add semicolons, or change the tab indentation
- "fix" the global variables (`flipbook`, `canvas_layer`, `onion_layer`, `transform`,
  `eraser`, …) — the files depend on load order and on each other via globals

If something genuinely must change in original code, prefer adding an override in
`public/style/revival.css` or a new file in `public/script/general/`, so the diff
against 2013 stays visible in one place.

## What is new vs original

| Path | Origin |
|---|---|
| `public/script/Flipbook.js`, `public/script/flip/**`, `public/script/lib/**` | **original**, unchanged |
| `public/script/general/{header,like,report,profile,errors}.js` | **original**, unchanged |
| `public/style/style.css`, `public/style/scss/**`, `public/style/type/Arvo-*` | **original**, unchanged |
| `public/images/**`, favicons | **original**, unchanged |
| `public/*.html` | new — hand-converted from the PHP templates |
| `public/style/revival.css` | new — the only CSS that overrides 2013 |
| `public/style/type/tc-wordmark.*` | new — the wordmark, subset from Pecita (OFL). See `TC-Wordmark-ABOUT.txt` |
| `public/style/type/inter-latin-variable.woff2` | new — the site's only text face. See `Inter-ABOUT.txt` |
| `public/script/general/{browser-check,device,gallery,boot-create,boot-playback}.js` | new — replaces what PHP used to inline |
| `api/`, `lib/`, `scripts/`, `db/` | new — the back end |

Four original scripts are kept for reference but **not loaded** by any page:

- `general/like.js`, `general/report.js`, `general/profile.js` — they drove BuddyPress
  features that no longer exist.
- `flip/undo.js` — an abandoned second undo implementation. The original `footer.php`
  didn't load it either; the undo that actually runs lives in `flip/canvas.js`.

## Running it

```bash
npm install
cp .env.example .env     # then paste your Neon connection string in
npm run db:migrate
npm run dev              # http://localhost:3000
```

`npm run dev` serves `public/` and mounts the real API router — no Vercel CLI, no
Docker, no login. It needs `DATABASE_URL` for anything that touches the gallery or
saving; the drawing tool itself works without one.

| Command | Does |
|---|---|
| `npm run dev` | Local server on :3000 |
| `npm run db:migrate` | Applies `db/schema.sql` (idempotent) |
| `npm run db:import-archive` | Loads the 2012–2015 flipbooks from `_original/` |
| `npm run db:stats` | Row counts and storage use |

## Architecture

Static pages + one serverless function + one Postgres table.

```
browser ──> public/*.html          static, on Vercel's CDN
        └─> /api/*  ──> api/index.js ──> lib/router.js ──> Postgres (Neon)
            /saveflipbook
```

- **`lib/router.js` is the entire API.** Every route is rewritten to the single
  `/api` function by `vercel.json`, and the dev server calls the same module
  directly. One router, two hosts, no drift.
- Handlers use plain Node `req`/`res`, never Vercel's `req.query`/`req.body` sugar,
  which is what makes that possible.
- `vercel.json` passes the original path through as `__path` rather than trusting
  either platform's rewrite semantics.

Routes:

| Route | Purpose |
|---|---|
| `POST /saveflipbook` | The 2013 endpoint. Form-encoded, returns a bare `/f/{id}` in the body. `data.js` assigns that straight to `window.location.href`, so **do not change this contract.** |
| `GET /api/flipbooks?view&cursor&limit` | Gallery listing. `view` is `featured` (default) or `all`; `cursor` is opaque keyset pagination |
| `GET /api/flipbooks/:id` | Metadata; also increments the view counter |
| `GET /api/flipbooks/:id/data` | The artwork |
| `GET /api/flipbooks/:id/thumbnail` | PNG |
| `PATCH /api/admin/flipbooks/:id` | Admin only. Sets `featured` and/or `nsfw` |

## The design, post-2013

The chrome has moved on from 2013; the drawing tool hasn't, and won't. Everything
here lives in `revival.css`.

### Type

- **One face: Inter, everywhere.** 2013 ran two — Arvo, a slab serif, on
  `html`/`body` and every heading and button, and Arial/Helvetica on paragraphs,
  labels and inputs — so body copy and the heading above it disagreed, and so did a
  button and its own label.
- **Arvo is still in `style.css` and is simply never referenced.** An `@font-face`
  nothing renders with is never downloaded — `document.fonts` reports it
  `unloaded` — so the original stylesheet stays untouched at no cost. Don't
  "clean it up".
- **Inter is one file for every weight.** Google serves it as a variable font, so
  requesting 400 and 700 returns the same 48 KB latin subset twice. That's why
  `@font-face` declares `font-weight: 100 900` rather than two blocks. See
  `type/Inter-ABOUT.txt`.

- **No text shadows anywhere, and that rule is the file's only `!important`.** 2013
  put a 1px shadow under nearly every piece of type to hold it up against dark and
  saturated chrome that no longer exists. The shadows live in some fifteen compiled
  selector lists, several ID-qualified, so mirroring them all to win on specificity
  would be a wall of copied selectors that drifts silently. A blanket statement is
  written as a blanket rule.

- **Don't use `rem` in `revival.css`.** `style.css` sets the root to 10px — the
  2013 `font-size: 62.5%` trick — and every em in the original is sized against
  that, so `4rem` would silently mean 40px rather than the 64px anyone writing it
  today intends. Changing the root to fix it would resize the whole original
  stylesheet. Design values specified in rem are converted at 16px and written in
  px, with the rem noted in a comment.

### The site header

- **It's the same component on all three pages**, `.siteHeader`: wordmark left,
  whatever that page can do right, in `.headerActions`. Home gets the Featured/All
  toggle and the New button, `/f/:id` gets New, `/create` gets nothing — you're
  already on it.
- **The markup is copied into all three HTML files, not templated.** There's no
  build step and no server-rendered layout, so the choice was duplicating nine
  lines or rendering the header from JS, and a JS header flashes an empty bar on
  every load. **Change one, change all three.**
- **`sadbrowser.html` deliberately keeps the 2013 header and the logo bitmap.**
  It's the page `browser-check.js` sends you to when your browser is too old to
  run the tool, so it's the one page that can't assume webfonts, flexbox or
  `:has()`. It is not a fourth copy that got missed.
- **On `/create` and `/f/:id` the header's width tracks `.center`.** style.css
  sizes that column at 640px, dropping to 90% below 730px, and the wordmark is
  meant to start exactly where the canvas does — so the header container is
  640 + its padding either side, and switches to a 5% padding below 730px to match
  the percentage. Change the header's padding and this has to move with it.
- **The selectors are written `#header.siteHeader`, not `.siteHeader`.** The 2013
  rules are keyed on IDs — `#header` sets the dark bar and the 40px height, and
  `#header ul#messages.active` is (2,1,1) — so a bare class loses to every one of
  them. This was a real bug once: the class-only version left the dark bar in place
  and the header overlapping the page.
- **`ul#nav` is gone from all three pages.** `header.js` still refers to `#nav` in
  its login and message handlers, but each is a jQuery call on an empty set, which
  is a no-op. The home page had been running that way since the conversion.
- **The one-row breakpoint isn't load-bearing any more.** `#headerContainer`
  wraps, so getting the number wrong costs an early or late fold rather than a
  header hanging off the side of the window. It used to be a derived number that
  had to be exactly right, and it was wrong — see the note in the CSS.
- **The wordmark is live text, not the logo PNG**, set in **Pecita** (Philippe
  Cochy) — the typeface the 2013 logo was drawn in. Vendored, so the page still
  makes no third-party requests.
- **The wordmark font is called `TC Wordmark`, and it contains one word.** Two
  things to know before touching it, both in `type/TC-Wordmark-ABOUT.txt` along
  with the command that rebuilds it:
  - It's **a subset of the string "thumbcinema"**. Pecita joins its letters with
    contextual alternates, and that joining is what makes the wordmark read as the
    logo rather than as eleven separate letters — but `calt` is also nearly all of
    the font's weight: 383 KB as WOFF2 for the whole face, 68 KB for lowercase
    alone, 18 KB for the glyphs this one word needs. Anything else set in this
    family falls through to Inter, silently. **If the wordmark's text ever changes,
    the font has to be rebuilt.**
  - It's named `TC Wordmark` rather than `Pecita` because a subset is a Modified
    Version under the OFL and "Pecita" is a Reserved Font Name. The original
    copyright and licence notices are intact inside the file.
- **Don't put `letter-spacing` on the wordmark.** Pecita is a joining script;
  spacing it apart pulls the letters off each other's entry and exit strokes and
  it stops being one line of handwriting.
- **`#messagesBG` has to be `pointer-events: none`.** It's stretched over the whole
  header now instead of being a 40px bar of its own, and it's transparent until
  header.js gives it a type class — so without that it silently swallows every click
  on the wordmark, the toggle and the create button.

### The home page grid

The 2013 home page was mostly a 25em yellow banner and a float mosaic, with the
flipbooks as what was left over. Now they're the page.

- **One uniform 16:9 tile, `auto-fill`ed, 320px minimum.** The mosaic's
  large/medium tiles came off three fixed container widths, which left a ragged
  edge at every size in between. Every flipbook is the same 640x360 canvas, so
  they all get the same card. 320 rather than something smaller because these are
  drawings, not thumbnails of drawings — below that a stick figure is a smudge.
- **The minimum is `min(320px, 100%)`, not a bare `320px`.** A grid track won't
  shrink below its minimum, so a hard 320 pushes the column wider than a 320px
  phone and the whole page scrolls sideways.
- **`revival.css` turns the mosaic off by matching `:nth-child(n)`**, which ties
  the original's `:nth-child` specificity and wins on source order. That's why
  there isn't an `!important` in there.
- **Card titles are clipped, not `display: none`.** The card is an `<a>` whose only
  text is that span, so hiding it outright leaves every link in the grid with no
  accessible name. `gallery.js` still renders it.

## Featured, NSFW and admin mode

The home page has a **Featured / All** toggle. Featured is the default and is what
the 2013 home page showed; All is everything else that isn't NSFW.

- **New saves default to `featured = false`** and are promoted by hand.
- **NSFW hides a flipbook from both tabs** but leaves it working on its own URL,
  exactly as the original's reporting did. It's also the moderation lever — admin
  mode can set it on anything, which matters because saves are public immediately.
- **Archive rows' `featured` is reconstructed, not recovered.** See `docs/archive.md`;
  the short version is that it's derived from the WordPress author ID in the filename,
  because "featured" only ever meant "not anonymous".

Admin mode is a single shared secret in `ADMIN_TOKEN` — there are no accounts, and one
administrator flipping two booleans doesn't warrant inventing them. Visit
`/?admin=<token>` once; it's stored in `localStorage` and scrubbed from the URL. Heart
= featured, report flag = NSFW, reusing the 2013 sprite.

Two things to keep in mind:

- **If `ADMIN_TOKEN` is unset or under 16 characters the admin API 404s entirely.**
  It fails closed, so a deploy that forgets it is safe rather than open.
- **The token also affects reads.** `isAdmin()` on the listing route is what makes
  NSFW rows visible in the All tab for you only — otherwise anything you moderated
  would be impossible to find and un-moderate.

## Data

One table, `flipbooks`. See `db/schema.sql` — it is commented.

Artwork is stored **gzipped in a `bytea` column** and served back with
`Content-Encoding: gzip`, never decompressed server side. paper.js SVG output is
very repetitive and compresses to ~25%, which is what keeps the 585-piece archive
(247 MB of artwork, 62 MB stored) inside Neon's free tier.

There are **two artwork formats** and both are still live:

- `svg` — paper.js `exportSVG()` output. Everything from 2013 onward.
- `legacy-json` — paper.js layer/segment JSON. The original 2012 format; 147 of the
  archive pieces. `data.js` replays these stroke by stroke through the pencil tool.

`/api/flipbooks/:id/data` **must serve `legacy-json` as `text/plain`** — `data.js`
calls `JSON.parse()` on the response itself, so jQuery must not parse it first.

See `docs/data-formats.md` for the details.

## Two deployments, one database

The site runs twice, from two branches of this repo, against **one** Neon database:

| Branch | Vercel project | URL |
|---|---|---|
| `main` | `thumbcinema` | `thumbcinema.vercel.app` |
| `time-capsule` | `thumbcinema-time-capsule` | `thumbcinema-time-capsule.vercel.app` |

`time-capsule` is the revival as it first shipped and is meant to stay that way — the
museum piece of the museum piece. `main` is where the UI is allowed to move on. Both
serve their own copy of `api/index.js`, and the front end only ever calls same-origin
relative paths, so neither deployment knows the other exists.

Sharing the database is the whole point: a flipbook saved in either version appears in
both, and moderating it in one moderates it in both, because `featured` and `nsfw` are
columns rather than anything per-deployment.

What that costs is schema freedom:

- **Migrations must be additive, and only `main` may make them.** `time-capsule` runs
  older query code against the same table. `ADD COLUMN IF NOT EXISTS` and new indexes
  are fine; renaming, dropping or retyping a column the old code reads is not.
- **Every new column needs a `DEFAULT`.** `createFlipbook()` on `time-capsule` won't
  mention it, so a `NOT NULL` column without one breaks saving on the old version the
  moment the migration lands — and it breaks the deployment you aren't looking at.
- **Never run `npm run db:migrate` from `time-capsule`.** Its `db/schema.sql` is a
  frozen copy and will drift. Re-applying it is idempotent so it destroys nothing, but
  it is at best a no-op and at worst misleading about what production actually has.

If a change genuinely can't be made additively, add a view or a second table rather
than a second database.

Both projects need `DATABASE_URL` and `ADMIN_TOKEN`, set to the same values, and both
carry an **Ignored Build Step** so neither builds the other's branch. Only
`thumbcinema` has the Neon integration's `POSTGRES_*`/`PG*` aliases; nothing reads
them, since `lib/db.js` uses `DATABASE_URL` alone.

## Things that will bite you

- **A schema change can break the deployment you aren't looking at.** See "Two
  deployments, one database" above — `time-capsule` runs 2025-revival query code
  against the same live table that `main` migrates.

- **Playback must not hand `data.js` its artwork URL at construction time.**
  `data.js` starts its fetch inside the constructor but sets up the pencil that
  legacy flipbooks are redrawn with via `_.defer()`. Whichever lands first wins. In
  2013 WordPress took tens of milliseconds to serve the artwork so the pencil always
  won; a local server or a warm CDN answers in ~3ms and the fetch wins instead, which
  throws inside the jQuery success handler and leaves **every 2012 flipbook stuck on
  the loading spinner**, silently. `boot-playback.js` therefore builds the Flipbook
  with no URL — making the constructor's `load()` a no-op — and sets the URL and calls
  `load()` itself one tick later. Don't "simplify" that back.
- **`errors.js` is only loaded on `/create`.** It binds `window.onerror` to the crash
  recovery flow, which only exists on the create page. The original loaded it
  everywhere, which meant any error during playback threw a second error.
- **The save request is capped at ~4 MB** by Vercel's request limit. The form encoding
  inflates the SVG, so the practical ceiling is roughly a 2.5 MB drawing. About 5% of
  the historical archive would exceed it. `lib/http.js` returns a clean 413.
- **New flipbooks are public immediately and there is no rate limiting.** This is a
  deliberate choice, matching the original. `lib/router.js` `saveFlipbook()` is where
  a throttle would go if it ever needs one.
- **No accounts.** `logged_in` is hardcoded `true` everywhere, which is what makes the
  original save form render its single-button variant and skip the BuddyPress account
  forms. It also enables the draft button, which `revival.css` hides — a draft is
  meaningless with no account to return to it with.
- **The gallery uses keyset pagination, not OFFSET.** With an infinite scroll and
  OFFSET, one flipbook saved mid-scroll shifts every later row down and the reader
  sees a duplicate. Cursors compare on `(created_at, id)`, which is stable under
  inserts and matches the index.
- **Gallery fetches carry a generation number.** Switching tabs empties the grid, so a
  response still in flight from the previous tab would otherwise land in it and splice
  the two lists together. Responses whose generation is stale are dropped.
- **Re-running the archive import does not reset `featured`.** By the second run that
  column reflects curation done in admin mode, so it's only set on insert.
  `--reset-featured` opts back into the inference and discards that.
- **`_original/` is gitignored** and is the only copy of the archive seed data. Don't
  edit it, and don't let it get deleted — see `docs/archive.md`.

## Docs

- `docs/architecture.md` — how the pieces fit, and why WordPress went away
- `docs/data-formats.md` — the two artwork formats, the save contract
- `docs/archive.md` — what survived the old server, and what didn't
- `docs/deployment.md` — Vercel + Neon setup

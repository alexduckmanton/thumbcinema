# thumbcinema

An online flipbook animation tool. Draw a sketch, add a page, draw the next one,
play it back. Originally built 2012–2015 on WordPress; the server was switched off
years later. This repo is the 2025 revival: **the original front end, unchanged, on
a new back end.**

Live at `thumbcinema-time-capsule.vercel.app`.

---

## You are on the frozen branch

**`time-capsule` is the archived version of the revival. Ongoing work happens on
`main`.**

This branch is the 2025 revival as it first shipped, kept running so the original
front end stays visible in its original setting. Small bug fixes are welcome. New
features, redesigns and dependency bumps are not — those belong on `main`, which is
free to modernise the UI.

It deploys to its own Vercel project (`thumbcinema-time-capsule`) but shares `main`'s
Neon database. That has three consequences worth reading before you touch anything:

- **Never run `npm run db:migrate` from this branch.** The `db/schema.sql` here is a
  frozen copy and will fall behind the live table. Re-applying it is idempotent so it
  destroys nothing, but it misrepresents what production actually has.
- **Never change the schema from this branch at all.** Migrations are `main`'s job and
  are additive-only, specifically so this branch's older query code keeps working. A
  schema change made here would break the other deployment, not this one.
- **Flipbooks and moderation are shared.** A flipbook saved here appears on `main`'s
  deployment and vice versa, and hiding one hides it in both — `featured` and `nsfw`
  are columns, not per-deployment state.

If something here is broken badly enough to need a schema change, fix it on `main`
first, additively, and only then reflect it here if it's needed at all.

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
| `public/style/style.css`, `public/style/scss/**`, `public/style/type/**` | **original**, unchanged |
| `public/images/**`, favicons | **original**, unchanged |
| `public/*.html` | new — hand-converted from the PHP templates |
| `public/style/revival.css` | new — the only CSS that overrides 2013 |
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

## Featured, NSFW and admin mode

The home page shows **featured flipbooks only**, which is what the 2013 home page
showed. `main` has a Featured / All toggle; this branch doesn't, so `view=all` is
still a valid API parameter here but nothing on the site asks for it.

- **New saves default to `featured = false`** and are promoted by hand — so a save
  made here doesn't appear on this home page until it's promoted.
- **NSFW hides a flipbook from the gallery** but leaves it working on its own URL,
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
  NSFW rows visible in the All tab for you only. There's no All tab on this branch,
  so un-moderating something is done from `main`'s deployment — the two share a
  database, so it takes effect here too.

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

## Things that will bite you

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

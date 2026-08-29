# thumbcinema

An online flipbook animation tool. Draw a sketch, add a page, draw the next one,
play it back. Originally built 2012–2015 on WordPress; the server was switched off
years later. The 2025 revival brought the original Backbone front end back on a new
back end, and this is the rewrite of that front end: **same product, modern code.**

Live at `thumbcinema.alexduckmanton.com`.

**This file is the map and the rules.** Anything that needs more than a paragraph lives
in `docs/` — the index is at the bottom, and the right one is worth opening before
working on that part of the tree.

## The stack

| | |
|---|---|
| Build | Vite 8 |
| UI | React 19 + TypeScript, strict |
| Drawing | paper.js 0.12 (`paper-core`) |
| Routing | ~60 lines over the History API, `src/router/` |
| Styling | Plain CSS, one module per component |
| Tests | Vitest + Testing Library |
| Lint and format | Biome |
| Back end | Unchanged — `api/`, `lib/`, `db/`, `scripts/` |

`react`, `react-dom`, `paper` and `pg` are the only runtime dependencies. No state
library, no CSS framework, no router package, no icon library — keep it that way.

**The visual design is deliberately unchanged.** This was a port, not a redesign. If
something looks different from the 2013 revival, that's a bug unless the comment next to
it says otherwise.

**`time-capsule` is a branch still running the 2013 front end, and it is the reference.**
When you need to know what the old behaviour was, that branch is the answer, not
archaeology. It shares one database with `main` — see **Two deployments** below, which
is the constraint behind every rule about the schema.

## Layout

```
src/
  router/       ~60 lines over the History API
  lib/          api client, admin token, device, messages, store
  components/   header, buttons, spinner, messages, RouteShell
  routes/       gallery/, create/, playback/ — lazy, one chunk each
  flipbook/
    engine/     the drawing tool. No React in this directory.
    trace/      the photo you trace over. No paper.js here either.
    preview/    the flipbooks that play in a gallery card. No paper.js here.
    card/       one flipbook in a list
    components/ canvas, page strip, trays, save form, cursors
  styles/       tokens, element defaults, the icon sprite
```

The three "no X here" lines are the load-bearing part — two of them are in **Rules**, and
`trace/` keeps its own boundary for the same reason. Everything else is findable, and the
per-area detail is in `docs/`.

## Running it

```bash
npm install
cp .env.example .env     # then paste your Neon connection string in
npm run db:migrate
npm run dev              # http://localhost:3000
```

Node 22.12+ (Rolldown imports `styleText` from `node:util`). `scripts/with-node.js`
re-executes under a version that will do, so no `nvm use` first.

`npm run dev` is Vite with the real API router mounted as middleware, so dev and
production route identically. It needs `DATABASE_URL` for the gallery and saving; the
drawing tool works without one.

| Command | Does |
|---|---|
| `npm run dev` | Vite on :3000, API included |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run test:coverage` | Vitest with a v8 coverage report |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome, read-only |
| `npm run lint:fix` | Biome, applying what it can fix safely |
| `npm run check` | Typecheck, lint and tests — what to run before pushing |
| `npm run preview` | Serves the built `dist/` — static only, no API |
| `npm run db:migrate` | Applies `db/schema.sql` (idempotent) |
| `npm run db:import-archive` | Loads the 2012–2015 flipbooks from `_original/` |
| `npm run db:backfill-brotli` | Compresses `data_br` for any row without one |
| `npm run db:backfill-thumbnails` | Cuts an SVG cover out of any SVG row without one |
| `npm run db:stats` | Row counts and storage use |
**`npm run check` is the gate.** There is no CI. Vercel runs the typecheck as part of
`npm run build`, so a type error can't reach production — but a lint failure can.

## Rules

Break one of these and something goes wrong somewhere else, usually silently.

- **`src/flipbook/engine/` must not import React.** The engine owns a mutable paper.js
  scene, which React has no business re-rendering; React drives it through method calls
  and subscribes to a small `Store` for the dozen scalars a toolbar needs. That boundary
  is also what makes the fiddly parts testable without rendering anything.
- **The project is the flipbook's own size whatever the canvas is shown at.**
  `Scene.pinCoordinates()` states the view size rather than measuring the element,
  because paper takes the coordinate space from the bounding rectangle and a canvas
  350px wide on a phone would otherwise give a 350-unit project — strokes, thumbnails
  and saved SVG all that shape. CSS owns the display size; `getEventPoint` divides by
  the current scale. Not `view.zoom`, which folds itself into `exportSVG()`.
- **Two page sizes, and there will only ever be two.** `LEGACY_PAGE_SIZE` 640×360 (2012
  to 2026, the whole archive) and `SQUARE_PAGE_SIZE` 640×640 (since). A flipbook keeps
  its shape for ever, so a remix of a 16:9 flipbook is 16:9; nobody chooses and there is
  no UI. Both are 640 across on purpose — stroke widths, the ink cursor and the strip's
  pitch are all calibrated against that width.
- **The artwork is the authority on its own shape, and no viewBox means 640×360** (paper
  0.8 wrote none, so the whole archive is silent and all of it is the legacy page).
  `pageSizeFromSvg()` and `pageSize()` (`lib/thumbnail.js`) are the client and server
  copies of that one rule and IMPORTANT: they must agree byte for byte — the server's
  answer sizes the gallery tile, the client's scales the drawing on it. The
  `width`/`height` columns exist only because the grid needs a shape before the artwork.
  Where they could disagree, the file wins. `docs/drawing-tool.md`.
- **`SYSTEM_LAYERS === 3`, and `LEADING_SYSTEM_GROUPS === 3` with it.** paper exports one
  `<g>` per layer and all 585 archive flipbooks were written by a project with three
  scaffolding layers under the pages. Change one without the other and every page in the
  archive shifts by one, silently. `assertLeadingGroups()` refuses to save an export that
  doesn't match.
- **Migrations must be additive, and only `main` may make them.** `ADD COLUMN IF NOT
  EXISTS` and new indexes are fine; renaming, dropping or retyping a column the 2013 code
  reads is not, and every new column needs a `DEFAULT`. **Never run `npm run db:migrate`
  from `time-capsule`** — its `db/schema.sql` is a frozen copy and will drift.
- **New code that reads a new column has to survive not finding it.** A push builds and
  goes live on its own; the migration is a thing a person runs, so there is always a
  window where new code is talking to the old table. `queryColumnAware()` in
  `lib/flipbooks.js` is what that looks like. `thumbnail_svg`'s first deploy served an
  empty grid to every visitor until the migration caught up.
- **paper.js is lazy, and the gallery must never reach it.** paper is ~210 KB and only
  two of the four routes need it, so routes are lazy and paper is a manual chunk fetched
  by `useFlipbookEngine` rather than imported at the top of `scene.ts`. A plain `import`
  of anything large anywhere under a route silently puts it back into that route's
  preload set, and the chunk table won't say so. After touching imports, run
  `npm run build` and check the two invariants that matter: nothing paper in
  `GalleryPage-*.js`, and no `useCardGesture` in `PlaybackPage-*.js`.
- **One breakpoint, and it tests height as well as width**, written out in full in every
  file that has two layouts. A phone held sideways is 800 points wide and 375 tall, and a
  width test alone hands it a full-size canvas and a page strip in a window that can hold
  neither.

  ```css
  @media screen and (max-width: 730px), screen and (max-height: 560px)   /* phone */
  @media screen and (min-width: 731px) and (min-height: 561px)           /* desktop */
  ```

- **A component styles its own states.** No cross-module selectors — CSS Modules hash the
  names, so `.naming .tools` across two files silently matches nothing.
- **Biome formats `src/` only**, and JSON and CSS not at all. `lib/`, `api/` and
  `scripts/` are the untouched back end; the stylesheets are hand-set. A
  `// biome-ignore` needs its reason on one line, immediately above the code — a reason
  that wraps onto a second `//` line silently stops suppressing anything. Every
  suppression in the tree says why; if a rule is wrong often enough to be worth turning
  off, turn it off in `biome.json` instead.

## Architecture

A single-page app, one serverless function, one Postgres table. `db/schema.sql` is
commented; [`docs/architecture.md`](docs/architecture.md) has the rest.

```
browser ──> dist/index.html      static, on Vercel's CDN
        └─> /api/*  ──> api/index.js ──> lib/router.js ──> Postgres (Neon)
            /saveflipbook
```

`lib/router.js` is the entire API — every route is rewritten to the single `/api`
function by `vercel.json`, and the dev server calls the same module directly. The routes
are unchanged from 2013, and `src/lib/api.ts` is the only place the front end knows about
any of them (`/gif` excepted, which is for other people's pages).

IMPORTANT: **everything else is rewritten to `/`, never `/index.html`.** Under
`cleanUrls` there is no `/index.html` in the output filesystem — it is a 308 to `/`, and
a rewrite doesn't follow redirects, so every deep link 404s while the home page works
perfectly. This has shipped twice: `defc72d` fixed it, and the React rewrite reintroduced
it.

## Two deployments, one database

| Branch | Vercel project | URL |
|---|---|---|
| `main` | `thumbcinema` | `thumbcinema.vercel.app` |
| `time-capsule` | `thumbcinema-time-capsule` | `thumbcinema-time-capsule.vercel.app` |

`time-capsule` is the revival as it first shipped — the 2013 front end — and is meant to
stay that way. Sharing the database is the point: a flipbook saved in either version
appears in both. What it costs is schema freedom; see **Rules** above. Both projects need
`DATABASE_URL` and `ADMIN_TOKEN` set to the same values, and both carry an Ignored Build
Step so neither builds the other's branch.

## Featured, NSFW and admin mode

Featured is the home page's default; All is everything else that isn't NSFW. New saves
default to both flags false and are promoted or flagged by hand — the save form's "adult
stuff" checkbox is gone, so NSFW is now set only from admin mode. It hides a flipbook from
both tabs but leaves its own URL working, which is the moderation lever, since saves are
public immediately. Admin mode is one shared secret in `ADMIN_TOKEN`, no accounts: visit
`/?admin=<token>` once and it is kept in `localStorage`.

- **Unset or under 16 characters and the admin API 404s entirely** — it fails closed, so
  a deploy that forgets it is safe rather than open.
- **The token affects reads too**: it is what makes NSFW rows visible in the All tab, and
  it gates the drawing-mode switch (`docs/drawing-modes.md`).

## Things that will bite you

- `time-capsule` shows square flipbooks cropped — a card shows the middle of the drawing,
  playback the top 56%. Nothing breaks, and it is accepted rather than fixed. Don't
  "solve" it by filtering that branch's gallery; `docs/architecture.md` says why.
- `time-capsule` also still turns phones away from `/create`, because the 2013 code did.
- Every page in the strip is a canvas the size of the drawing at the device pixel ratio,
  so the strip lives under a memory ceiling and `HIDPI_PAGE_LIMIT` drops it to 1:1 past
  50 pages. iOS enforces its per-tab canvas budget by *blanking* canvases rather than by
  failing. A square page is 78% more pixels than a 16:9 one and that limit was set
  against the smaller shape. `docs/create-page.md`.
- Every trace photo taken is held until the tab closes, in that same budget: the undo
  stack holds steps naming its object URL, so revoking early is a ⌘Z that brings back a
  broken image.
- The save request is capped at ~4 MB by Vercel and form encoding inflates SVG, so the
  practical ceiling is roughly a 2.5 MB drawing. The server answers 413.
- A save compresses twice and brotli at quality 11 is the slow one. If saving feels slow,
  that is where to look — `brotli()` in `lib/flipbooks.js`, and dropping to 9 or 10 is
  the first thing to try, not dropping the column.
- Hovering a gallery card downloads a whole flipbook. That is the design; brotli is what
  makes it reasonable (median 45 KB, worst 288 KB). `docs/gallery.md`.
- New flipbooks are public immediately and there is no rate limiting — deliberate, and
  `saveFlipbook()` in `lib/router.js` is where a throttle would go.
- No accounts, everything saves anonymously. The 2013 draft button went with them.
- The gallery uses keyset pagination, not OFFSET: with an infinite scroll, one flipbook
  saved mid-scroll would shift every later row down and show the reader a duplicate.
- There is no boot spinner — the Suspense fallback is the page. `RouteShell` lives in the
  **entry bundle**, so it may not import anything a route is lazy about, or it would be
  waiting on the download it exists to cover. `docs/styling.md`.
- An unsaved drawing holds a spare history entry, so `guardNavigation()` can answer the
  back button rather than block it.
- A successful save leaves the SPA — `window.location.href`, not `navigate()`. None of the
  paper scene, the artwork or the unsaved-work guard should follow you to the next page.
- Re-running the archive import does not reset `featured`; by the second run that column
  reflects curation done in admin mode.
- `_original/` is gitignored and is the only copy of the archive seed data. Don't edit it
  and don't let it get deleted — `docs/archive.md`.

## Docs

Open the one that covers what you're about to touch.

| | |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | how the pieces fit, why WordPress went away, and why brotli beside gzip |
| [`docs/drawing-tool.md`](docs/drawing-tool.md) | the paper.js engine: the 0.8 → 0.12 upgrade, loading, rearranging pages, undo, the clipboard, and the invariants |
| [`docs/drawing-modes.md`](docs/drawing-modes.md) | thirteen answers to "a finger is opaque", the admin-only switch, and v13 — the one that ships |
| [`docs/create-page.md`](docs/create-page.md) | the create page's layout, the page bar, the tray, tracing over a photograph, and the playback page |
| [`docs/gallery.md`](docs/gallery.md) | the grid, the hover preview that plays a flipbook without paper.js, and the play button |
| [`docs/remixes.md`](docs/remixes.md) | editable copies, and how a lineage is stored in two columns |
| [`docs/gif.md`](docs/gif.md) | `/f/:id.gif` — a rasteriser and a GIF writer, in Node, with no dependency |
| [`docs/styling.md`](docs/styling.md) | the CSS conventions, the tokens, the sprite, and the two typefaces |
| [`docs/data-formats.md`](docs/data-formats.md) | the two artwork formats, the save contract, thumbnails, storage |
| [`docs/archive.md`](docs/archive.md) | what survived the old server, and what didn't |
| [`docs/deployment.md`](docs/deployment.md) | Vercel + Neon setup |

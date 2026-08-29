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

**The visual design is deliberately unchanged — except on `/create`, which was
redesigned in 2026.** Everywhere else this was a port, and if something looks different
from the 2013 revival that's a bug unless the comment next to it says otherwise. The
create page is the one place that is now its own thing: every control is a Pecita glyph in
a rail down the left at every width, the flipbook is a column you scroll rather than a row
that slides, and a finger aims from a pad at the bottom of the screen rather than from
anywhere in the white. The hand-drawn tool sprite went with it. See
[`docs/create-page.md`](docs/create-page.md), which says what that cost.

**`time-capsule` is a branch still running the 2013 front end, and it is the reference.**
When you need to know what the old behaviour was, that branch is the answer, not
archaeology. It shares one database with `main` — see **Two deployments** below, which
is the constraint behind every rule about the schema.

## Layout

```
index.html            the single page
src/
  main.tsx            boot
  App.tsx             route switch, lazy per route
  router/             matchRoute(), useLocation(), <Link>
  lib/                api client, admin token, device, messages, store, zoom
  components/         header, buttons, spinner, messages, admin toggles
    RouteShell.tsx    the page before the page — the Suspense fallback, per route
  routes/
    gallery/          the grid, the Featured/All toggle, infinite scroll
    create/           the drawing tool's page, save flow, crash recovery
    playback/         one flipbook, playing
  flipbook/
    engine/           the drawing tool. No React in this directory.
      geometry.ts     pure maths — resampling, angles, handle indices
      scene.ts        paper.js project + layers
      selection.ts    selecting and transforming
      history.ts      undo and redo, as a stack of pages-as-strings
      clipboard.ts    copy and paste, and where a paste lands
      formats.ts      the two artwork formats, in and out
      png.ts          the saved thumbnail, encoded small
      pages.ts        the page list as data, and how to count it
      reorder.ts      dragging a page to another slot, as arithmetic
      print.ts        the printable booklet
      animations.ts   the page-strip keyframes, and freeze()
      constants.ts    canvas size, frame rate, the ink colours
      trace.ts        the photo a page is traced over, as data
      tools/          pencil, eraser, transform, push
      FlipbookEngine.ts  the façade React drives
    usePageReorder.ts the reorder gesture, and the settle at the end of it
    pointer.ts        a finger, and what it does to the cursor and the tool
    drawModes.ts      the answers to "a finger is opaque", numbered v1–v14
    zoomStage.ts      v11–v14's window on the page: the maths, and where it is kept
    trace/            the photo you trace over. No paper.js here either.
      geometry.ts     what a drag and a pinch do to a placement
      useTracePhoto.ts the camera, the decode, and the object URLs
      TraceLayer.tsx  the picture over the paper, and the hand that places it
      TraceMenu.tsx   move it, replace it, or take it away
    components/       canvas, page strip, page arrows, the page's handle,
                      the tool panel, save form, the cursor ring and the transform
                      cursors, the drawing-mode switch
      ToolPanel.tsx   every control on the create page, as Pecita glyphs
      PageStrip.tsx   the pages as a scrolling column, and the canvas over it
      AimPad.tsx      v14's trackpad, and the only place a finger aims from
    card/             one flipbook in a list — the grid, and the remixes under one
      FlipbookCard.tsx   the link, the preview over it, the play button
      useCardGesture.ts  hover, tap, hold and drag, mouse and finger
      preview.ts      the one place the preview chunk is named
    preview/          the flipbooks that play in a card. No paper.js here.
      artwork.ts      a saved file as Path2D pages, on demand
      render.ts       one page onto a 2D canvas
      cache.ts        the flipbooks the grid has in hand, shared by every card
      FlipbookPreview.tsx  the canvas on the hovered card
  styles/             tokens, element defaults, the icon sprite
public/               fonts, images, favicons, sadbrowser.html```

## Running it

```bash
npm install
cp .env.example .env     # then paste your Neon connection string in
npm run db:migrate
npm run dev              # http://localhost:3000
```

Node 22.12+ — Vite and Vitest sit on Rolldown, which imports `styleText` from
`node:util`. There is an `.nvmrc`, and `scripts/with-node.js` wraps every script that
needs it and re-executes under an installed version that will do, so `npm run dev` works
without `nvm use` first. If it can't find one it says so, rather than letting a
`SyntaxError` surface from inside node_modules.

`npm run dev` is Vite with the real API router mounted as middleware — one process, and
`lib/router.js` imported directly, so dev and production route identically. It needs
`DATABASE_URL` for anything touching the gallery or saving; the drawing tool works
without one.

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
- **The project is 640×360 whatever the canvas is shown at.** `Scene.pinCoordinates()`
  states the view size rather than measuring the element, because paper takes the
  coordinate space from the bounding rectangle and a canvas 350px wide on a phone would
  otherwise give a 350-unit project — strokes, thumbnails and saved SVG all that shape.
  CSS owns the display size; `getEventPoint` divides by the current scale. Not
  `view.zoom`, which folds itself into `exportSVG()`.
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
  `npm run build` and check: `GalleryPage-*.js` must import six chunks and none of them
  paper; `PlaybackPage-*.js` must not import the card.
- **One breakpoint, and it tests height as well as width**, written out in full in every
  file that has two layouts. A phone held sideways is 800 points wide and 375 tall, and a
  width test alone hands it a 640×360 canvas and a page strip in a window that can hold
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

A single-page app, one serverless function, one Postgres table — `flipbooks`, and
`db/schema.sql` is commented.

```
browser ──> dist/index.html      static, on Vercel's CDN
        └─> /api/*  ──> api/index.js ──> lib/router.js ──> Postgres (Neon)
            /saveflipbook
```

**`lib/router.js` is the entire API.** Every route is rewritten to the single `/api`
function by `vercel.json`; the dev server calls the same module directly.

**Everything else is rewritten to `/`, and it has to be `/` rather than `/index.html`.**
Vercel checks the filesystem before rewrites, so hashed assets and fonts are served as
files and never reach the catch-all — but under `cleanUrls` the output filesystem has no
`/index.html` in it at all. That path is a 308 to `/`, and a rewrite doesn't follow
redirects: it looks the destination up, finds nothing, and **every deep link 404s while
the app still works perfectly from the home page** — which is exactly as long as it takes
to not notice. This has bitten twice — `defc72d` fixed it for `/f/:id` by dropping
`.html` off the destination, and the React rewrite put it straight back. `cleanUrls` is
also what maps `/sadbrowser` to the
static `public/sadbrowser.html`. See [`docs/architecture.md`](docs/architecture.md).

The routes are unchanged from 2013: `POST /saveflipbook`, `GET /api/flipbooks`,
`GET /api/flipbooks/:id[/data|/thumbnail|/thumbnail.svg|/gif]`, and
`PATCH /api/admin/flipbooks/:id`. `src/lib/api.ts` is the only place the front end knows
about any of them — `/gif` excepted, that one being for other people's pages rather than
for this one.

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

Featured is the home page's default and is what the 2013 home page showed; All is
everything else that isn't NSFW. New saves default to `featured = false` and are promoted
by hand. NSFW hides a flipbook from both tabs but leaves it working on its own URL, which
is the moderation lever — saves are public immediately.

Admin mode is a single shared secret in `ADMIN_TOKEN`; there are no accounts. Visit
`/?admin=<token>` once and it is stored in `localStorage` and scrubbed from the URL.

- **If `ADMIN_TOKEN` is unset or under 16 characters the admin API 404s entirely.** It
  fails closed, so a deploy that forgets it is safe rather than open.
- **The token affects reads too.** It is what makes NSFW rows visible in the All tab, so
  anything moderated can still be found and un-moderated.
- **And it gates the drawing-mode switch**, which is the one thing it does with nothing to
  do with moderation. See `docs/drawing-modes.md`.

## Things that will bite you

- **A schema change can break the deployment you aren't looking at.** See **Rules**.
- **`time-capsule` still turns phones away from `/create`**, because that is what the
  2013 code did. Someone who saved from a phone on `main` and then opens the other
  deployment finds the create button gone. That is the branch being what it is.
- **Every page in the page strip is a canvas the size of the drawing**, at the device
  pixel ratio, on both layouts — so the strip lives under a memory ceiling and
  `HIDPI_PAGE_LIMIT` drops it to 1:1 past 50 pages. iOS enforces its per-tab canvas
  budget by *blanking* canvases rather than by failing. `docs/create-page.md`.
- **A finger only aims from the pad, and that is what v14 is.** v13 read every touch that
  wasn't on the paper or a control as an aiming drag, which was free while the rest of the
  page was empty white and stopped being free when the flipbook became something to
  scroll — under v13 the pages cannot be moved by a finger at all. The pad is found by
  `[data-aim-pad]`, and it is hidden above the phone breakpoint, where a mouse has a
  precise pointer and none of this is a problem it has. `docs/drawing-modes.md`.
- **`html.locked` says `touch-action: pan-y`, not `none`.** `touch-action` is the
  intersection down the ancestor chain and a descendant cannot give back what an ancestor
  took, so `none` on the body meant nothing inside the page could be panned by a finger —
  including the page strip. Pinch and double-tap zoom are still refused; the surfaces that
  must not pan (the canvas, the page handle, the page bar, the aiming pad) each say
  `touch-action: none` for themselves, which is the direction that works.
- **The page strip is a real scroll container, and the scroll position is the page
  number.** `scroll-snap-type: y mandatory` with the drawing laid over the middle of it;
  scrolling calls `goToPage`, and a page turned any other way scrolls. Anything that wants
  to move the flipbook goes through `goToPage` rather than through `scrollTop` — a
  scroll this file drives is deliberately not answered by its own handler, so setting the
  position directly lands on the right slot with the flipbook still on the page it
  started on. That is a bug this has already had once.
- **Every trace photo taken is held until the tab closes**, in that same budget — the
  undo stack holds steps naming its object URL, so revoking early is a ⌘Z that brings
  back a broken image. `docs/create-page.md`.
- **The save request is capped at ~4 MB** by Vercel, and form encoding inflates SVG, so
  the practical ceiling is roughly a 2.5 MB drawing — about 5% of the archive. The server
  answers 413 and the create page says so in plain words.
- **A save compresses twice and brotli at quality 11 is the slow one.** If saving ever
  feels slow on a large flipbook, that is where to look — `brotli()` in
  `lib/flipbooks.js`. Dropping to 9 or 10 would be the first thing to try, not dropping
  the column.
- **Hovering a gallery card downloads a whole flipbook.** That is the design, and brotli
  is what makes it reasonable — median 45 KB, worst 288 KB — but it is a real request per
  card hovered. `docs/gallery.md`.
- **New flipbooks are public immediately and there is no rate limiting.** Deliberate,
  matching the original. `saveFlipbook()` in `lib/router.js` is where a throttle would go.
- **No accounts.** Everything saves anonymously. The 2013 draft button went with them — a
  draft you can't come back to isn't a draft.
- **The gallery uses keyset pagination, not OFFSET.** With an infinite scroll and OFFSET,
  one flipbook saved mid-scroll shifts every later row down and the reader sees a
  duplicate. A tab switch aborts the fetch in flight for the same class of reason.
- **There is no boot spinner: the Suspense fallback is the page.** `RouteShell` draws each
  route's real header and the same placeholder that route uses, so nothing moves at the
  handover — verified at the pixel, both widths. It lives in the **entry bundle**, which is
  the constraint that shapes it: it may not import anything a route is lazy about, or it
  would be waiting on the download it exists to cover. That is why the create page's
  `--panel-width` and its page bar's reserved height are stated on the *page's* stylesheet,
  which the shell already reads, rather than on the panel's and the bar's own.
  `docs/styling.md`.
- **An unsaved drawing holds a spare history entry.** Neither the logo nor the back button
  is a page load here, so `<Link>` goes through the router's `guardNavigation()` and back
  is answered rather than blocked — a duplicate entry is pushed so the first press lands
  on the same URL and can be asked about.
- **A successful save leaves the SPA** — `window.location.href`, not `navigate()`. The
  drawing tool has a paper scene, a megabyte of artwork and an unsaved-work guard on the
  document, and none of it should follow you to the flipbook page.
- **Re-running the archive import does not reset `featured`.** By the second run that
  column reflects curation done in admin mode.
- **`_original/` is gitignored** and is the only copy of the archive seed data. Don't edit
  it and don't let it get deleted — `docs/archive.md`.

## Docs

Open the one that covers what you're about to touch.

| | |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | how the pieces fit, why WordPress went away, and why brotli beside gzip |
| [`docs/drawing-tool.md`](docs/drawing-tool.md) | the paper.js engine: the 0.8 → 0.12 upgrade, loading, rearranging pages, undo, the clipboard, and the invariants |
| [`docs/drawing-modes.md`](docs/drawing-modes.md) | fourteen answers to "a finger is opaque", the admin-only switch, and v14 — the one that ships |
| [`docs/create-page.md`](docs/create-page.md) | the create page's layout, the page bar, the tray, tracing over a photograph, and the playback page |
| [`docs/gallery.md`](docs/gallery.md) | the grid, the hover preview that plays a flipbook without paper.js, and the play button |
| [`docs/remixes.md`](docs/remixes.md) | editable copies, and how a lineage is stored in two columns |
| [`docs/gif.md`](docs/gif.md) | `/f/:id.gif` — a rasteriser and a GIF writer, in Node, with no dependency |
| [`docs/styling.md`](docs/styling.md) | the CSS conventions, the tokens, the sprite, and the two typefaces |
| [`docs/data-formats.md`](docs/data-formats.md) | the two artwork formats, the save contract, thumbnails, storage |
| [`docs/archive.md`](docs/archive.md) | what survived the old server, and what didn't |
| [`docs/deployment.md`](docs/deployment.md) | Vercel + Neon setup |

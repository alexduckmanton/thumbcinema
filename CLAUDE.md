# thumbcinema

An online flipbook animation tool. Draw a sketch, add a page, draw the next one,
play it back. Originally built 2012–2015 on WordPress; the server was switched off
years later. The 2025 revival brought the original Backbone front end back on a new
back end. **This branch is the rewrite of that front end: same product, modern code.**

Live at `thumbcinema.alexduckmanton.com`.

---

## What this branch changed

The 2013 front end — jQuery 1.9, Backbone 1.0, Underscore, Modernizr, svg.js and
paper.js 0.8, loaded as thirty-odd `<script>` tags communicating through globals — is
gone. In its place:

| | |
|---|---|
| Build | Vite 8 |
| UI | React 19 + TypeScript, strict |
| Drawing | paper.js 0.12 (`paper-core`) |
| Routing | ~60 lines over the History API, `src/router/` |
| Styling | Plain CSS, one module per component |
| Tests | Vitest + Testing Library |
| Back end | Unchanged — `api/`, `lib/`, `db/`, `scripts/` |

Nothing was added that isn't earning its place: no state library, no CSS framework,
no router package, no icon library. `react`, `react-dom`, `paper` and `pg` are the
only runtime dependencies.

**The visual design is deliberately unchanged.** This was a port, not a redesign. If
something looks different from the 2013 revival, that's a bug unless the comment next
to it says otherwise — and where a rule *was* dropped, there's a comment saying which
and why (the phantom 60px avatar gutter on the flipbook title, for instance).

**`time-capsule` still runs the 2013 code and is the reference.** When you need to
know what the old behaviour was, that branch is the answer, not archaeology.

## Layout

```
index.html            the single page
src/
  main.tsx            boot
  App.tsx             route switch, lazy per route
  router/             matchRoute(), useLocation(), <Link>
  lib/                api client, admin token, device, messages, store
  components/         header, buttons, spinner, messages, admin toggles
  routes/
    gallery/          the grid, the Featured/All toggle, infinite scroll
    create/           the drawing tool's page, save flow, crash recovery
    playback/         one flipbook, playing
  flipbook/
    engine/           the drawing tool. No React in this directory.
      geometry.ts     pure maths — resampling, angles, circleplay
      scene.ts        paper.js project + layers
      selection.ts    selecting and transforming
      formats.ts      the two artwork formats, in and out
      print.ts        the printable booklet
      animations.ts   the page-strip keyframes
      tools/          pencil, eraser, transform, push
      FlipbookEngine.ts  the façade React drives
    components/       canvas, page strip, trays, save form
  styles/             tokens, element defaults, the icon sprite
public/               fonts, images, favicons, sadbrowser.html
```

**`src/flipbook/engine/` must not import React.** The engine owns a mutable paper.js
scene, which React has no business re-rendering; React drives it through method calls
and subscribes to a small `Store` for the dozen scalars it needs to draw a toolbar.
That boundary is also what makes the fiddly parts testable without rendering anything.

## Running it

```bash
npm install
cp .env.example .env     # then paste your Neon connection string in
npm run db:migrate
npm run dev              # http://localhost:3000
```

Node 22.12+ — Vite and Vitest sit on Rolldown, which imports `styleText` from
`node:util`. There's an `.nvmrc`, and `scripts/with-node.js` wraps every script that
needs it: on an older Node it finds an installed one that will do and re-executes
under that, so `npm run dev` works without remembering `nvm use` first. It says so
when it does. If it can't find one it says that instead, rather than letting a
`SyntaxError` surface from inside node_modules.

`npm run dev` is Vite, with the real API router mounted as middleware — see
`vite.config.ts`. There's no second process and no Vercel CLI;
`lib/router.js` is imported directly, so the dev server and production run identical
routing. It needs `DATABASE_URL` for anything that touches the gallery or saving; the
drawing tool itself works without one.

| Command | Does |
|---|---|
| `npm run dev` | Vite on :3000, API included |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Applies `db/schema.sql` (idempotent) |
| `npm run db:import-archive` | Loads the 2012–2015 flipbooks from `_original/` |
| `npm run db:stats` | Row counts and storage use |

## Architecture

A single-page app, one serverless function, one Postgres table.

```
browser ──> dist/index.html      static, on Vercel's CDN
        └─> /api/*  ──> api/index.js ──> lib/router.js ──> Postgres (Neon)
            /saveflipbook
```

- **`lib/router.js` is the entire API.** Every route is rewritten to the single
  `/api` function by `vercel.json`; the dev server calls the same module directly.
- **Everything else is rewritten to `/index.html`.** Vercel checks the filesystem
  before rewrites, so hashed assets, fonts and favicons are served as files and never
  reach the catch-all.
- `cleanUrls` is what maps `/sadbrowser` to the static `public/sadbrowser.html`.

Routes are unchanged: `POST /saveflipbook`, `GET /api/flipbooks`,
`GET /api/flipbooks/:id[/data|/thumbnail]`, `PATCH /api/admin/flipbooks/:id`. See
`src/lib/api.ts`, which is the only place the front end knows about any of them.

### Code splitting

paper.js is ~210 KB and only two of the four routes need it, so the routes are lazy
and paper is a manual chunk. The gallery — the page most visits land on — downloads
neither. Check this hasn't regressed after touching imports: `npm run build` prints
the chunk table.

## The drawing tool

### paper.js 0.12, not 0.8

Upgrading skipped four years of breaking changes. The ones that bit, all of them
documented at the point they matter:

- **`flatten()` changed meaning.** In 0.8 the argument was a distance and it laid
  points down at that spacing; in 0.12 it's a maximum error, and on a polyline —
  which is what a hand-drawn stroke is — it does nothing at all. Resampling is now
  `resamplePolyline()` in `geometry.ts`, which reproduces 0.8's arithmetic and is
  unit-tested. It's load-bearing twice over: it's most of why saved SVG compresses to
  ~25%, and the push tool assumes evenly spaced points.
- **`view.update()` only draws when something changed**, and paper redraws on its own
  every frame. So `scene.redraw()` is only needed before reading pixels back —
  thumbnails, `toDataURL` — not after every change.
- **`setup()` leaves the project with no layers.** `project.activeLayer` is the getter
  that creates layer zero; `layers[0]` is undefined.
- **`moveAbove`/`moveBelow` are `insertAbove`/`insertBelow`.**
- **`GrayColor` is gone**; `new Color({ gray, alpha })`.
- **A transparent fill is no longer a fill.** `Style.hasFill()` now requires
  `alpha > 0`, so `hitTest({ fill: true })` ignores it. 0.8 used exactly that — an
  invisible fill on the selection box — to answer "is the pointer inside the
  selection", and the transform tool's whole interior went dead when it stopped
  working. `updateTransformType()` asks the rectangle directly instead.
- **`importSVG` applies SVG's default fill**, which is black. A stroke lives inside a
  `<g fill="none">` and is imported on its own, so it comes back filled and every
  loop in a drawing renders as a blob. Cleared explicitly on import.
- **A hidpi canvas's backing store is 2× its CSS size**, so `drawImage` without an
  explicit size copies the top-left quarter at double scale.

### Invariants

- **`SYSTEM_LAYERS === 3`, and `LEADING_SYSTEM_GROUPS === 3` with it.** paper exports
  one `<g>` per layer, and every one of the 585 archive flipbooks was written by a
  project with three scaffolding layers under the pages. Change one without the other
  and every page in the archive shifts by one, silently. `assertLeadingGroups()`
  refuses to save an export that doesn't match, and there are tests either side.
- **The canvas has a z-index and the tools don't.** The pencil and eraser in the tray
  are 304px-tall images anchored by their tips; most of each one sits *behind* the
  canvas and selecting a tool slides more of it into view. Drop the canvas out of that
  stacking order and two enormous pencils appear across the drawing.
- **A selected stroke is moved into the selection layer, not flagged.** The selection
  layer draws *below* the pages, which reads correctly only because the page fades to
  20% while anything is selected.
- **The hidden thumbnail is not always the active page.** The strip hides whichever
  page the drawing canvas stands in front of, which is what `.covered` means — and
  during a delete the arriving page is active from the first frame but takes 750ms to
  get there. Hiding it on `activePage` made it vanish 4ms in and spend its whole
  journey invisible, so it looked like it teleported while every other page slid.
  `state.arriving` is what holds the two apart; don't collapse them. It also steps
  the canvas aside for the duration — it shows the arriving page from the first
  frame, and standing in the destination displaying the page still travelling
  towards it reads as a static duplicate in front of the one that's moving.
- **A page thumbnail can't be raised by its own z-index.** `.page` in the strip has
  one, which makes it a stacking context, so a z-index on the `<canvas>` inside can
  only order it against siblings it hasn't got. Anything that has to come forward —
  the page falling away during a delete, which otherwise spends the first 300ms of
  its fall hidden behind the drawing canvas — is lifted by `freeze(el, {lift: true})`,
  which sets it on the wrapper. 2013's `deletePage` keyframes asked for `z-index: 20`
  on the canvas and were defeated by this.
- **Never size a canvas in a ref callback.** Assigning `width` clears the bitmap, and
  React re-runs inline ref callbacks on every render. Page thumbnails take their size
  from JSX attributes.

### What was fixed on the way

Behaviour is otherwise a faithful port, so these are worth knowing about:

- **The saved thumbnail is the busiest page**, which is what 2013 meant to do. It
  counted segments by reading `.length` off a paper `Layer`, which is undefined, so
  every page scored zero and the cover was always page one.
- **Horizontal flips work.** `selection.layer` was written `selection.layer` in a
  file where the variable was `selection_layer`, so dragging a handle past its pivot
  threw instead of mirroring.
- **A stroke that ends off the canvas updates its thumbnail.** The old mouseup
  listener was on the canvas, so releasing outside it left a stale page.
- **A page animation can't lock the tool up.** Input is blocked while one plays, and
  a hidden document never runs animations — so `finished` never settled and the tool
  stayed blocked until a reload. `play()` now has a deadline.
- **The eraser's recursion is a loop**, with a bound.
- **The pencil-width control is a real slider** to assistive technology, and works
  from the keyboard. The 2013 one was three divs.
- **Undo is still one step deep.** That's a port, not an oversight: 2013 took a
  snapshot on mouse-down and spent it on the next Cmd-Z, and `Scene.snapshot` does
  the same. Making it a stack is a change in behaviour, so it isn't in this branch.

## Styling

**Plain CSS, one `.module.css` per component.** Vite scopes the class names, so
there's no naming convention to maintain and no chance of two components fighting
over `.page`. Global styles are one file, `src/styles/base.css`: fonts, custom
properties, element defaults, and two utility classes.

- **Sizes are in px against an untouched root.** 2013 set the root to 10px — the
  `font-size: 62.5%` trick — and wrote everything in em, so `1.5em` meant 15px and
  `4em` meant 40px. Same rendered sizes, written as what they are.
- **Colours are the 2013 palette**, including the computed ones: the button's border
  and pressed states came out of a Sass mixin that darkened the base by fixed amounts,
  and those are the values that shipped.
- **A component styles its own states.** No cross-module selectors — CSS Modules hash
  the names, so `.naming .tools` across two files silently matches nothing. When the
  save form goes up, the tray is told to stow itself.
- **The icons are the 2013 sprite** (`src/styles/icons.module.css`). Hand-drawn, in
  the same hand as everything else; an icon font would look like a different site.
  The retina sheet has double the spacing as well as double the art, so one set of
  offsets works against both.

### Type

- **One face: Inter, everywhere.** 2013 ran Arvo on headings and buttons and Arial on
  body copy, so a button and its own label disagreed. Inter ships as a single variable
  file for every weight — hence `font-weight: 100 900` rather than two `@font-face`
  blocks.
- **The wordmark is live text in Pecita** (Philippe Cochy), the typeface the 2013 logo
  was drawn in, vendored so the page makes no third-party requests. The whole face
  ships — 4760 glyphs, 383 KB — because its dingbats are also the icon on the create
  button, and because an unmodified conversion may keep the name under the OFL where a
  subset may not. See `public/fonts/Pecita-ABOUT.txt`.
- **Both fonts are preloaded from `index.html`.** Pecita is `font-display: block`,
  which is only safe because of that preload: without it the wordmark can be invisible
  for three seconds. If the preload goes, `block` has to go back to `swap`.
- **No `letter-spacing` on the wordmark.** Pecita is a joining script; spacing it
  apart pulls the letters off each other's entry and exit strokes.

## Data

One table, `flipbooks`. See `db/schema.sql` — it is commented. Artwork is stored
gzipped in a `bytea` column and served with `Content-Encoding: gzip`, never
decompressed server side.

There are **two artwork formats** and both are still live:

- `svg` — paper.js `exportSVG()` output. Everything from 2013 onward.
- `legacy-json` — paper.js layer/segment JSON, the 2012 format; 147 of the archive
  pieces. There are no paths in it, only point lists, so it's replayed stroke by
  stroke through the pencil — a 2012 flipbook genuinely redraws itself as you watch.

`/api/flipbooks/:id/data` **must serve `legacy-json` as `text/plain`**, and the client
must not parse it by content type — which format it is comes from the flipbook's
`format` field. `src/lib/api.ts` returns artwork as text and lets the caller decide.

See `docs/data-formats.md`.

## Featured, NSFW and admin mode

The home page has a **Featured / All** toggle. Featured is the default and is what the
2013 home page showed; All is everything else that isn't NSFW.

- **New saves default to `featured = false`** and are promoted by hand.
- **NSFW hides a flipbook from both tabs** but leaves it working on its own URL,
  exactly as the original's reporting did. It's also the moderation lever, which
  matters because saves are public immediately.
- **Archive rows' `featured` is reconstructed, not recovered.** See `docs/archive.md`.

Admin mode is a single shared secret in `ADMIN_TOKEN` — there are no accounts. Visit
`/?admin=<token>` once; it's stored in `localStorage` and scrubbed from the URL.

- **If `ADMIN_TOKEN` is unset or under 16 characters the admin API 404s entirely.** It
  fails closed, so a deploy that forgets it is safe rather than open. The client treats
  404 the same as 401 and signs out.
- **The token also affects reads.** It's what makes NSFW rows visible in the All tab,
  so anything moderated can still be found and un-moderated.

## Two deployments, one database

The site runs twice, from two branches, against **one** Neon database:

| Branch | Vercel project | URL |
|---|---|---|
| `main` | `thumbcinema` | `thumbcinema.vercel.app` |
| `time-capsule` | `thumbcinema-time-capsule` | `thumbcinema-time-capsule.vercel.app` |

`time-capsule` is the revival as it first shipped — the 2013 front end — and is meant
to stay that way. Sharing the database is the point: a flipbook saved in either
version appears in both.

What that costs is schema freedom:

- **Migrations must be additive, and only `main` may make them.** `ADD COLUMN IF NOT
  EXISTS` and new indexes are fine; renaming, dropping or retyping a column the old
  code reads is not.
- **Every new column needs a `DEFAULT`.** `createFlipbook()` on `time-capsule` won't
  mention it, so a `NOT NULL` column without one breaks saving on the version you
  aren't looking at.
- **Never run `npm run db:migrate` from `time-capsule`.** Its `db/schema.sql` is a
  frozen copy and will drift.

Both projects need `DATABASE_URL` and `ADMIN_TOKEN` set to the same values, and both
carry an **Ignored Build Step** so neither builds the other's branch.

## Things that will bite you

- **A schema change can break the deployment you aren't looking at.** See above.
- **The save request is capped at ~4 MB** by Vercel's request limit, and form encoding
  inflates the SVG, so the practical ceiling is roughly a 2.5 MB drawing. About 5% of
  the historical archive would exceed it. The server answers 413 and the create page
  says so in plain words.
- **New flipbooks are public immediately and there is no rate limiting.** Deliberate,
  matching the original. `lib/router.js` `saveFlipbook()` is where a throttle would go.
- **No accounts.** Everything saves anonymously. The 2013 draft button is gone with
  them — a draft you can't come back to isn't a draft.
- **The gallery uses keyset pagination, not OFFSET.** With an infinite scroll and
  OFFSET, one flipbook saved mid-scroll shifts every later row down and the reader
  sees a duplicate.
- **A tab switch aborts the fetch in flight.** Otherwise a page of Featured results
  lands in a freshly emptied All grid and the two lists get spliced together.
- **An unsaved drawing holds a spare history entry.** 2013 left the page for real on
  every navigation, so `beforeunload` covered the logo and the back button along with
  everything else; here neither one is a page load. `<Link>` goes through the router's
  `guardNavigation()`, and back is answered rather than blocked — a duplicate entry is
  pushed so the first press lands on the same URL and can be asked about. Cost: one
  extra entry, and a live forward button, while the flipbook is unsaved.
- **A successful save leaves the SPA** — `window.location.href`, not `navigate()`. The
  drawing tool has a paper scene, a megabyte of artwork and an unsaved-work guard
  attached to the document, and none of it should follow you to the flipbook page.
- **Re-running the archive import does not reset `featured`.** By the second run that
  column reflects curation done in admin mode.
- **`_original/` is gitignored** and is the only copy of the archive seed data. Don't
  edit it, and don't let it get deleted — see `docs/archive.md`.

## Docs

- `docs/architecture.md` — how the pieces fit, and why WordPress went away
- `docs/data-formats.md` — the two artwork formats, the save contract
- `docs/archive.md` — what survived the old server, and what didn't
- `docs/deployment.md` — Vercel + Neon setup

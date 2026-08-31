# thumbcinema

An online flipbook animation tool: draw a sketch, add a page, draw the next one, play it
back. Built 2012–2015 on WordPress, revived in 2025 on a new back end; this is the rewrite
of that front end — **same product, modern code.** Live at `thumbcinema.alexduckmanton.com`.

**This file is the rules.** How each part works and why is in `docs/`, indexed at the
bottom; the stack, layout and commands are in `package.json`, the directory listing and
`docs/architecture.md`, so they aren't repeated here.

- **`react`, `react-dom`, `paper` and `pg` are the only runtime dependencies.** No state
  library, no CSS framework, no router package, no icon library — keep it that way.
- **The visual design is deliberately unchanged.** A port, not a redesign: anything that
  looks different from the 2013 revival is a bug unless the comment beside it says so.
  **The create page is the one exception and is now its own thing**: every control is a
  40×40 Pecita glyph in a rail down the left at both widths, the page bar is the whole of
  page navigation and sits on the bottom edge of the window on a phone, there is no header
  row at all — Save is fixed in the top-right corner and the `<header>` is 0px of message
  banner — the sheet casts no shadow (`.flat`), and in v14 a finger aims from a pad
  at the bottom of the screen. The hand-drawn tool sprite went with it, and so did the
  scrolling column of thumbnails, the tab above the paper that reordered pages, and a spell
  when you could draw past the page's edge. `docs/create-page.md` says what all of that
  cost.
- **`time-capsule` is a branch still running the 2013 front end, and it is the reference**
  for any question about the old behaviour. It shares one database with `main`, which is
  the constraint behind every rule about the schema.

## Running it

First run: `npm install`, copy `.env.example` to `.env` with your Neon string,
`npm run db:migrate`, then `npm run dev` (:3000). Node 22.12+ — Rolldown imports
`styleText` from `node:util`, and `scripts/with-node.js` re-executes under a version that
will do, so no `nvm use` first. `npm run dev` mounts the real API router as Vite
middleware, so dev and production route identically; it needs `DATABASE_URL` for the
gallery and saving, and the drawing tool works without one. **`npm run check` is the
gate** — typecheck, Biome, tests. There is no CI, and while Vercel typechecks as part of
`npm run build`, a lint failure can still reach production.

## Rules

Break one of these and something goes wrong somewhere else, usually silently.

- **`src/flipbook/engine/` must not import React**; `flipbook/trace/` and
  `flipbook/preview/` must not import paper.js; nothing under `src/offline/` below
  `online.ts` may import React. The engine owns a mutable paper.js scene React has no
  business re-rendering, so React drives it by method call and subscribes to a small
  `Store` for the dozen scalars a toolbar needs, which is also what makes the fiddly parts
  testable without rendering anything.
- **The project is the flipbook's own size whatever the canvas is shown at.**
  `Scene.pinCoordinates()` states the view size rather than measuring the element,
  because paper takes the coordinate space from the bounding rectangle and a canvas 350px
  wide on a phone would otherwise give a 350-unit project — strokes, thumbnails and saved
  SVG all that shape. CSS owns the display size and `getEventPoint` divides by the current
  scale; not `view.zoom`, which folds itself into `exportSVG()`.
- **Two page sizes, and there will only ever be two.** `LEGACY_PAGE_SIZE` 640×360 (2012 to
  2026, the whole archive) and `SQUARE_PAGE_SIZE` 640×640 (since). A flipbook keeps its
  shape for ever, so a remix of a 16:9 flipbook is 16:9; nobody chooses and there is no UI.
  Both are 640 across on purpose — stroke widths, the ink cursor and the strip's pitch are
  calibrated against that width.
- **Pinching moves the sheet, it does not magnify a window.** The create page pinches to
  zoom — `zoomStage.ts` and `ZoomStage`, phone widths only, because it exists for v14's
  aiming pad and a mouse occludes nothing — and on a stage standing in the paper's place the
  viewport is written out as a CSS transform of `.sheet` (`stageTransform`), so the paper
  itself scales and slides under the page bar, the pad and the rail while `paint` copies the
  whole page 1:1. v11's band still does the other reading, `drawImage` of the window into a
  fixed box; both are the same four numbers. **`.onPaper`, the host, must not move** — it is
  what `measureStage` observes and what every pointer coordinate is a fraction of — and
  `.book` needs `.under` for its stacking context, or the sheet's 15 buries the page bar.
  **You cannot zoom out past the whole page**: `maxWidth` is the page and `defaultViewport`
  opens there, so the transform is the identity at rest and pinching only ever goes in.
  There is no drawable surround and there was one for about a day; `docs/create-page.md`
  says why it went and what it cost while it was there.
- **Reordering pages has an engine but no control.** `FlipbookEngine.movePage`, its `move`
  history op and `beginReorder`/`endReorder` are live and tested, and nothing in the UI calls
  them — the tab above the paper went with the layout it belonged to. Whatever replaces it
  calls `movePage`; don't rebuild the model.
- **The artwork is the authority on its own shape, and no viewBox means 640×360** (paper
  0.8 wrote none, so the whole archive is silent and all of it is the legacy page).
  `pageSizeFromSvg()` and `pageSize()` (`lib/thumbnail.js`) are the client and server
  copies of that rule and IMPORTANT: they must agree byte for byte — the server's answer
  sizes the gallery tile, the client's scales the drawing on it. `width`/`height` exist
  only because the grid needs a shape before the artwork; where they disagree, the file
  wins. `docs/drawing-tool.md`.
- **`SYSTEM_LAYERS === 3`, and `LEADING_SYSTEM_GROUPS === 3` with it.** paper exports one
  `<g>` per layer and all 585 archive flipbooks were written by a project with three
  scaffolding layers under the pages; change one without the other and every page in the
  archive shifts by one, silently. `assertLeadingGroups()` refuses an export that doesn't
  match.
- **Migrations must be additive, and only `main` may make them.** `ADD COLUMN IF NOT
  EXISTS` and new indexes are fine; renaming, dropping or retyping a column the 2013 code
  reads is not, and every new column needs a `DEFAULT`. **Never `npm run db:migrate` from
  `time-capsule`** — its `db/schema.sql` is a frozen copy and will drift.
- **New code that reads a new column has to survive not finding it.** A push goes live on
  its own and the migration is a thing a person runs, so there is always a window where
  new code is talking to the old table. `queryColumnAware()` in `lib/flipbooks.js` is what
  that looks like; `thumbnail_svg`'s first deploy served an empty grid until it caught up.
- **paper.js is lazy, and the gallery must never reach it.** paper is ~210 KB and only
  two of the four routes need it, so routes are lazy and paper is a manual chunk fetched
  by `useFlipbookEngine` rather than imported at the top of `scene.ts`. A plain `import`
  of anything large anywhere under a route silently puts it back into that route's
  preload set, and the chunk table won't say so. After touching imports, `npm run build`
  and check two things: nothing paper in `GalleryPage-*.js`, and `useCardGesture-*.js`
  still a chunk of its own. (Grepping the playback chunk for that name always matches — it
  is in that chunk's preload list for `RemixList`, which is meant to carry it.)
- **One breakpoint, and it tests height as well as width**, written out in full in every
  file that switches layout. A phone held sideways is 800 points wide and 375 tall, and a
  width test alone hands it a full-size canvas and a page strip in a window that can hold
  neither.

  ```css
  @media screen and (max-width: 730px), screen and (max-height: 560px)   /* phone */
  @media screen and (min-width: 731px) and (min-height: 561px)           /* desktop */
  ```

- **A save that got no answer goes in the queue; a save that got a refusal does not.**
  `isNetworkFailure()` is the test, and it reads the *error*, not `navigator.onLine` —
  everything in `src/lib/api.ts` throws `ApiError` when there was a response, so anything
  else is the network. Queue a 413 and a message somebody can act on becomes a card that
  will never publish. The queue is IndexedDB, never localStorage: a save is the whole
  drawing, and localStorage is a ~5 MB budget already holding the crash file.
  `docs/offline.md`.
- **A component styles its own states.** No cross-module selectors — CSS Modules hash the
  names, so `.playing .tools` across two files silently matches nothing. Applying another
  module's class to your own markup is fine and is what `RouteShell` does.
- **Biome formats `src/` only**, and JSON and CSS not at all: `lib/`, `api/` and `scripts/`
  are the untouched back end, and the stylesheets are hand-set. A `// biome-ignore` needs
  its reason on one line immediately above the code — wrapping onto a second `//` line
  silently stops it suppressing anything. Every suppression says why; a rule wrong often
  enough to be worth disabling goes in `biome.json`.
- IMPORTANT: **every path but the API is rewritten to `/`, never `/index.html`.** Under
  `cleanUrls` there is no `/index.html` in the output filesystem — it is a 308 to `/`, and
  a rewrite doesn't follow redirects, so every deep link 404s while the home page works
  perfectly. Shipped twice: `defc72d` fixed it, the React rewrite reintroduced it.
  `lib/router.js` is the whole API, and `src/lib/api.ts` is the only place the front end
  names any of its routes (`/gif` excepted, which is for other people's pages).

## Two deployments, and admin mode

`main` is the Vercel project `thumbcinema`; `time-capsule` is `thumbcinema-time-capsule`,
the revival as it first shipped and meant to stay that way. Sharing one database is the
point — a flipbook saved in either version appears in both — and what it costs is schema
freedom, per **Rules** above. Both need the same `DATABASE_URL` and `ADMIN_TOKEN`, and an
Ignored Build Step apiece so neither builds the other's branch.

Featured is the home page's default; All is everything else that isn't NSFW. New saves
default to both flags false and are promoted or flagged by hand — the save form's "adult
stuff" checkbox is gone, so NSFW is set only from admin mode. It hides a flipbook from both
tabs but leaves its own URL working, which is the moderation lever, saves being public
immediately. Admin mode is one shared secret in `ADMIN_TOKEN`, no accounts: visit
`/?admin=<token>` once and it is kept in `localStorage`.

- **Unset or under 16 characters and the admin API 404s entirely** — it fails closed, so a
  deploy that forgets it is safe rather than open.
- **The token affects reads too**: it makes NSFW rows visible in All, and gates the
  drawing-mode switch (`docs/drawing-modes.md`).

## Things that will bite you

- `time-capsule` shows square flipbooks cropped — a card shows the middle of the drawing,
  playback the top 56%. Accepted rather than fixed; don't "solve" it by filtering that
  branch's gallery, and see `docs/architecture.md` for why. It also still turns phones away
  from `/create`, because the 2013 code did.
- Nothing on the create page scrolls, and everything on it is measured off everything else:
  the page bar's band and the aiming pad's height are both terms in `--chrome-bottom`,
  `--chrome-bottom` is a term in `--book-reserve`, and `--book-reserve` is what the drawing
  is sized against. So sizes
  there are `100svh`, never `100dvh` — a unit that moves when a browser slides its own
  chrome in or out is a drawing that resizes under your hand. A square page is what makes
  those numbers worth getting right: at 640 across a square sheet is 640 tall where a 16:9
  one was 360, so the height term binds nearly everywhere now. `docs/create-page.md`.
- A finger only aims from the pad, and that is what v14 is. v13 read every touch that wasn't
  on the paper or a control, which was free while the rest of the page was empty white. The
  pad is found by `[data-aim-pad]`, is hidden above the phone breakpoint, and the rail has a
  switch that puts it away — which changes nothing but the pad, the band it stands in being
  reserved either way. `docs/drawing-modes.md`.
- Every trace photo taken is held until the tab closes: the undo stack holds steps naming
  its object URL, so revoking early is a ⌘Z with a broken image in it. iOS enforces its
  per-tab canvas budget by *blanking* canvases rather than by failing, and with the page
  strip gone these are the only thing left under it. `MAX_BATCH` is 24.
- **The save form is a positioned `<div>`, not a `<dialog>`, and must not be "tidied up".**
  `showModal()` puts an element in the top layer; since Safari 26, iOS tints its own
  toolbars from the page and never samples the top layer, so the wash left a pale band
  above and below it. What *is* sampled is `<body>`'s background or a fixed element at the
  viewport edge — hence `base.css`'s lock making `<body>` fixed and opaque. Both halves
  needed; three attempts to establish. `docs/create-page.md`.
- The save request is capped at ~4 MB by Vercel and form encoding inflates SVG, so the
  practical ceiling is roughly a 2.5 MB drawing; the server answers 413.
- A background upload that rejects shows the crash screen: the create page listens on
  `unhandledrejection`, which is how crash recovery is armed, so anything running outside
  React has to swallow its own failures. `flushPending()` does.
- The service worker's precache list is generated from the bundle and the build fails if
  it can't be (`serviceWorkerPlugin` in `vite.config.ts` fills two markers in
  `src/offline/sw.js`). It precaches `/` and not `/index.html`, for the `cleanUrls` reason
  above (`cache.addAll` rejects on a redirect), and matches with `ignoreVary`, without
  which a host sending `Vary: Origin` loses both typefaces offline.
- paper.js is the one thing the worker does *not* precache, so the drawing tool works
  offline only after one online visit: it is two thirds of the build and only two routes
  ask for it. The `/assets/` branch in `sw.js` keeps it once one does. `docs/offline.md`.
- A save compresses twice and brotli at quality 11 is the slow one. If saving feels slow
  that is where to look — `brotli()` in `lib/flipbooks.js` — and dropping to 9 or 10 is the
  first thing to try, not dropping the column.
- Hovering a gallery card downloads a whole flipbook. That is the design, and brotli makes
  it reasonable (median 45 KB, worst 288 KB). The grid also pages by keyset and not
  OFFSET: with an infinite scroll, one flipbook saved mid-scroll would shift every later
  row down and show the reader a duplicate. `docs/gallery.md`.
- New flipbooks are public immediately and there is no rate limiting — deliberate;
  `saveFlipbook()` in `lib/router.js` is where a throttle would go. No accounts either, so
  everything saves anonymously and the 2013 draft button went with them.
- There is no boot spinner — the Suspense fallback is the page. `RouteShell` lives in the
  **entry bundle**, so it may not import anything a route is lazy about, or it would wait on
  the download it exists to cover. `docs/styling.md`.
- An unsaved drawing holds a spare history entry, so `guardNavigation()` can answer the back
  button rather than block it. A successful save then leaves the SPA outright —
  `window.location.href`, not `navigate()` — so no paper scene, artwork or guard follows.
- Re-running the archive import does not reset `featured`; by the second run that column
  reflects curation done in admin mode. `_original/` is gitignored and is the only copy of
  the seed data — don't edit it, don't let it get deleted. `docs/archive.md`.

## Docs

Open the one that covers what you're about to touch.

- [`architecture.md`](docs/architecture.md) — how the pieces fit, why WordPress went away, why brotli beside gzip
- [`drawing-tool.md`](docs/drawing-tool.md) — the paper.js engine: the 0.8 → 0.12 upgrade, loading, rearranging pages, undo, the clipboard, the invariants
- [`drawing-modes.md`](docs/drawing-modes.md) — fourteen answers to "a finger is opaque", the admin-only switch, and v14, the one that ships
- [`create-page.md`](docs/create-page.md) — the layout, the rail, the page bar, tracing over a photograph, naming a flipbook, and the playback page
- [`gallery.md`](docs/gallery.md) — the grid, two card shapes in it, the hover preview that plays without paper.js, the play button
- [`remixes.md`](docs/remixes.md) — editable copies, and how a lineage is stored in two columns
- [`offline.md`](docs/offline.md) — drawing and saving with no connection: the queue, the service worker, what publishes when
- [`gif.md`](docs/gif.md) — `/f/:id.gif`: a rasteriser and a GIF writer, in Node, with no dependency
- [`styling.md`](docs/styling.md) — the CSS conventions, the tokens, the sprite, the two typefaces
- [`data-formats.md`](docs/data-formats.md) — the two artwork formats, the save contract, thumbnails, storage
- [`archive.md`](docs/archive.md) — what survived the old server, and what didn't
- [`deployment.md`](docs/deployment.md) — Vercel + Neon setup

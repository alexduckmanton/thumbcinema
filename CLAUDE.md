# thumbcinema

An online flipbook animation tool. Draw a sketch, add a page, draw the next one,
play it back. Originally built 2012–2015 on WordPress; the server was switched off
years later. The 2025 revival brought the original Backbone front end back on a new
back end, and this is the rewrite of that front end: **same product, modern code.**

Live at `thumbcinema.alexduckmanton.com`.

---

## The stack

What the 2013 front end was — jQuery 1.9, Backbone 1.0, Underscore, Modernizr, svg.js
and paper.js 0.8, loaded as thirty-odd `<script>` tags communicating through globals —
is worth knowing only because `time-capsule` still runs it. Here it is:

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
  lib/                api client, admin token, device, messages, store, zoom
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
      pages.ts        the page list as data, and how to count it
      print.ts        the printable booklet
      animations.ts   the page-strip keyframes, and freeze()
      constants.ts    canvas size, frame rate, the ink colours
      tools/          pencil, eraser, transform, push
      FlipbookEngine.ts  the façade React drives
    components/       canvas, page strip, page arrows, trays, save form
  styles/             tokens, element defaults, the icon sprite
public/               fonts, images, favicons, sadbrowser.html
```

### Biome

`biome.json`, and it is scoped deliberately:

- **The formatter only touches `src/`.** `lib/`, `api/` and `scripts/` are the back end
  the rewrite didn't change; reformatting them would put hundreds of lines of noise
  into files nobody is working in. The linter still reads them.
- **JSON and CSS are excluded outright.** `package-lock.json` belongs to npm, and the
  stylesheets are hand-set — the comments and the grouping in them are doing work that
  a formatter would flatten.
- **`// biome-ignore` needs its reason on one line**, immediately above the code. A
  reason that wraps onto a second `//` line silently stops suppressing anything.
- Every suppression in the tree says why. If a rule is wrong often enough to be worth
  turning off, turn it off in `biome.json` instead.
- **There is no CI.** `npm run check` — typecheck, lint, tests — is the gate, and
  running it is a habit rather than something enforced. Vercel runs the typecheck as
  part of `npm run build`, so a type error can't reach production, but a lint failure
  can.

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
| `npm run test:coverage` | Vitest with a v8 coverage report |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome, read-only |
| `npm run lint:fix` | Biome, applying what it can fix safely |
| `npm run check` | Typecheck, lint and tests — what to run before pushing |
| `npm run preview` | Serves the built `dist/` — static only, no API |
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
- **Everything else is rewritten to `/`, and it has to be `/` rather than
  `/index.html`.** Vercel checks the filesystem before rewrites, so hashed assets,
  fonts and favicons are served as files and never reach the catch-all — but under
  `cleanUrls` the output filesystem has no `/index.html` in it at all. That path is a
  308 to `/`, and a rewrite doesn't follow redirects: it looks the destination up and
  finds nothing, so **every deep link 404s while the app still works perfectly from the
  home page**, which is exactly as long as it takes to not notice. This has now bitten
  twice — `defc72d` fixed the same thing for `/f/:id` by dropping `.html` off its
  destination, and the React rewrite put it straight back.
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

### The project is 640×360 whatever the canvas is shown at

`Scene.pinCoordinates()`, and it is the one thing to understand before touching how
the canvas is sized. paper takes the project's coordinate space from the element's
*bounding rectangle*, so a canvas displayed 350px wide on a phone gave a project 350
units wide and everything drawn on it — strokes, thumbnails, the saved SVG — came out
that shape. The view size is stated instead of measured, and three things follow:

- **CSS owns the display size, entirely.** paper writes an inline `width`/`height`
  onto the element on a hidpi screen; those are removed straight after.
- **`getEventPoint` is wrapped** to divide by however much the canvas is currently
  scaled by, tracked with a `ResizeObserver`. That's the single place paper converts a
  pointer to a project point, so the tools, the hit tests and the selection are all
  corrected at once.
- **Not `view.zoom`.** `project.exportSVG()` defaults to the view's bounds and folds
  its matrix into the output — a zoomed view would save the artwork at the phone's
  scale *and* wrap it in an extra `<g>`, which is the `LEADING_SYSTEM_GROUPS` invariant
  below.

### Invariants

- **`SYSTEM_LAYERS === 3`, and `LEADING_SYSTEM_GROUPS === 3` with it.** paper exports
  one `<g>` per layer, and every one of the 585 archive flipbooks was written by a
  project with three scaffolding layers under the pages. Change one without the other
  and every page in the archive shifts by one, silently. `assertLeadingGroups()`
  refuses to save an export that doesn't match, and there are tests either side.
- **The canvas has a z-index, the page bar has a lower one, and the tools have
  neither.** The pencil and eraser in the tray are 304px-tall images anchored by their
  tips; most of each one sits *behind* the canvas and selecting a tool slides more of
  it into view. Drop either of the two out of that stacking order and enormous pencils
  appear across the drawing.
- **A selected stroke is moved into the selection layer, not flagged.** The selection
  layer draws *below* the pages, which reads correctly only because the page fades to
  20% while anything is selected.
- **A page being deleted is still in `pages` while it falls.** So `pages.length` is
  one too many for 750ms, and deleting the only page — which inserts the replacement
  up front — makes it two. Ask `settledPageCount()` whether this is a flipbook yet;
  the raw length flicks the play buttons on and fades the save button in and out.
- **A page can't be added or removed in the same press that stops playback.** Playback
  changes page every 83ms and a page animation runs for 750ms; doing both at once
  leaves the strip in a heap. `beginPageChange()` stops playback and returns false, so
  the press buys the pause and the next one does the work. It lives in the engine, so
  the `n` and `d` shortcuts go through it as well as the buttons. The drawing tools
  don't need it — they stop playback themselves, and nothing is animating when they do.
- **The hidden thumbnail is not always the active page.** The strip hides whichever
  page the canvas stands in front of — that is what `.covered` means — and during a
  delete the arriving page is active from the first frame but takes 750ms to get
  there. Keying that class off `activePage` hides it 4ms in and leaves it invisible
  for its whole journey, so it reads as teleporting while every other page slides.
  `state.arriving` holds the two apart; don't collapse them. It also steps the canvas
  aside for the duration, because the canvas shows the arriving page immediately and
  standing in the destination displaying the page still travelling towards it reads
  as a static duplicate in front of the one that's moving.
- **A page thumbnail can't be raised by its own z-index.** `.page` in the strip has
  one, which makes it a stacking context, so a z-index on the `<canvas>` inside can
  only order it against siblings it hasn't got — 2013's `deletePage` keyframes ask for
  `z-index: 20` there and get nothing. Anything that has to come forward is lifted by
  `freeze(el, { lift: true })`, which sets it on the wrapper instead. The page falling
  away during a delete needs it: without it the first 300ms of the fall happen behind
  the drawing canvas, which is the whole anticipation and the start of the plunge.
- **Never size a canvas in a ref callback.** Assigning `width` clears the bitmap, and
  React re-runs inline ref callbacks on every render. Page thumbnails take their size
  from JSX attributes.

### Where it differs from `time-capsule`

The port is otherwise faithful, so a difference from the 2013 code is a bug unless
it's one of these. Each is deliberate:

- **The saved thumbnail is the busiest page**, which is what 2013 meant to do. It
  counted segments by reading `.length` off a paper `Layer`, which is undefined, so
  every page scored zero and the cover was always page one.
- **Horizontal flips work.** 2013's `scale.js` reaches for `selection.layer` in a file
  where the variable is `selection_layer`, so dragging a handle past its pivot throws
  instead of mirroring.
- **A stroke that ends off the canvas updates its thumbnail.** The old mouseup
  listener was on the canvas, so releasing outside it left a stale page.
- **A page animation can't lock the tool up.** The page actions are held while one
  plays, and a hidden document doesn't run animations at all — so `finished` never
  settles and 2013 stays held until a reload. `play()` races it against a deadline.
  (Drawing is *not* held: you can put a stroke down mid-animation, as you could then.)
- **The eraser's recursion is a loop**, with a bound.
- **The pencil-width control is a real slider** to assistive technology, and works
  from the keyboard. The 2013 one was three divs.
- **Undo is one step deep**, which is a port rather than an oversight: 2013 takes a
  snapshot on mouse-down and spends it on the next Cmd-Z, and `Scene.snapshot` does
  the same. A stack would be a change to what the tool does, not a fix.
- **You can draw on a phone.** 2013 asked `Mobile_Detect.php` and sent phones back to
  the gallery, and the revival kept that. See below.

## Drawing on a phone

The one place this is deliberately no longer a port. The tool is the same tool — same
canvas, same tools, same save — laid out for a screen a third of the width and for a
finger rather than a pointer.

- **The canvas scales; the artwork does not.** See `Scene.pinCoordinates()` above.
- **The tray is the desktop's tray, and the order of the column with it**: strip,
  canvas, page bar, tools, save. The tools were turned over and stood in a floating
  white box along the bottom edge for a while, on the reasoning that the bottom of the
  window is where a thumb is; it went back because the picture the tool makes is a
  pencil hanging off the bottom of the paper with its length running up behind the
  drawing, and that survives being scaled down but not being flipped. What a phone
  hasn't the width for is the last two buttons — play and circleplay come out
  (`.playbackKey`), which leaves six controls in a 335px column at 20px apart.
- **The tools are cut off at the tray's top edge.** Each is a 304px picture anchored by
  its tip, and on a desktop the whole of that run is behind a 360px canvas. Scaled to a
  phone the paper is 200px tall and the pencil is not scaled with it, so it came out of
  the top of the drawing and stood in the air above it. `clip-path: inset(-20px …)` on
  the list cuts them along the line the page bar's bottom edge runs on, which is where
  the eye already reads them as going under something.
- **The page strip stays, scaled, and `PageNav` is added under it.** The strip was
  hidden on a phone at first, and everything about that was wrong: the page animations
  are two pages moving — one thrown out as another arrives — and half of each one was
  being played on an element with no layout box, so adding a page showed the new one
  arrive out of nowhere, duplicating showed only a bob, and deleting showed a blank
  canvas, because `arriving` steps the drawing aside for a thumbnail that isn't there.
  It is on both layouts now. A page is `--page-width` wide, which the component sets
  from the live canvas, so the thumbnails are copies of the drawing at the size the
  drawing is currently drawn at. What that costs on a phone is the peek: the drawing
  takes all but 16px of the window, and the gutter is spent twice out of that, so 4px
  of gutter leaves 8px of the next page showing. More than that means a smaller
  drawing.
- **Nothing knows the pitch at build time any more.** It was `CANVAS_WIDTH +
  PAGE_MARGIN * 2`, a constant in three places; it is now measured — the component
  reads the page's own padding back off the box, and hands the total to
  `engine.setPageStep()`, which is what the keyframes that throw a page into the next
  slot are built from. That is why `KEYFRAMES` is a table of functions rather than a
  table of arrays, and why `PAGE_MARGIN` is gone from `constants.ts`.
- **`PageNav` is one white bar under the drawing: two arrows, a scrubber, and play.**
  The handle follows the finger while it's held and settles onto the nearest page when
  it's let go (`fractionAt` and `pageAt`, both unit tested), and it follows playback as
  well as leading it, because the engine publishes every page change including the
  twelve a second that `play` makes — which is also the one time the settle's
  transition is turned off. The two arrows stand *on* the bar rather than beside it,
  and stop their own presses reaching it, or each one is also a jump to the end it sits
  at; the handle is over both and covers one when it gets there, which is the right way
  round. They wrap rather than greying out at the ends, because playback loops. **A tap
  on the handle plays**, which is why a press on it waits: it is a tap until it has
  travelled `TAP_SLOP`, and a drag from then on, and the pause a drag opens with is
  paid at the moment it becomes one rather than on the way in. **A one-page flipbook
  puts the handle at the right-hand end**, not the left: one page is the last page as
  much as the first, and a handle at the near end reads as a flipbook you have the rest
  of still to come. The bar is the drawing's width and 8px past it either side —
  `--book-width` is declared on `.center` so both are sized off one formula — which
  halves the distance to the edge of the screen and is what stops it reading as a
  second sheet of paper the same size as the first. It is centred by translation rather
  than by `margin: auto`, because on a phone the drawing is already the full width of
  the column and auto margins on a box wider than its container both resolve to zero.
  `z-index: 10` puts it under the paper, which drops its shadow into the 8px gap above
  it and onto its top edge. **Both arrows stop playback**, as taking hold of the handle
  does, and so do the arrow keys — they go through the same `step()`. A page you asked
  for that shows for 83ms and is then left behind isn't a page turn.
- **The strip stops easing while the bar is dragged.** It slides from page to page over
  0.3s, and under a finger sweeping the bar that is a second flipbook arriving half a
  second behind the first — it reads as the drawing being dragged about rather than the
  pages being turned. `scrubbing` lives on the create page rather than in the engine or
  in either component: the bar knows when a drag starts and stops, the strip is what
  has to stop easing, and it is nothing to do with the drawing.
- **There is no circleplay on the create page's phone layout.** It is the one thing
  that comes off. Six controls is what the tray holds, play is a tap on the handle, and
  circleplay has nowhere left to be asked for. It is still on the playback page at
  every width, and still works with a finger there: it listens for `pointermove` rather
  than `mousemove`, puts `.scrubbing` on `<html>` so the browser doesn't take the
  gesture for a scroll, and — on touch only — covers the canvas with `.scrub` so the
  first movement doesn't draw a line across the flipbook.
- **The width slider stands up, at every width.** A 40px capsule hanging 5px under the
  pencil's tip, exactly as wide as the tool and centred on it — the shape of the thing
  it sets. 2013 laid it on its side because it had 640px of column and no reason not
  to. It lies down again in a window too short to stand it up in, which is the one
  layout difference left in that file, and the component reads which of the two it got
  from the shape of its own track rather than from a second copy of the breakpoint.
- **The window is full, and the width popover is what fills it.** Held sideways the
  column is header, canvas, bar, tray, save button and 16px of air in 390 points, and
  the popover hangs 90px below the tool on top of that. It is the bottom of that box,
  not the save button, that `--book-reserve` is set from — 250 in a short window, which
  is what leaves the drawing 249×140 rather than a page that scrolls under the hand
  drawing on it. It is also why **the save button is over to the right in a short
  window and centred everywhere else**: lying down the popover is 160px through the
  middle of that band, permanently, because the pencil is the tool you start with, and
  centred the two overlap by 46px. Standing up it is 40px hard against the left and
  there is no collision to dodge. `.save` is `--book-width` wide rather than the
  column's width, so "the right" is the right-hand edge of the paper and not of a
  window the flipbook is a narrow panel in the middle of.
- **Zoom is off site-wide.** `maximum-scale=1, user-scalable=no` in the viewport tag,
  which Android honours and iOS ignores, plus `preventPinchZoom()` in `lib/zoom.ts` for
  Safari's gesture events. Double-tap zoom goes with `touch-action: manipulation` on
  the body, and the canvas takes `touch-action: none` so a stroke is never a scroll.

## Styling

**Plain CSS, one `.module.css` per component.** Vite scopes the class names, so
there's no naming convention to maintain and no chance of two components fighting
over `.page`. Global styles are one file, `src/styles/base.css`: fonts, custom
properties, element defaults, and two utility classes.

- **Sizes are in px against an untouched root.** 2013 set the root to 10px — the
  `font-size: 62.5%` trick — and wrote everything in em, so `1.5em` meant 15px and
  `4em` meant 40px. Same rendered sizes, written as what they are.
- **One breakpoint, and it tests height as well as width**, written out in full in
  every file that has two layouts:

  ```css
  @media screen and (max-width: 730px), screen and (max-height: 560px)   /* phone */
  @media screen and (min-width: 731px) and (min-height: 561px)           /* desktop */
  ```

  730 is 2013's number and is the width the page strip needs. The height half is not
  an afterthought: a phone held sideways is 800 points wide and 375 tall, and a width
  test alone hands it a 640×360 canvas and a page strip in a window that can hold
  neither. There's a note in `base.css` saying so.
- **Where a page has two layouts, the phone's is the base and the desktop's is the
  breakpoint** — the create page, the canvas. The shared files aren't, and say why: the
  tray is half the playback page's, which has one layout at every width. The width
  slider has no desktop breakpoint at all any more; the only query in it is the short
  window that lays it down.
- **The flipbook has one shadow and the page strip has another.** A gallery card, the
  flipbook on the playback page and the canvas you draw on are all the same object and
  all take `--shadow-card`; the page bar under the canvas takes it too, because a
  control lying flat under paper that is lifted off the page separates two things meant
  to be read together. `--shadow-page` — wide, offset down, no blur — is now the strip's
  alone, where it says "a sheet lying on the one behind it".
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
- **Pecita doesn't centre itself.** Its ascent and descent are lopsided against where
  the letters actually sit, so centring the text box leaves the word high — 3.25px of
  it at 30px, against Inter's 0.13px. Anything setting Pecita inside a control needs
  the offset measured (`measureText`, `actualBoundingBox*` vs `fontBoundingBox*`) and
  written down: the save button and the create button's dingbat both carry one.

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
- **`time-capsule` still turns phones away from `/create`**, because it is the 2013
  code and that is what it did. Someone on a phone who saved from `main` and then
  opened the other deployment will find the create button gone. That's the branch
  being what it is, not a bug to go and fix there.
- **Every page in the strip is a 640×360 canvas**, ~900 KB of backing store each, on
  both layouts — the thumbnails are displayed smaller on a phone but they are not
  *drawn* smaller, because a page that has to stand behind the live canvas at full
  fidelity when you're on it can't be. Fine for a flipbook you drew on a phone, worth
  remembering if loading a 200-page one into the tool ever becomes a thing.
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

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
      formats.ts      the two artwork formats, in and out
      pages.ts        the page list as data, and how to count it
      print.ts        the printable booklet
      animations.ts   the page-strip keyframes, and freeze()
      constants.ts    canvas size, frame rate, the ink colours
      tools/          pencil, eraser, transform, push
      FlipbookEngine.ts  the façade React drives
    components/       canvas, page strip, page arrows, trays, save form,
                      the cursor ring and the transform cursors
    preview/          the gallery's flipbooks. No paper.js in this directory.
      artwork.ts      a saved file as Path2D pages, on demand
      render.ts       one page onto a 2D canvas
      cache.ts        the flipbooks the grid has in hand, shared by every card
      FlipbookPreview.tsx  the canvas on the hovered card
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
| `npm run db:backfill-brotli` | Compresses `data_br` for any row without one |
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

**A lazy route waits for everything its chunk statically imports, and that used to
include paper.** `scene.ts` imported it at the top, so `import('./routes/playback/…')`
did not resolve — and the metadata and artwork fetches *inside* that route did not
start — until 71 kB gzipped of paper had downloaded and evaluated. It was 77% of the
playback route's second wave and the whole of the wait people were watching. paper is
now fetched by `useFlipbookEngine` and passed down (see `PaperCore` in `scene.ts`), so
it is in no route's preload set and downloads alongside the artwork rather than in
front of it. The route's second wave went from 93 kB to 18 kB; from the gallery, where
the shared chunks are already in memory, from 88 kB to 15 kB.

The trap is that a plain `import` of anything large, anywhere under a route, silently
puts it back. The chunk table won't say so — paper is still its own chunk either way.
What to check is the entry bundle's dependency list for each route: nothing that only
the drawing tool needs belongs in it.

**The gallery's hover preview is split for the same reason and warmed rather than
awaited.** `FlipbookPreview` is `lazy()` and its chunk is 1.8 kB gzipped, but it drags
`engine/formats.ts` along with it — and that file is also in both paper routes' chunks,
so leaving it in the entry would have every visit to every page carry a copy of it. The
factory is named (`loadPreview`) so the gallery can call it in an effect on mount: by
the time a pointer lands on a card the module is in memory and `lazy` resolves out of
the module cache, so the Suspense boundary never shows. What must stay true is that
neither the gallery's chunk nor the preview's reaches paper — `grep from\" dist/assets/
GalleryPage-*.js` after a build is the check, and today it is five imports, none of
them paper.

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
- **`Project#importJSON` imports into the active layer if that layer is empty**, and
  makes a new one otherwise. Both branches are documented as "imports into the
  project", and the obvious way to replace a page's contents — clear the layer, ask
  the project to import, move the children across, remove what it made — hands paper
  an empty active layer, gets *the page itself* back, and then removes it. The
  flipbook comes back one page shorter and the exception surfaces somewhere else
  entirely. `Item#importJSON` has no such heuristic; `History.write` uses it.
- **`item.name` is uniquified within its parent on every insert.** A stroke named
  `4_5` that is picked up and put down comes back `4_5 1`, then `4_5 1 1`. Nothing
  reads a stroke's name — the pencil writes it and `exportSVG` turns it into an `id` —
  but anything comparing two serialisations of a page has to strip it, or *clicking on
  a drawing* looks like an edit. See `History.capture`.

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

### Loading a saved flipbook

`FlipbookEngine.replay()`, and the two loaders that feed it. Four things about it are
load-bearing:

- **There are two stroke vocabularies and both are live.** paper 0.8 exported
  `<polyline points>` and `<line>`, which is all 585 archive flipbooks; paper 0.12
  exports `<path d>`, which is everything saved since the rewrite. A loader written
  against the archive alone renders *nothing at all* for a flipbook made this year,
  and nothing says so — the archive goes on working. `strokeGeometry()` handles all
  three elements, and returns null for anything else so the caller can fall back to
  `importSVG`: a stroke that loads slowly is a bug, a stroke that silently vanishes
  is a lost drawing.
- **`importSVG` is not used per stroke, and the reason isn't speed alone.** It
  resolves styles, attributes, transforms and a matrix for every element — all of
  which the loader then overrides, because the ink colour and cap are restated per
  page. Going straight to the constructors paper's own importer ends up calling is
  4–8× faster on the whole corpus. The geometry is *not* parsed differently, only
  reached differently: `SVG_NUMBER` is `importPoly`'s own regex, and `PathItem.create`
  is what `importPath` calls. Verified rather than assumed — 310 pages of both
  formats, 6.8M ink pixels, zero differing pixels against the old loader.
- **Pages arrive behind whatever is on screen.** Page one is the layer the scene was
  built with; the rest are `Scene.appendPage()`, hidden. The loader used to insert
  each page *and show it*, which is why a loading flipbook visibly drew itself — and
  why it couldn't play until the last page landed. That effect is gone deliberately;
  it is what paid for the load starting to play at once.
- **Playback starts at two pages and won't lap while `loading` is set.** `scheduleFrame`
  holds the last page it has rather than looping three pages while the other forty
  arrive. So `loading` has to be cleared even when a load is abandoned — a flag left
  set behind an early return is a flipbook that plays once and stops dead. That is
  what the `finally` in `replay()` is for.

### Undo and redo

`history.ts`. Fifty steps deep, one stack for the whole flipbook, and it covers
everything: strokes, erases, moves, scales, rotations, flips, pushes, deleting a
selection, and adding, duplicating or deleting a page. What that replaces is 2013's
single snapshot, taken on mouse-down by whichever tool was about to change something
and spent by the next ⌘Z. Four things about it are load-bearing:

- **A step is a whole gesture, and the engine records it, not the tools.** Every edit
  on the canvas begins with a pointer going down on it and ends with the pointer coming
  up, so that is where the before and after are taken — `handlePointerDown` and
  `handlePointerUp`, which were already there for the thumbnails. The transform tool
  never took a snapshot at all, which is why moving something used to be permanent; it
  is undoable now without a line in it changing. The tools' own `scene.snapshot()`
  calls are gone.
- **A page is held as a state, not a diff** — `Layer#exportJSON`, one string per page
  per step — and applying a step *swaps* that string with what is on the page, so the
  step on one stack describes the journey back and becomes the step on the other. That
  is the one-step version's trick, kept. Deltas would be smaller and would have to be
  right about every operation four tools perform; a string that is simply the page
  cannot be subtly wrong.
- **`capture` normalises hard, and that is what makes selecting free.** A selected
  stroke is physically moved into the selection layer (see `Selection`), so a page's
  contents live in two layers whenever anything is picked up — both are read, sorted by
  paper's own item ids, repainted the ink colour, set back to full opacity, and stripped
  of their names. Without every one of those, clicking on a drawing serialises
  differently from not clicking on it and each click costs a step that undoes nothing
  visible. The same normalisation is why restoring a step *deselects*: what goes back
  on the page is a drawing, with nothing held.
- **Steps are keyed by page id, and a step knows where to leave you.** Inserting a page
  renumbers every index after it, so a history holding indices starts pointing at the
  wrong pages the moment it is any use. `forward` and `back` are page ids and differ
  more often than not — undoing a blank page puts you back where you asked for it,
  redoing it puts you on the blank one — and a step that names the page it has just
  taken away simply doesn't find it, which is the signal to stand in the slot it left.

Also worth knowing:

- **Page structure lands instantly.** Undoing a delete puts the page back on one frame
  rather than replaying the 750ms throw. `animations.ts` is untouched — nothing calls
  it from here.
- **A restored page's thumbnail is drawn from `registerThumbnail`, not from a timer.**
  Its `<canvas>` doesn't exist until React renders it, and a background tab runs no
  animation frames at all — so waiting a frame or two works exactly while somebody is
  watching and fails when nobody is, and the page comes back blank.
- **`Op.index` is safe where `pageId` wouldn't be**, because the stack is spent
  last-in-first-out: when a step is applied the flipbook is in exactly the shape it was
  in when the step was recorded.
- **Deleting the only page is one step with two ops** — the page leaves and a blank one
  takes its place. Split into two steps, the first undo leaves a flipbook with no pages
  in it at all, which is a state React must never be shown. The store is written once,
  at the end of `applyStep`, for the same reason.
- **The page actions clear the selection first.** They used to hide its chrome and carry
  it across, which left strokes belonging to page A sitting in the selection layer while
  page B was active — and the next Escape pasted them onto page B. Fixed here because
  the history has to be able to say what is on a page; it is a small correctness fix
  either way.
- **Loading clears it.** The crash recovery replays into a tool that has been drawn on,
  and that history is about a flipbook that no longer exists.
- **Depth is capped twice**: `MAX_STEPS` at 50 and `BUDGET` at ~12 MB of JSON, because
  fifty copies of a dense page is the case worth guarding. `history.test.ts` covers the
  stack; the reading and writing of pages is verified in the browser, since it needs
  paper and a canvas.
- **A round trip is not bit-identical, and is stable.** A stroke put back through
  export/import renders within one device pixel of where it was drawn, with the total
  ink within 0.2% — sub-pixel anti-aliasing, measured. It settles after the first round
  trip and does not accumulate: undo/redo repeated eight times gives byte-identical
  canvases.

### Invariants

- **`SYSTEM_LAYERS === 3`, and `LEADING_SYSTEM_GROUPS === 3` with it.** paper exports
  one `<g>` per layer, and every one of the 585 archive flipbooks was written by a
  project with three scaffolding layers under the pages. Change one without the other
  and every page in the archive shifts by one, silently. `assertLeadingGroups()`
  refuses to save an export that doesn't match, and there are tests either side. Layer
  2 was the one-step undo's snapshot and is now `stagingLayer`, which the history
  serialises through — **and it has to be left empty between uses**, because
  `exportSVG` writes every layer in the project and a page's worth of ink parked there
  would be saved with the flipbook.
- **The canvas has a z-index, the page bar has a lower one, and the tools have
  neither.** The pencil and eraser in the tray are 304px-tall images anchored by their
  tips; most of each one sits *behind* the canvas and selecting a tool slides more of
  it into view. Drop either of the two out of that stacking order and enormous pencils
  appear across the drawing.
- **A selected stroke is moved into the selection layer, not flagged.** The selection
  layer draws *below* the pages, which reads correctly only because the page fades to
  20% while anything is selected. **The layer is not a page, so anything left in it
  survives a page turn** — which is why `goToPage` puts it down, and why `togglePlay`
  now does too. Playing with something in hand stood it over every frame of the
  flipbook, in blue and boxed, while the drawing changed underneath it; stopping
  dropped it onto whichever page was showing, so pressing play moved a stroke from one
  frame to another. Measured with a stroke on page one of three: every frame read 444
  ink pixels and 184 blue, blank pages included.
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
  **And `selectTool` is not held either**, though it was: drawing through a page
  animation has been allowed since 2013 and the scene is in its final shape before the
  first frame of one moves, so refusing to say *what* you are drawing with was the odd
  one out. It was worse than a no-op now that pressing a tool button also *uses* it —
  the press was refused, the hold went ahead, and the previous tool did the work. Undo and `goToPage` stay held, which is a different question: those change what
  is on the page the animation is carrying.
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

- **The engine is built asynchronously, and `paperCore` is not what the types say.**
  paper arrives by `import()` now, so `useFlipbookEngine` is an ordinary effect rather
  than a layout effect and `engine` is null for a beat after mount — both pages already
  guard on that. Two things bite here. paper's `.d.ts` declares `paper-core` with
  `export =`, so TypeScript types the dynamic import as the scope object and
  `module.PaperScope` typechecks — but it is a UMD bundle and Vite's interop puts the
  whole of it on `default`. Following the types compiles cleanly and builds a Scene
  whose `PaperScope` is undefined, which is a page that pulses for ever. And the
  failure has to be `.catch`ed rather than passed as `.then`'s second argument, or
  anything thrown while *constructing* the engine is an unhandled rejection nobody
  sees — which is exactly how the first version of this hid that bug.

### Where it differs from `time-capsule`

The port is otherwise faithful, so a difference from the 2013 code is a bug unless
it's one of these. Each is deliberate:

- **The saved thumbnail is the busiest page**, which is what 2013 meant to do. It
  counted segments by reading `.length` off a paper `Layer`, which is undefined, so
  every page scored zero and the cover was always page one.
- **A tap on the canvas puts the selection down.** `updateTransformType` claims
  everything inside the box for translate and everything within 100px of it for
  rotate, so a tap almost anywhere near your work used to grab a handle, rotate by
  zero degrees and change nothing — and the only way to deselect was to find a patch
  of canvas more than 100px clear of the selection. A press that grabbed a handle and
  moved is a transform; one that grabbed a handle and didn't is a tap, told apart by
  `TAP_SLOP` rather than by whether drag events arrived, because a finger resting on
  glass sends a few of those without going anywhere.
- **Push is a tool, not a mode of one.** It used to refuse to switch on unless
  something was already selected — `init()` returned false and the transform button
  cycled straight back — so reaching it meant selecting with the other tool first, and
  a click on empty space dropped you out of it again. It selects for itself now, the
  same way transform does: tap a stroke, tap nothing to let go, drag a marquee. What
  decides between bending and selecting is whether there are points within reach of
  the cursor, which is the same question the dots on screen are already answering.
  `onExit` is gone with the old behaviour.
- **The push dots are drawn at every width.** They were desktop-only, on the reasoning
  that a finger sits where the cursor would be and would cover them — true while the
  cursor *was* the fingertip, which is the whole thing drawing with a finger changed.
  They are the only statement the tool makes about what a drag would bend.
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
  from the keyboard. The 2013 one was three divs. It is desktop-only now.
- **Undo is fifty steps deep and covers everything**, including transforms, which 2013
  could not undo at all. See above. ⌘Z and ⇧⌘Z (and ⌘Y), plus two buttons on the phone
  layout.
- **Duplicating a page keeps hold of what was selected.** 2013 let go, and so did this
  until now: a selected stroke lives in the selection layer rather than on the page, so
  the page has to be put down before it can be copied. But duplicating is *how* you move
  something across a run of frames, and reaching for the same stroke again on every one
  of them is most of that job — so `Selection.clear()` hands back what it put down and
  `hold()` picks the same items up on the other side. Nothing is recorded: `capture`
  reads the page and the selection layer as one drawing, so a stroke in hand serialises
  exactly as it does lying down. Not in push mode, which dresses a selection its own way
  and would need re-dressing rather than restoring — and which bends a stroke where it
  lies, so there is nothing to carry.
- **The transform tool's three arrows fan out centred on it**, rather than spanning a
  quarter-turn from straight-down to flat-right — rotate down the middle, translate and
  push a corner either side. Each arrow pivots about the top of its own box, so the two
  narrower ones are inset 7px to put all three hubs on the same pixel; 2013's 15 and 10
  placed them by eye for a fan that opened to one side. **They are also controls now**,
  which is how transform and push are told apart; the picture is pixel-identical either
  way.
- **The pointer over the drawing is a ring the size of the stroke**, and the transform
  tool's four cursors are drawn rather than named. Neither existed; the second replaces
  the native cursors 2013 wrote onto the canvas.
- **You can draw on a phone.** 2013 asked `Mobile_Detect.php` and sent phones back to
  the gallery, and the revival kept that. See below.

## The create page

The one place this is deliberately no longer a port. It started as the phone layout —
the same tool laid out for a screen a third of the width and for a finger rather than a
pointer — and the desktop has since been brought up to meet it, so most of what follows
is now true at both widths and the differences are called out where they exist.

- **The canvas scales; the artwork does not.** See `Scene.pinCoordinates()` above.
- **The order of the column is 2013's**: strip, canvas, page bar, tools, save. The
  tools were turned over and stood in a floating white box along the bottom edge for a
  while, on the reasoning that the bottom of the window is where a thumb is; it went
  back because the picture the tool makes is a pencil hanging off the bottom of the
  paper with its length running up behind the drawing, and that survives being scaled
  down but not being flipped.
- **The tray is six controls at every width** — three tools, three page actions — plus
  the two halves of the transform tool's fan, which are the tool's own modes and only
  reachable while it is in hand. It ended in play and circleplay in 2013; the page bar's
  handle is both of those now, and the width popover that hung off the pencil is gone as
  well. See below for each.
- **The tools are cut off at the tray's top edge, on both layouts.** Each is a 304px
  picture anchored by its tip. On a phone the paper is 200px tall and the pencil is not
  scaled with it, so it came out of the top of the drawing and stood in the air above
  it; on a desktop the whole 304px run used to be behind 360px of canvas, until the page
  bar arrived 8px below the canvas and the two tools showed through the gap as a row of
  coloured slivers. `clip-path: inset(-20px …)` on the list cuts them along the line the
  page bar's bottom edge runs on, which is where the eye already reads them as going
  under something.
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
  round. They wrap rather than greying out at the ends, because playback loops, and
  they go altogether while it plays — stepping a page at a time is the opposite of what
  is happening, and each one stops playback to do it, so a bar still wearing them is
  offering to interrupt the thing you just started. `visibility` as well as opacity, so
  they leave the tab order rather than sitting there invisible and clickable; the arrow
  *keys* are the bar's own and are unaffected. **A tap
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
- **While a flipbook plays, the bar is a rate rather than a page indicator — at every
  length.** One step per frame the engine turns, wrapping at the end, so the handle
  slides instead of standing on each page in turn. The step is the flipbook's own: a lap
  of the bar takes as many frames as a lap of the flipbook, `TRANSIT_STEPS` of them
  spent in the tunnel, so the handle arrives back at the near end exactly as page one
  comes up and the two can't drift apart over a minute of playing. Hence dividing by
  `pages - TRANSIT_STEPS` rather than by the page count.
- **And it has a top speed: `MIN_CROSSING_FRAMES`, 23.** A two-page flipbook plays
  twelve frames a second, and a handle on the page went end to end six times a second —
  not motion, a flicker at the two ends of the bar, and the shorter the flipbook the
  worse it got. So the bar is never crossed in fewer than 23 frames, a hair under two
  seconds, and below 26 pages the flipbook simply laps underneath it however many times
  it likes. It binds under 26 and does nothing at all above, which is what makes it a
  floor rather than a threshold: the sweep either side of it is the same sweep. A drag
  is not a sweep — there the pointer is driving the pages and the handle has to say which
  one it landed on — and `aria-valuenow` is the real page throughout, sweeping or not.
  The steps are joined up by a `left` transition of exactly one frame,
  linear, off the engine's own `FPS` so it can't fall out of step: it arrives as the
  next frame is published.
- **The lap doesn't end, it goes round.** The handle's travel is the bar less its own
  width, so at either end it sits inside the bar — which leaves exactly one
  handle-width of bar past the far end, and a sweep walks into it: `TRANSIT_STEPS`
  frames in which the handle carries on out of sight while the copy a lap behind
  arrives at the near end at the same rate. `overflow: hidden` on the bar is the two
  doorways, rounded because the bar is. The sum is one handle's worth of circle on the
  bar at every position in the lap, measured — so what you watch is one shape going
  round rather than one being thrown backwards, which is what the flipbook has just
  done too. Three transit steps because that makes the two speeds nearly the same one
  (16px a frame against a page-step's 13.5) without measuring the bar to find out how
  many of its steps go into a handle. A long flipbook takes smaller steps, so the tunnel
  is faster than the bar it just came down rather than a fifth quicker — three times at
  54 pages. Spending frames in proportion to the handle's share of the bar would fix it
  and needs that measurement; what it buys is a quarter of a second, at the one moment
  in the lap when the handle is half eaten by a doorway.
- **There are three copies, keyed by lap, and none of them is ever repositioned.** The
  handle is `calc(var(--at) + var(--lap) * 100%)` and `--at` runs 0 to `100%` over a
  lap, so the copies sit a whole bar-length apart: the one on the bar, the one waiting
  behind the near door, and one a lap in front that is never visible at all. When the
  lap turns over, `--at` starts again and every copy's `--lap` goes up by one — so each
  takes on the job of the one in front and moves exactly one step to do it, and **the
  seam slides like any other frame**. The copy that mounts is a lap behind the near
  door and the one that unmounts is a lap past the far one, so neither is anything to
  look at. The first version relabelled two copies instead, which cost a frame: the
  handle reached the far door and its double reached the near one, and swapping which
  was which produced a second frame with the same picture — the handle visibly stopped
  for one frame on the way in, and only on the way in, because nothing is duplicated
  on the way out. The third copy is what the fix costs, and it earns it: without it the
  copy leaving is taken off the bar with a sliver still showing rather than sliding out
  through the door.
- **`snap` is now only a sweep cut short.** Pausing inside the tunnel leaves the handle
  off the end of the bar, and easing back onto a page from there is a swoop in through
  the far door. Nothing else in the sweep jumps.
- **`--fraction` and `--over` are set on the bar, not on the handles.** All three copies
  read the same `--at` off it, so they can't disagree about where the handle is, and
  the component sets the two numbers in one place. Verified rather than assumed: a
  custom property changed on the parent does start the child's `left` transition.
- **Nothing snaps at the loop any more, at any length.** Long flipbooks used to: the
  handle stood on the page above 24, so the tunnel's frames were frames it couldn't
  spend, and the lap ended with the jump the pages had just made. Paying for the tunnel
  out of the lap rather than on top of it is what bought the wraparound for everything —
  the cost is that during `play` the handle is never the page it is showing, which of a
  flipbook turning over twelve times a second it never usefully was.
- **The strip doesn't ease at all. Turning a page is a cut.** It used to slide from page
  to page over 0.3s, matched to the page animations' travel time — every keyframe set
  that throws a page into the next slot arrives at offset 0.35–0.4 of its 750ms, and the
  strip carries every page that *isn't* individually animated, so the two had to cover
  the same ground in the same time. But it also eased on an ordinary page turn, where
  nothing is being thrown, and half a second of the whole flipbook sliding under the
  drawing every time you step a page reads as the pages being dragged about rather than
  turned. It was already switched off under a finger on the page bar; if it was wrong
  there it was wrong everywhere. **Add and delete still animate** — those are
  `animations.ts`, on the individual page, and they are a throw rather than a step;
  verified by freezing one mid-flight, two 750ms animations and the neighbouring page
  genuinely travelling. Gone with the transition: `scrubbing` (create page → `PageStrip`,
  and `PageNav`'s `onScrubbing`) and `useSnapOnRemoval`, both of which existed only to
  switch it off.
- **Circleplay is gone, at every width and out of the codebase.** It scrubbed the
  flipbook by drawing circles with the pointer, and it was 2013's cleverest control —
  three consecutive pointer positions making a triangle whose winding gave the direction
  and whose sides gave the speed, constants and all. What killed it is that the page bar
  does the same job with a handle you can see: two scrubbers means one of them is always
  the wrong one to reach for, and the one you can't see is the wrong one. Deleted rather
  than hidden, so `PlaybackMode` is two values, `geometry.ts` has no playhead in it, the
  `.scrubbing` class and the `.scrub` overlay are out of the stylesheets, and the sprite
  offsets for its arrow are a comment in `icons.module.css`. It is not coming back; if it
  ever does, the maths is four small pure functions in the history of that file.
- **There is no width slider, at every width, and its code is gone with it.** A popover
  hanging off the pencil to set a number between one and ten was the first thing that
  could go on a phone, and once the desktop layout was down to the controls that are the
  drawing it was the first thing there too. In ten years of the original nobody has asked
  for a thicker line. What it leaves is `DEFAULT_PENCIL_WIDTH`, the three the tool has
  always started on: `PencilTool.strokeWidth` is `readonly`, `MIN_`/`MAX_PENCIL_WIDTH`
  and `engine.setPencilWidth` are gone, `pencilWidth` is out of `FlipbookState`, and the
  `[` and `]` shortcuts went with the control rather than outliving it. **It took the
  lying-down layout with it** — the slider stood up everywhere except a window too short
  to stand it up in — and the `InkCursor` ring with it: the ring is still the size of the
  mark, but the pencil is one size now, so what it says is which of the two marking tools
  is in hand.
- **On a phone the bottom of the window is a footer bar: undo and redo at one end, save
  at the other.** It was the save button alone, floating in the middle; a bar is what
  lets a second and a third control stand next to it without either looking like an
  afterthought. Fixed 8px off the bottom, because the column ends wherever the tools
  happen to end and the rest of a phone screen is air. `transform`, not `top`, does the
  fly-away when the form goes up — a box pinned by `bottom` can't use `top` without
  being stretched between the two — and the desktop's fly-away moved to `transform` with
  it, so the two differ by the direction and nothing else.
- **Undo and redo are on both layouts, in different corners, and are in the markup
  twice.** Each is a white disc exactly as tall as the save button and as wide as it is
  tall, wearing a Pecita glyph — ↺ and ↻, which that face has, set as live text for the
  same reason the wordmark is: the icon sheet is drawings of *things*, and these two
  aren't. Dimmed rather than hidden when there is nothing to spend, because which of the
  two is available changes with every stroke and a button that comes and goes under a
  resting thumb is a button pressed by accident.

  On a phone they are the left-hand end of the footer. On a desktop they are the header's
  actions slot, beside the wordmark — which on this page is `narrow`, so its right-hand
  edge is the right-hand edge of the 640px column and the discs land above the corner of
  the paper. They were phone-only at first, on the reasoning that ⌘Z is what a hand on a
  keyboard reaches for. It is, and a fifty-step history that nothing on the screen
  mentions is still a feature people find out about by accident. They are at the *top*
  because the bottom of that column is the save button's, and undo standing next to save
  is the pair you least want to confuse.

  **Two copies with `display: none` on the wrong one**, rather than one box moved: the
  two corners are in different parts of the tree — one is inside `<SiteHeader>`, the
  other is a bar pinned to the bottom of the window — and no arrangement of CSS carries a
  box between them. It costs a few elements and leaves exactly one pair in the
  accessibility tree at any width. The desktop copy is **disabled while the save form is
  up**, because the footer's copy leaves with the footer and this one has nowhere to go —
  a live undo button in the corner is otherwise the one control still able to change a
  drawing that is under the wash. `RouteShell` draws a disabled pair too, so nothing
  appears in the header at the handover.
- **The footer's ends are the paper's ends, and that needs a `max()`.** `--book-width`
  is a `min(100%, …)` and the bar is `position: fixed`, so its `100%` is the window
  where the column's is the column — upright, where the width binds, the difference
  comes out as zero and the bar ran to the edges of the screen with the paper inset by a
  gutter above it. Hence `--column-gutter`, declared on `.center` in `base.css`
  alongside `--book-width` and used as the floor. Sideways, where the height binds,
  nothing changes: "the right" is the right-hand edge of a 316px flipbook and not of an
  844px screen.
- **Held sideways, all three controls go to the right.** The left end of that band is
  where the pencil is: each tool is a 304px picture anchored by its tip, the picked-up
  one hangs 60px lower than the rest, and the tip lands squarely on an undo button
  sitting at the paper's left-hand edge. There is nothing under the page actions at the
  other end. The rule this replaces did the same thing for the save button alone, to
  keep it off the width popover — same band, same problem, one answer now instead of a
  special case. `--book-reserve` is 212 in a short window rather than 250, because what
  it used to be set from was the bottom of that popover and the popover is gone.
- **The bar comes up empty, and that is `.waiting`.** A saved flipbook arrives a page at
  a time, so until the second page lands it is a one-page flipbook — which puts the handle
  at the *right-hand* end, one page being the last page as much as the first. So the bar
  appeared wearing a handle hard right and two arrows, and a beat later playback started
  and threw the handle back across the bar. The pill itself stays, because it is holding
  its space in the column and the row below it must not move; the handle and the arrows go
  until there is a page one to stand on. Two details are load-bearing: `transition: none`
  on the handle, because the throw is set going on the render *before* the class comes off
  and a handle that merely turned visible would finish a 180ms slide in plain sight — the
  rule is written as a descendant so it outweighs `.eased` and `.stepped`; and
  `tabIndex={-1}` alongside `pointer-events: none`, because there is nothing here to take
  hold of with a finger or a tab key. Playback passes `!ready` rather than `state.loading`:
  a long flipbook goes on landing for a while after it starts playing, and by then the bar
  is telling the truth about the pages it has.
- **The page bar is on the desktop layout too, and its width there is stated rather than
  derived.** It was hidden above the breakpoint on the grounds that up there you can
  click straight onto a page thumbnail. You can, and it is still the fastest way to a
  particular page — but the strip cannot show a flipbook *playing*, and the handle
  running along the bar is the only thing on either page that says how far through you
  are while it moves. What the desktop block contains is one line: `width: 656px`. The
  canvas is pinned to 640 up here while `--book-width` stays a `min(100%, …)` derived
  from the window height, so between 561 and about 680px of height the formula answers a
  few hundred pixels while the paper above stays 640 — and a bar visibly narrower than
  the drawing is worse than no bar. 656 is 640 and the same 8px of overhang either side
  the formula means everywhere else.
- **The pointer over the drawing is a ring, or one of four shapes.** `InkCursor`, which
  reads nothing but the `Cursor` `pointer.ts` publishes and knows nothing about paper.js.

  The ring is the two tools that mark. It replaces the arrow outright, on every layout
  and for both kinds of pointer: it is the diameter of the mark about to be made — the
  pencil's width, or the eraser's bite, which is `ERASE_TOLERANCE` doubled — stated in
  project units and turned into a percentage of `.book`, which is exactly the size the
  canvas is shown at. So it needs no measuring and no JavaScript scale. Two things to
  keep straight there: a percentage *height* resolves against the height of the box, and
  this box is 16:9, so the same expression on both axes drew an ellipse nearly twice as
  wide as it was tall (`aspect-ratio: 1` instead); and there is a 6px floor, because a
  three-unit stroke on a phone is under two pixels across and a ring that small has
  stopped previewing anything and gone back to being a cursor.

  **The transform tool gets four shapes instead**, one per thing a drag would do: a
  crosshair over nothing, and a move, scale or rotate arrow over whatever the press would
  grab, the scale one turned to the axis the handle actually moves along. Those four
  statements are the ones `Selection.updateTransformType` has made since 2013 by writing
  `move`, `alias` and `nwse-resize` onto `canvas.style.cursor` — but a phone has no
  cursor to name one on, and once the cursor stopped being the fingertip the native ones
  were describing the wrong point. So they are drawn, at the point the tool is actually
  working from, and **they are what the mouse gets too**: a tool that explains itself
  differently on the two layouts is a tool you have to learn twice. The selection
  therefore no longer writes a native cursor at all, and `setCursor` is gone from it; what
  leaves that file is the fact that the answer changed, as `onGrabChanged`.

  Which is a signal rather than a read for a measured reason. paper handles a mouse move
  on the *document*, above the element this layer listens on, and pointer events fire
  ahead of the mouse events paper is listening for either way — so an affordance read at
  publish time is one event behind. Nothing notices that while the mouse is moving and
  everything notices the moment it stops: park the arrow just inside a selection after
  crossing into it and the cursor sits there saying "nothing here" until you jog it.
  `PointerLayer.onGrab` is the only subscriber, and diffs before it republishes.

  The native cursor is turned off by writing `cursor: none` on the element rather than in
  the stylesheet, because paper writes inline styles onto this canvas and an inline style
  is the only thing sure of beating one. It now covers the transform tool as well as the
  two that mark.

  There was a **loupe**: 80px, twice life size, floating above the fingertip and allowed
  to hang off the top of the paper to stay there. It went with the mode it belonged to. A
  magnifier is the answer to a mark landing under the finger making it, and the answer
  that won puts the cursor somewhere else entirely — with nothing under the finger to
  see, there is nothing to magnify.
- **Zoom is off site-wide, and on the create page the document is held still.**
  `maximum-scale=1, user-scalable=no` in the viewport tag, which Android honours and iOS
  ignores, plus `preventPinchZoom()` in `lib/zoom.ts` for Safari's gesture events.
  Double-tap zoom goes with `touch-action: manipulation` on the body; the canvas takes
  `touch-action: none`, so a stroke is never a scroll and never a pinch.

  **Cancelling the gesture events is not the whole answer, and that took a while to
  believe.** A pinch still got through occasionally, and the gap is which touches anything
  is watching: `PointerLayer` prevents the gestures it owns, but a touch that starts on a
  *control* is left alone by design — the page actions, undo, redo, save, the page bar and
  its arrows, every thumbnail in the strip, and the whole header, which is outside the
  field altogether. Two fingers landing there met nothing that objected. So the create page
  states the rule once, at the top, instead of relying on every control under it:
  `refuseMultiTouch()` cancels every multi-touch `touchmove` on the document while the tool
  is up. Nothing here scrolls, so the refusal costs nothing — which is exactly what is not
  true of the gallery, and why it isn't site-wide. Capture (`PointerLayer` stops
  propagation on its own gestures), `passive: false` (Safari makes a document `touchmove`
  passive by default), and `touchmove` rather than `touchstart` (refusing a second contact
  landing would take the click off every control for anyone already resting a finger).

  The create page goes further still, because the empty white under the tools is now
  somewhere you draw from: `useNoScrolling` puts `.locked` on the root element for as long
  as the tool is up, and `base.css` spends four properties on it, one per browser. `overflow:
  hidden` on both html and body is the ordinary one — the page has never had anything to
  scroll *to*, `--book-reserve` sees to that, but it did have the rubber band, and the
  whole drawing sliding an inch under your finger on a stroke that started near the
  bottom edge. `position: fixed` on the body is the only thing that reliably stops iOS
  scrolling the document anyway. `overscroll-behavior: none` is what takes
  pull-to-refresh off Chrome on Android, which is not a scroll and survives all of the
  above — and a pull far enough to reload the tab is the worst thing that can happen to
  an unsaved flipbook. And `touch-action: none` overrides the body's `manipulation`,
  which permits a pinch: a pinch is two contacts, and up here two contacts is a drawing
  gesture.

  **It comes off while the save form is up**, which is the one time this page has fields
  in it — a long description in a small textarea has to be pannable, and `touch-action`
  is an intersection down the ancestor chain that a descendant cannot give back. Nothing
  is lost by it: the drawing is behind the wash by then, and `beforeunload` is already
  guarding the reload.

  **The first `touchmove` of a slow drag on an iPhone is Safari's, and nothing here
  can hurry it.** It arrives only once the finger has travelled several pixels and then
  carries the whole distance at once — 10.7px against 0.3px for every event after it,
  recorded on iOS 18.7. Because slop is a fixed *distance* the delay scales inversely
  with speed, so aiming a cursor slowly is its worst case, which is exactly what this page
  asks you to do. `touch-action: none` does not turn it off, and neither does taking the
  `gesture*` listeners off the document — measured, both, and the second one is written
  up in `lib/zoom.ts` so it isn't tried again. What tracking there is afterwards is as
  fine as the hardware allows: a steady 0.3px on a 3× screen is one device pixel per
  event.

### Drawing with a finger

A finger is opaque, so the thing you are aiming at on a phone is under the thing you are
aiming with. There is no settled industry answer to that — a survey turned up four
separate families and no consensus — so rather than pick one blind, ten of them were
built behind a switch in the corner of the create page and drawn with side by side: a
follower loupe, a corner loupe, a fixed offset, a trailing steady stroke, two that
changed over on half a second of stillness, and four that moved the cursor off the
fingertip altogether. **One won, and the other nine went with the switch**, along with
`drawModes.ts` and most of what `pointer.ts` used to be. (`tc:drawMode` may still be
sitting in somebody's `localStorage`; nothing reads it.)

What is left is this. **The cursor is a thing standing on the page, and a finger anywhere
nudges it by however far the finger moved.** It never travels to the contact point —
that is the whole idea, and it has to hold from the first event of every gesture or the
cursor would jump under the hand and back — and it survives the gesture that moved it,
because a cursor you have carefully placed and then lost by lifting your finger is worse
than no cursor. So the hand and the mark are never in the same place, which is the
occlusion problem answered rather than worked around. What sets the tool *working* is a
second contact: a second finger anywhere on the page, or a tool held down in the tray by
the other hand. Either finger steers, and the cursor follows the average of whichever
contacts the browser reports as having moved.

Things worth knowing before touching anything nearby:

- **paper drives no touch on this page at all.** paper 0.12 is single-pointer by
  construction — it reads `targetTouches[0]`, has one drag in flight and no notion of a
  pointer id — so it cannot see a second contact, and it works at the *fingertip*, which
  here is neither the cursor nor anywhere on the drawing. `PointerLayer` listens in the
  **capture** phase, which runs before the canvas's own listeners and before anything can
  bubble as far as the document, calls `stopPropagation()`, and drives whichever tool is
  in hand through `engine.toolDown`/`toolDrag`/`toolUp`. It is *touch* events that are
  intercepted and not pointer events: the two are separate streams, and stopping a
  `pointerdown` does nothing at all to the `touchstart` paper is listening for.
- **The field is the whole page, not the drawing.** A cursor that is nudged rather than
  placed doesn't care where the nudge comes from, and a phone's create page is a column
  of drawing with a band of empty white under it — which is where a thumb already is, and
  which nothing else on the page wants. So the touch listeners are on `<main>`, and
  dragging down there aims exactly as dragging on the paper does. What keeps that from
  eating the rest of the page is `ownsTouch`: a touch that starts inside a `button`, `a`,
  `input`, `select`, `textarea` or `[role="slider"]` is left entirely alone, propagation
  and all, which is every control on this page and is what lets the tray's own handlers
  see a finger land on a tool while another one is aiming. A press on the tray is still
  *felt* — as the other hand, through `onToolPressed` — just not as a finger, or the same
  press would engage the tool twice and stay engaged when one of the two was released.

  The column is stretched to the bottom of the window to make that band part of it, and
  that is `html.locked #root`/`main` in `base.css` rather than a `min-height` on the
  column itself. The obvious version is wrong by exactly the height of the header: the
  column starts below it, so a column a windowful tall ends a header's worth past the
  bottom of the window — clipped, so invisible, and sixty-odd pixels of field that no
  finger can reach.
- **Two holders, and either will do.** A held tray button and a second finger are both a
  mouse button, and which one is to hand depends on how the phone is being held rather
  than on which is better. So a gesture can have *two* at once, and a release has to ask
  whether the other one is still there: letting go of the pencil while two fingers are on
  the glass must not cut the stroke off, and neither must lifting the second finger while
  the pencil is held. That question is `releaseHold`.
- **Every tool is driven from the cursor, transform included.** That falls out of the
  mechanism rather than being a decision: a button press is what selecting, marqueeing,
  moving, scaling and rotating are made of, and both holders are a button press in all
  but name. Which is also why hovering exists on a phone at all — `engine.toolHover`,
  dispatched on every move that isn't working, is what keeps the four transform cursors
  right and what puts push's dots under the cursor before you commit to bending anything.

  A **bare tap puts the selection down**. A finger that isn't engaging anything only ever
  moves the cursor, so a press that went nowhere and used no tool had no other meaning —
  and without it there was no way to let go of a selection except by doing something that
  changed the drawing. It is a tap by *duration* as well as distance, and the duration is
  the half doing the work: Safari withholds movement until the finger has travelled
  several pixels, so a small deliberate nudge reports no movement at all and is a tap by
  distance alone. It is not one by duration — aiming runs at about 9px a second.
- **The transform tool is three controls in one picture, and that is how its mode is
  switched.** The hand is the tool — press and hold it and it works at the cursor, like
  the pencil and the eraser. The two halves of the fan behind it are its two modes: tap
  the translate/rotate pair for transform, tap the push arrow for push. The fan was
  already a picture of the three things this tool does, so the groups of it are the two
  things it can *be*, and tapping one is now the whole of how you get between them.
  `setTransformMode`; `selectTool` no longer cycles, and `v` keeps the cycle because a
  key press has no second reading.

  **Each half says which of two jobs it does by being lit or not**, and that is a fourth
  thing the fan was already drawing. The *unlit* one names the other mode and switching is
  all it does — not switching *and* engaging, the way pressing a different tool does,
  because engaging push at the cursor runs its mousedown there and away from the strokes
  that means `selection.clear()`, which is the selection the press was on its way to bend.
  The *lit* one is the mode you are already in, which is the tool in hand, so it holds
  exactly as the hand does. That isn't a second reading of one press: they are two
  buttons, and which one you touched has already answered it. It matters because the
  arrows are most of what you can see of this tool — before they came apart from it,
  holding them used it — and a live control that does nothing is worse than no control.

  They had to come apart, and the two failed attempts are worth keeping written down
  because both look right. One button meant one press with two readings — the tool being
  used again, or the mode being switched — and with a finger on the page aiming, *every*
  press of a tool is also a press of it, so nothing about the press itself separates
  them. Settling it on the way up doesn't work: transform's mousedown **deselects**
  whenever it lands away from the box, so by release the selection the press was about to
  bend is already gone. Settling it before the tool acts needs a signal, and neither
  candidate survives a real phone. **Duration** fails because a deliberate press of a
  button by the other hand is slow — routinely past any threshold worth picking — and
  when it overran, the tool engaged *and* the mode didn't change, both halves failing at
  once. **Distance** fails because Safari withholds a resting finger's movement and then
  delivers ten pixels of it in a single event (see `lib/zoom.ts`), so the aiming finger
  crosses any slop on its own. Two targets need no signal.

  What that costs is nothing: pressing the hand still selects the stroke under the cursor
  exactly as it did, because that press means one thing again. `TAP_SLOP` and `TAP_TIME`
  went back to being the page tap's alone.
- **A press on the tray is otherwise unconditional**, and settled on the way back up in
  one respect only: a press that did some work was the tool being used, and a press that
  did none was an ordinary tap and picks the tool up. It cannot be decided on the press,
  because at that moment there is no way to know whether a finger is about to land on the
  page. `CreateTray` suppresses its own `onClick` for pointer-driven presses; keyboard
  activation still goes through it, told apart by `event.detail === 0`.
- **The tray's three tools are driven by touch events, not by a click and not by a
  pointer event, and that is what makes changing tool mid-gesture possible at all.** A
  tap on a tool while a finger is already on the page is a *multi-touch* gesture, and a
  browser owes it neither a `click` nor a compatibility mouse event — those are for a
  single-finger tap. So the tray was reachable only by putting the drawing hand down
  first, which is the one thing this whole mechanism exists to avoid. Two further things
  were working against it, both fixed rather than worked around: the tray inherited the
  body's `touch-action: manipulation`, so a second contact on it is a candidate pinch and
  a browser may hold the touch back while it decides (`none` now, the other half of what
  the canvas already says); and selecting a tool slides its button 50px down out from
  under the finger that pressed it, which a click — needing the press and the release on
  the same element — can lose. Touch events have neither problem: every finger fires
  them, and a touch's events all target the element it started on however far anything
  travels. `preventDefault()` on the way down is what stops the two paths both firing,
  and takes the long-press callout with it. The mouse keeps the pointer handlers, told
  apart by `pointerType`, and `setPointerCapture` for the same reason touch doesn't need
  it. Verified by withholding pointer events and synthesised clicks from touch
  altogether: the tray goes on working, and before this it did nothing at all under those
  conditions — no drawing, no switching.
- **Changing tool part-way through a gesture puts the old one down first.** `engagePress`
  disengages before it selects, because a stroke left open while the tool underneath it
  is swapped gets finished by whichever tool answers the release.
- **Interception asks which tool, and nothing about what the engine is doing.** It used
  to hand the gesture back to paper while a page animation or a load was in flight, and
  handing a gesture to paper here is wrong by construction: paper works at the fingertip,
  and the fingertip is not the cursor and is not on the drawing at all. So touching the
  canvas during the 750ms of a duplicate dropped whatever was selected — a transform
  mousedown arriving somewhere near your thumb — and a marquee dragged from there was a
  rectangle under your hand rather than around your work. Measured: a stroke drawn
  mid-animation with the cursor parked at 0.86 down the page landed at 0.03, which is
  where the finger was. And because interception is decided once, at `touchstart`, the
  gesture stayed paper's for as long as the finger stayed down — the animation ended and
  it still didn't work, which is why it read as having to lift and start again. A **load**
  is still refused, but in `engage`, so the layer keeps the gesture and the cursor goes on
  moving: a stroke laid on a page that is about to be replaced is a stroke thrown away. A
  page animation is not that — the scene is in its final shape before the first frame of
  it moves.
- **The mouse is a different question and gets a different surface.** It has a visible
  cursor, sits a pixel wide and occludes nothing, so every part of the above is about a
  problem it doesn't have — it is watched on `.book` alone, it is absolute, and it picks
  the standing cursor up and carries it rather than the two disagreeing. What it takes
  from this file is the ring and the four transform shapes. Two consequences to keep
  straight: the standing cursor is published whether anything is touching the glass or
  not and a mouse's is not, so `PointerLayer.source` decides which of the two exists —
  it starts as whatever the device leads with and flips on the first event of the other
  kind, which is what a laptop with a touchscreen needs; and the grey/black `.waiting`
  and `.inking` states are the standing cursor's alone, because they are feedback for a
  changeover you can't see and a mouse button is under your own hand.

An intercepted gesture goes through the same `handlePointerDown`/`handlePointerUp` as
an ordinary one, so it is one history step and updates its page and thumbnail the same
way. It differs in one measurable respect: a stroke includes the point the gesture
opened at, where a paper-driven one's first segment is the first `onMouseDrag` — about
7px in.

## The playback page

The same flipbook, the same page bar, and much less around it than there used to be.

- **The share links and the view count are gone, at every width.** Twitter and Facebook
  were 2013's — one of those networks no longer exists under that name and neither has
  been how anybody sends a link for a decade, and both were an intent URL wrapped round
  a page that already has a perfectly good address bar. The view count was a number
  about the flipbook that said nothing about the flipbook. The server still counts them;
  `views` is still in the API and the column is untouched.
- **The rules around the title are gone with them.** Two hairlines a title's height
  apart draw a box, and what was inside it was the one thing on the page that didn't
  need marking off — the flipbook is a sheet of paper with a shadow under it, and the
  writing below is plainly about the sheet of paper. 2013 ruled it because the page also
  carried a byline, an avatar, a view count and two share buttons. `.ruled` had no users
  left and is gone from `Tray.module.css`.
- **`PageNav` is here**, the create page's bar, at every width and full width under the
  flipbook. It is the only play button this page has: the handle is tapped to play and
  dragged to scrub, which is what took circleplay's job as well as play's. It stands 8px
  under the paper and the title's row stands 20px under it — the bar belongs to the
  flipbook, which is why it takes the paper's shadow, and a title tucked up against it
  reads as owning the bar instead.
- **There is no tray here at all any more, at any width.** It was the create page's row
  of controls carrying print, play, circleplay and the admin toggles; play became the
  handle above and circleplay was deleted, which left a full-width bar of chrome holding
  one printer icon. `PlaybackTray.tsx` is gone and `Tray.module.css` is the create page's
  alone — hence `.meta`, `.playback` and `.playbackKey` leaving it with the component.
- **Print and the admin toggles stand at the other end of the title's row.** `.info` is
  a flex row: the title, byline and description on the left, those two on the right,
  aligned to `flex-start` so print sits beside the title rather than beside the middle of
  the description. Both usually render nothing — the toggles unless you hold the admin
  token, print unless there is a pointer worth offering it to — and an empty box simply
  gives its width back to the title. The toggles stay on the page because moderation
  happens where you notice something needs it, which is looking at the thing.
- **`--book-reserve` came down twice.** 300 → 240 tall, 226 → 146 in a short window: the
  tray was 25px of icon inside 40px of padding and 15px of margin, and what replaced it
  is in the title's row, which is below the fold on this page and costs the flipbook
  nothing. Sideways the flipbook now fills the window down to the bar.

## The gallery, and the flipbooks that play in it

A card in the grid is a flipbook, and hovering one plays it: the pointer's position
across the card is the position in the flipbook, left edge the first page and right
edge the last. Clicking still goes to the playback page, which is unchanged.

The thing to understand before touching any of it is that **the gallery does not use
the drawing engine, and does not load paper.js at all.** That is not a shortcut taken
to save a download; it is what the split is for.

- **`src/flipbook/preview/` is a second renderer, and a much smaller one.**
  `FlipbookEngine` builds a paper.js project — a scene graph, a layer per page, hit
  testing, an undo history, four tools — and every part of that exists so a drawing can
  be *changed*. A card only ever shows one. What is left once you take the editing out
  is: parse the file into paths, and stroke them onto a canvas. That is three small
  files and 1.8 kB gzipped, against paper's 71.
- **What the two share is the hard part, and it was already shared.**
  `engine/formats.ts` knows the two artwork formats, the three stroke vocabularies and
  the leading-three-groups contract. It has never imported paper and every function in
  it is a pure function of a string — which is exactly why it can be read twice. If a
  fourth stroke vocabulary ever appears, that is still the one file that learns about
  it, and both renderers get it.
- **It draws the same pixels, and that is measured rather than assumed.** The same page
  rendered both ways at the same size, composited over the same white: on an archive
  flipbook (polylines) and on one saved by this tool (path data) the ink pixel counts
  are *equal* and no channel differs by more than 1. They agree because paper.js
  strokes to a 2D canvas as well — same rasteriser, same cap, join, colour and width,
  restated in the same place for the same reason. The one difference is the 2012
  format, where 152 pixels in 921,600 differ on a dense page: the engine replays those
  through the pencil, which resamples them at five-pixel spacing, and the preview draws
  the corner the file actually holds. The preview is the more faithful of the two.
- **One canvas exists at a time, because one card is under the pointer at a time.**
  `FlipbookPreview` is mounted into whichever card is hovered and nowhere else, so the
  grid never holds fifty canvases, fifty engines or fifty of anything. Everything
  underneath it is a module-level singleton: one renderer, one cache.
- **Nothing about the scrub goes through React.** A pointer moves sixty to a hundred
  and twenty times a second, and each move changes one number and at most the pixels in
  a canvas — neither of which is a thing to re-render a grid of cards for. The
  `pointermove` listener is attached to the card natively and writes a fraction to a
  ref; a rAF reads it and draws. React is told exactly once, when the first frame lands
  and the canvas can fade up over the still thumbnail underneath it.
- **The cache reports by calling a repaint, not by asking for a render.** This was a
  `useReducer` bump at first, which is the obvious way to do it and is silently wrong:
  nothing in the paint reads React state, so a render changed nothing, and a flipbook
  arrived to a canvas that never drew it. What that looks like is a card sitting on its
  thumbnail — which is also exactly what it does while loading, so it looks like a slow
  network rather than a bug. See `repaint` in `FlipbookPreview`.
- **The scrub is mapped across the flipbook's page count, not across the pages that
  have arrived.** `readArtwork` hands back the total before it builds a single page,
  because a long flipbook goes on landing for a while and a scrub that remapped itself
  under a stationary pointer would drift through the drawing on its own.
- **A fetch in flight is abandoned when the card is left; a decode already running is
  not.** Sweeping a pointer down a column would otherwise start twenty downloads nobody
  is waiting for. But once the bytes are here they are paid for, and what remains is
  arithmetic in idle slices — stopping there would throw away the download to save the
  cheap half and leave the next hover starting from nothing. Both halves are in
  `retain`, and both are covered in `cache.test.ts`.
- **Pages are built a frame at a time**, the same bargain `FlipbookEngine.replay` makes:
  the largest flipbook in the archive is nine megabytes of polyline text, and building
  all of it before showing any of it is a locked-up tab. `readArtwork` is a generator so
  the cache can drive it in slices.
- **Six flipbooks are kept, and the one on screen is never evicted.** `Path2D` is
  native and compact but it is still memory, and the archive holds flipbooks of two
  hundred pages. Six is enough that going back to a card you were just on is free,
  which is the whole of what the cache is for.
- **It is asked of the pointer, not of the device.** `event.pointerType === 'touch'`
  rather than `isTouch` — the same distinction the create page's tray makes when it
  tells a mouse apart from a finger. `isTouch` answers for the machine, including while
  somebody is using a trackpad on a laptop that has a touchscreen.

### On a finger

`useCardGesture` holds both, and the two layouts diverge on one fact: a mouse can point
at a card without committing to anything, and a finger cannot. Pointing is free and says
nothing, so a mouse plays a flipbook the moment it arrives *anywhere* on a card and
scrubs it by moving across. A finger has no move that says nothing — everything it does
to a card is a commitment, and the card is a link.

**So under a finger the card is only a link.** It doesn't scrub and it doesn't play;
every gesture is on the play button in the corner instead, where it is asked for rather
than stumbled into.

The card body did scrub under a finger for a while, and giving that up is most of what
this section is. It made every card a thing that might or might not be a link depending
on how you touched it, and holding the scroll off needed `touch-action` on the card
itself. Both are gone. What follows from that:

- **No `touch-action` on the card, and no callout suppression.** It scrolls, it taps,
  and a long press gets iOS's own open / open-in-new-tab / copy sheet — which is how a
  flipbook is opened in a new tab or has its address copied. `-webkit-touch-callout:
  none` was on the card for a while to make room for the drag, and it was the wrong
  trade: it takes all of that with it. Replacing the anchor with a div that navigates on
  click was never on either — it costs cmd-click and middle-click, the URL in the status
  bar, and a link's own name and role in the accessibility tree.
- **`user-select: none` stays**, because the one span of text in a card is its
  accessible name and nobody wants to select that.
- **The download still starts on contact** — `prefetch`, which takes no hold and so is
  deliberately *not* abandoned when the gesture ends. It is the opposite of `retain` and
  answers a different risk: a mouse sweeping the grid touches twenty cards nobody wants,
  a finger touches one, and a tap is about to open the page that needs those bytes.
- **The frame stays when the finger lifts**, where a mouse leaving puts the thumbnail
  back. This is the one place the two genuinely want different things rather than the
  same thing arrived at differently: a finger is *over* the drawing the whole time it is
  down, so the frame you were looking for is the one frame you could not see. Reverting
  on lift would mean you never got to look at it. A `pointercancel` mid-scrub does
  revert, because the gesture was taken away rather than finished.

A drag that begins and ends on the same element still produces a click, and that click
would open the flipbook you had just finished looking through. `Link` calls its `onClick`
before anything else and stands down if the event was defaulted, so `swallowClick` only
has to `preventDefault()` there to call off both the router and the anchor. It is cleared
on the next `pointerdown` as well as when spent — a click that never arrives must not be
able to eat a later tap. The card keeps that handler as a backstop even now that it
can't start a scrub, because a drag begun on the button can still be released over it.

### The play button

A disc in the card's bottom-left corner, the one control on a card that isn't the link,
and **the only way in on a finger**. It answers three gestures, all of which begin
identically — a press always starts playback, because a hold that waited for the release
would not be a hold — and none of which can be told apart before the finger comes off:

| | |
|---|---|
| **tap** | plays, and keeps playing. Tap again to pause. |
| **hold** | plays while held, pauses when let go. `HOLD_MS` (300) apart from a tap. |
| **drag** | hands the flipbook to the finger: the same scrub the mouse gets, off the same absolute position across the card. |

That is `handlePointerUp`'s whole job, and it is why nothing is decided at
`pointerdown`. Stopping in particular must not happen there: a drag beginning on the
button of a card that is already running would otherwise stop it, unmounting the preview
a few milliseconds before the drag armed and mounted it again, and the card would flash
its thumbnail in the middle of one continuous gesture.

**Stopping is a pause and never a stop.** The preview stays on the card showing the
frame it reached, and pressing play again carries on from there — the card does not fall
back to its thumbnail. Same reasoning as the frame staying after a scrub: what you
stopped to look at is the thing you want left on screen, and a thumbnail is a page nobody
chose. In the component that costs nothing at all, because *paused is simply nobody
writing*: the frame ref is written by playback and by the scrub, and stopping either one
writes nothing and repaints nothing. There is no third state.

- **It is a sibling of the `<a>`, not a child**, which is what "above the anchor" has to
  mean to be true. A button inside a link is invalid markup — interactive content can't
  nest — and iOS reads a press anywhere inside a link as a press on the link, so a
  descendant would raise the same menu. That is what the `.cell` wrapper is for, and it
  took `AdminToggles` out of the anchor with it, which was the same violation.
- **Pressed, it runs the flipbook at the engine's own `FPS`.** Twelve frames a second,
  the same speed `scheduleFrame` turns on the playback page — a flipbook that ran at a
  different rate in the grid would be a different animation. It doesn't lap while the
  artwork is still arriving, for the reason the engine doesn't.
- **A tap's playback survives the release**, which is why tap and hold are worth
  separating at all: hold-to-play alone would mean watching a flipbook from behind your
  own thumb.
- **`touch-action: none` on the button, not `pan-y`** — and this one is subtle enough to
  have shipped wrong once. Safari decides whether a gesture is a scroll from how it
  *begins*: a quick sideways flick off the button commits to us and is safe, but a
  press-and-hold leaves the question open, and the first vertical movement after that —
  however far into a scrub — hands the whole drag to the scroller and the flipbook stops
  following the finger. Which is exactly the gesture this button exists for. Declaring
  the button's touches ours outright closes it, and costs only the ability to start a
  page scroll from a 36px disc.
- **Pointer capture is taken on the way *in***, not at the slop line as a card-body drag
  would have done, because a 36px button is somewhere the finger has already left by the
  time there is anything to capture.
- **The click is answered too, and only when a pointer didn't.** Every pointer press is
  followed by a click, and acting on both would toggle twice; `byPointer` spends the
  echo. What's left is Enter or Space on a focused button, which is the only way a
  keyboard has in — hence `aria-pressed` rather than a label that lies.
- **The glyph is drawn in the component, not taken from the sprite** — a triangle, and
  two bars while it runs. The sprite hasn't got either, play having gone with the tray,
  and shouldn't: that sheet is hand-drawn pictures of *things*, and these are geometric
  primitives. They belong with the ↺ and ↻ on the create page. Both are centred on the
  12×12 box by their own geometry rather than nudged by CSS, so there is no per-state
  rule to keep in step with the markup.
- **A paused card stops the preview following any finger.** `Hover.scrubbing` is what
  says a touch is entitled to move the frame, and only the drag that began on the button
  sets it. Without it the preview — which listens on the card it is mounted in, and now
  outlives the gesture that started it — would quietly bring card-body scrubbing back for
  any card showing a paused flipbook. A mouse is followed regardless: it can be over a
  card without having asked for anything, which is the whole of what hovering is.
- **Playback owns the frame while it runs, and the pointer doesn't argue.** `track`
  stands down while `playing`. Otherwise the two write to `follow` in turn — the timer
  clearing it twelve times a second, a mouse moving over a playing card setting it again
  — and the canvas alternates between the frame playback reached and the frame under the
  cursor. Pause, or leave and come back, and the pointer has it again.
- **It is hidden until wanted, but only where there is a hover to want it with.** On a
  mouse it fades in with the card, like the admin toggles in the opposite corner and for
  the same reason — the grid is fifty drawings, and a control parked on every one is
  fifty white discs before it is anything useful. Under `@media (hover: none)` it is
  simply always there, which is also the layout where it matters most, being the only way
  in a finger has. Hidden by `opacity`, never `display` or `visibility`, so it keeps its
  place in the tab order: a keyboard hovers nothing and would otherwise never reach it.
- **Keyboard focus reveals it too**, anywhere in the card — the button or the link beside
  it. A control that only appeared once you had already tabbed *to* it is one nobody
  knows to go looking for.

**The focus ring is `:has(:focus-visible)`, not `:focus-within`.** That is what it was,
and it was wrong in a way only a mouse notices: `:focus-within` matches however the focus
arrived, so *clicking* the play button drew a blue ring round the whole flipbook.
`:focus-visible` is the browser's own judgement on that — a button gets it from the
keyboard and not from a click — and `:has` carries the judgement out to `.cell`, which is
the box that can draw the ring without `overflow: hidden` clipping it. Verified both
ways round with real input rather than synthetic events, which is the only way to test
it: a dispatched `focus()` or a synthesised Tab poisons the browser's input-modality
heuristic and makes a mouse click look like a keyboard one.

Verified on the iOS Simulator against real Safari rather than reasoned about: a tap
plays and goes on playing, a second tap pauses it *on its frame*, a hold plays and
releasing pauses it on its frame, pressing play again carries on from there, a **hold
followed by a wandering drag** scrubs without the page scrolling out from under it, a
sideways drag on the card body does nothing at all, a vertical drag anywhere scrolls the
grid, and a long press on the card gets Safari's own menu back.
- **There is no hover-intent delay**, deliberately. The guard against a pointer sweeping
  the grid isn't to hesitate before every card, which everyone pays for on every hover
  — it is that letting go abandons the download.
- **The card's listing row carries `format` and `data_url` now.** Without them the
  hover would have to fetch the flipbook's metadata before it could start fetching the
  artwork, which is a round trip in front of every first hover. Extra fields are
  harmless to `time-capsule`, which reads the ones it knows.
- **The canvas lies over the PNG thumbnail rather than replacing it.** A canvas is
  transparent until something is drawn on it, so swapping them would put a frame of
  empty white card in the one moment the card is being looked at. It fades up when it
  has something to show; leaving the card takes it away and the thumbnail is simply
  there again.

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
  tray and the page bar are near enough one layout at every width, and what their desktop
  block holds is the one thing that genuinely differs — the bar's stated 656px.
- **`.center` carries two custom properties, and both are there because something
  outside the column needs them.** `--book-width` is the one the page bar is sized off,
  so the bar and the drawing are resolved against the same box; `--column-gutter` is the
  air either side, and it exists because the create page's footer is `position: fixed`
  and so measures `100%` against the window. Both are declared on `.center` rather than
  `:root`, because a `var()` inside a custom property is substituted where the property
  is *declared* and `--book-reserve` is set below that, per page.
- **There is one shadow and one radius, and every flipbook takes both.** A gallery card,
  the flipbook on the playback page, the canvas you draw on and the page thumbnails
  either side of it are all the same object, so they all take `--shadow-card` and
  `--radius-card`; the page bar under the canvas takes the shadow too, because a control
  lying flat under paper that is lifted off the page separates two things meant to be
  read together. The strip used to be the exception, with `--shadow-page` — wide, offset
  straight down, no blur — and square corners, which is 2013's "a sheet lying on the one
  behind it". But a thumbnail there is a full-size copy of the drawing standing directly
  behind the drawing, and lighting the two differently is what made the strip read as a
  separate object sliding under the canvas. `--shadow-page` had no users left and is
  gone from `base.css`. The canvas's own radius was 2px, from before the gallery cards
  were rounded.
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
- **Pecita signs the three buttons that are about making a flipbook**: create on the
  gallery, save on the create page, and undo and redo beside them. All three are set at
  30px, because Pecita runs small — a handwriting face with a shallow x-height, which at
  a UI size reads as a caption rather than a label. The create button's label was Inter
  at 16/500 until it was the last thing on that button not in the same hand as the
  writing-hand dingbat next to it.
- **Pecita doesn't centre itself, and every one of those needs a measured offset.** Its
  ascent and descent are lopsided against where the letters actually sit, so centring the
  text box leaves the word high — at 30px it reports an ascent of 20 and a descent of 10,
  putting the box centre 5px above the baseline, while a word with no descender runs
  16.5px up from it and none below and so has its own centre 8.25px up. 3.25px of drift,
  against Inter's 0.13. So "Save" and "New" both carry `top: 3px`, and the ↺/↻ glyphs
  carry 1px, which is smaller because a ring has no baseline to speak of.

  **The create button's dingbat carries none, and used to carry 2px.** That 2px was
  measured against an Inter label sitting differently in the row; with both in Pecita at
  the same size, the glyph's own ink centres itself to within 0.16px — and it puts the
  hand's writing line on the label's baseline, so the hand is drawing on the line the
  word is written on. Measure with `measureText` and `actualBoundingBox*` against
  `fontBoundingBox*`; don't guess, and don't carry a number over from a different pairing.

## Data

One table, `flipbooks`. See `db/schema.sql` — it is commented.

**Artwork is stored compressed twice and decompressed never.** `data_gz` is gzip at
level 9, `data_br` is brotli at quality 11, and `sendFlipbookData` hands back whichever
the client's `Accept-Encoding` asked for — brotli first, gzip if it won't take brotli
or if the row hasn't got one, and a `gunzip` only for the rare client that advertises
neither.

- **Brotli is 18 MB where gzip is 62.** Not the 15–20% it usually saves over gzip on
  text, and the reason is worth knowing before anyone decides one copy is enough: a
  flipbook is the same drawing forty times over, so almost all of the redundancy in
  the file is *between* pages. DEFLATE's 32 KB window can never see two pages of a
  nine-megabyte file at once; brotli's reaches 16 MB. The biggest flipbook in the
  archive is 4.1 MB of gzip and 232 KB of brotli. Nothing about the artwork changes —
  it is the same bytes, packed better.
- **Both are kept because `time-capsule` reads `data_gz` and knows nothing else.**
  `data_br` is nullable for the same reason: a flipbook saved on that branch simply
  arrives without one and is served as gzip. That is the fallback working, not a gap.
- **`npm run db:backfill-brotli` fills in whatever is outstanding**, is safe to
  re-run, and is what to run after an archive import — which deliberately nulls
  `data_br` on the rows it replaces rather than leaving a brotli copy of artwork that
  is no longer there. Getting that wrong would serve one drawing to everyone who takes
  brotli and a different one to everyone who doesn't, which is invisible from either
  side.
- **A brotli copy is only written when it is smaller.** On the very smallest rows it
  isn't, and those keep `data_br` null on purpose.

There are **two artwork formats** and both are still live:

- `svg` — paper.js `exportSVG()` output. Everything from 2013 onward.
- `legacy-json` — paper.js layer/segment JSON, the 2012 format; 147 of the archive
  pieces. There are no paths in it, only point lists, so it's replayed stroke by
  stroke through the pencil — a 2012 flipbook is genuinely redrawn rather than
  imported. It used to be redrawn *in front of you*, and isn't any more: see
  **Loading a saved flipbook** below.

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
- **A save now compresses twice, and brotli at quality 11 is the slow one.** The two run
  in parallel and the reader is waiting on the response for their permalink, so if
  saving ever feels slow on a large flipbook that is where to look — `brotli()` in
  `lib/flipbooks.js`. Quality 11 is deliberate: it is paid once for bytes that are then
  immutable and CDN-cached forever, and every reader of that flipbook gets the benefit.
  Dropping to 9 or 10 would be the first thing to try, not dropping the column.
- **Hovering a card downloads a whole flipbook.** That is the design and brotli is what
  makes it reasonable — median 45 KB across the first Featured page, worst 288 KB — but
  it is a real request per card hovered, and the archive's largest are still hundreds of
  kilobytes. Preloading a page of cards rather than waiting for the pointer is now
  arguably affordable (1.75 MB for all 24) and was not before; it is deliberately not
  done, because most of a grid is never hovered.
- **New flipbooks are public immediately and there is no rate limiting.** Deliberate,
  matching the original. `lib/router.js` `saveFlipbook()` is where a throttle would go.
- **No accounts.** Everything saves anonymously. The 2013 draft button is gone with
  them — a draft you can't come back to isn't a draft.
- **The gallery uses keyset pagination, not OFFSET.** With an infinite scroll and
  OFFSET, one flipbook saved mid-scroll shifts every later row down and the reader
  sees a duplicate.
- **A tab switch aborts the fetch in flight.** Otherwise a page of Featured results
  lands in a freshly emptied All grid and the two lists get spliced together.
- **The gallery's skeleton is twenty cards against a grid one to four columns wide.**
  `auto-fill` at a 320px minimum inside a 1440px maximum can't produce any other count,
  and a placeholder that stops halfway along a row reads as a page that has finished
  arriving badly — so the count wants to divide by all four. Twenty divides by three of
  them; at three columns it is six rows and a pair. That is a knowing trade for filling
  a tall window, and 12 and 24 are the neighbouring numbers that come out even if it
  ever stops being worth it. The stagger is set from the count and not the other way
  round: the twenty of them spread over ~760ms of a 1400ms swing, so the far end of the
  grid is always going the same way as the near end and never quite with it — at the
  old 70ms step twenty cards reach 1330ms and the last is back in phase with the first,
  which is no wave at all. `useGallery` starts `loading` at `true` rather than `false`:
  the first page is asked for in an effect, which runs *after* the first paint, so the
  alternative is a frame of "Nothing here yet." before the skeleton appears.

- **There is no boot spinner. The Suspense fallback is the page.** `RouteShell` draws
  the route's real header and the same placeholder that route uses — a pulsing sheet
  for create and playback, the twenty-card grid for the gallery — so the wait for a
  route's chunk looks like the wait for its contents, and nothing moves at the
  handover. Verified rather than assumed: the frame of the click and the frame the page
  lands both put `.book` at exactly `[105, 130, 640, 360]` on a desktop and
  `[16, 84, 343, 193]` on a phone, on both pages. It lives in the **entry bundle**,
  which is the constraint that shapes it — it may not import anything a route is lazy
  about, or it would be waiting on the download it exists to cover. That is also why it
  applies the *pages'* own CSS modules rather than carrying copies: `--book-reserve` is
  318px on create, 240px on playback and different again in a short window, and a
  hand-written approximation would be the wrong size in three layouts and drift from
  there. It is why the create shell also draws a disabled undo/redo pair out of
  `CreatePage.module.css` — those are in the header on a desktop, and a header that
  gains two buttons at the handover is exactly the move this exists to prevent. Applying
  another module's class to your own markup is not the cross-module *selector* the rest
  of the tree avoids. Cost: those stylesheets move into the entry, so every route carries
  ~4 kB gzipped for layouts it isn't.

- **A flipbook loads behind the gallery's placeholder, not behind a blue screen.** The
  playback page used to put a spinner on `rgba(74, 125, 244, 0.95)` over the canvas,
  which hid the flipbook behind a different thing rather than standing in for it; it is
  now `.skeleton` in `FlipbookCanvas.module.css`, the same white-fading-to-`--page`
  swing as a gallery card. The two are the same object at either end of a tap. It sits
  *over* the canvas rather than instead of it, because the canvas is live from the first
  frame — page one is drawn into it while the placeholder is still up. The blue is still
  what a save in flight puts over the drawing; that is `.overlay` and `.wash`, and only
  the create page uses them now.

- **The placeholder is a white card fading out and back, not a grey one lighting up,
  and that is why it needs a shadow.** It was #e6e6e6 → white: a wide swing that
  *starts* dark, so switching Featured for All swapped a grid of white cards for a grid
  of grey ones on one frame and the page flashed. Starting where the cards already are
  makes the swap a drawing leaving rather than the page changing colour. What that costs
  is depth — white to `--page` is 14 levels where the old swing was 25, because that is
  the entire distance between a card and the page behind it — and at that range a
  shadowless rectangle is invisible. So the placeholder now carries `--shadow-card`,
  reversing the note that used to be in `GalleryPage.module.css`. Two consequences to
  keep straight: it fades to an opaque `--page` rather than fading *out*, because the
  same rule covers the flipbook placeholder, which lies over a white canvas where an
  opacity fade would do nothing; and the shadow is a separate `.sheet` class applied
  only by `RouteShell`, because on the playback page the canvas underneath is already
  casting it and two coincident shadows are darker than one.
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

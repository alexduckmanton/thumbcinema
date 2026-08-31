# The drawing tool

The paper.js engine under the create page: the 0.8 → 0.12 upgrade, how artwork is
loaded and rearranged, undo and the clipboard, and the invariants that must not be
broken. `src/flipbook/engine/`, which imports no React.

See also [`create-page.md`](create-page.md) for the page around it and
[`drawing-modes.md`](drawing-modes.md) for how a finger drives it.

## paper.js 0.12, not 0.8

Upgrading skipped four years of breaking changes. The ones that bit, all of them
documented at the point they matter:

- **`flatten()` changed meaning.** In 0.8 the argument was a distance and it laid
  points down at that spacing; in 0.12 it's a maximum error, and on a polyline —
  which is what a hand-drawn stroke is — it does nothing at all. Resampling is now
  `resamplePolyline()` in `geometry.ts`, which reproduces 0.8's arithmetic and is
  unit-tested. It's load-bearing twice over: it's most of why saved SVG compresses to
  ~25%, and the push tool assumes evenly spaced points.
- **`view.update()` only draws when something changed**, and paper redraws on its own
  every frame. So `scene.redraw()` is only needed before reading pixels back — the saved
  cover, `toDataURL` — not after every change.
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

## The project is the flipbook's own size whatever the canvas is shown at

`Scene.pinCoordinates()`, and it is the one thing to understand before touching how
the canvas is sized. paper takes the project's coordinate space from the element's
*bounding rectangle*, so a canvas displayed 350px wide on a phone gave a project 350
units wide and everything drawn on it — strokes, the saved cover, the saved SVG — came out
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


## Two page shapes

There are two, and there will only ever be two:

| | | |
|---|---|---|
| `LEGACY_PAGE_SIZE` | 640×360 | 2012–2026, and the whole archive |
| `SQUARE_PAGE_SIZE` | 640×640 | everything drawn since |

A flipbook keeps the shape it was drawn at permanently. **A remix of a 16:9 flipbook is
16:9** — opening one in the drawing tool restates the scene's coordinate space from the
file, because the coordinates being imported are in the file's own space and nothing else
would make them land where they were drawn. Nobody picks a shape and there is no UI for
it; the shape describes the flipbook rather than configuring it.

**640 across for both is load-bearing, not a coincidence.** `DEFAULT_STROKE_WIDTH`,
`FLATTEN_DISTANCE`, the ink cursor's radii and the push tool's reach are all in project
units and were all calibrated against a 640-unit width. A 360×360 page would have made every
one of them twice as coarse without anyone editing a line. `InkCursor` and the desktop
`--book-width` cap both state that assumption where they rely
on it.

### Where the answer comes from

**The artwork, always.** `pageSizeFromSvg()` reads the root `viewBox`, and **a file with
no viewBox is 640×360** — which is not a fallback so much as a fact: paper 0.8 wrote no
viewBox, no width and no height, so all 585 archive flipbooks are silent and all of them
are that shape. paper 0.12 states all three.

`lib/thumbnail.js` holds the server's copy, `pageSize()`, and the two **must agree byte
for byte**. The server's answer goes into the `width`/`height` columns, which is what a
gallery card is laid out as; the client's is what the drawing on that card is scaled by.
Disagreeing means a tile of one shape holding a picture of another.

The columns exist for one reason: the grid needs a shape *before* the artwork, and a card
is a rectangle in a list long before anybody hovers it. Reading the answer off the file
would mean decompressing megabytes per tile. Where the two could ever disagree the file
wins — see `FlipbookEngine.loadSvg`, which resizes the scene off the file regardless of
what the row claimed.

### The beat where it isn't known yet

`FlipbookState.page` is `null` until the shape is genuinely known, and that nullability is
deliberate. The scene has to be built with *some* size the moment the canvas is in the
DOM, and a page opened to show somebody else's flipbook cannot know which shape until the
file lands — so a non-null default would be the engine asserting a guess over the row's
own answer, which the playback page has had since its first fetch. A page that knows what
it is opening says so at construction (`EngineOptions.page`, which the create page passes);
one that doesn't waits to be told by `loadSvg`.

`RouteShell` is the one place that genuinely has to guess, because it stands in front of a
route that hasn't downloaded. It guesses per route: square for create (a blank flipbook),
legacy for playback (every flipbook that already exists). Both self-correct, and being
wrong costs one reflow on a page that is still mostly placeholder.

## Loading a saved flipbook

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
- **Loading no longer has to paint anything twice, and that is a saving worth noting.**
  While the create page had a strip, every page of a load also owed a *thumbnail* — and a
  thumbnail was a copy of the live canvas, so a page built behind what is on screen had to
  be shown, read and handed back to get one. That was one extra `view.update()` per page of
  every load, plus a whole mechanism (`owedThumbnails`, `registerThumbnail`,
  `redrawThumbnails`) to pay for pages whose canvas React had not rendered yet. All of it
  went with the strip. A load is now the pages and nothing else.
- **Playback starts at two pages and won't lap while `loading` is set.** `scheduleFrame`
  holds the last page it has rather than looping three pages while the other forty
  arrive. So `loading` has to be cleared even when a load is abandoned — a flag left
  set behind an early return is a flipbook that plays once and stops dead. That is
  what the `finally` in `replay()` is for.

## Rearranging pages, and the gesture that used to do it

`Scene.movePage` is two lines: `insertAbove` the layer the page is going next to, and hand
paper's active layer back. `FlipbookEngine.movePage` wraps it in a `move` history op — the
one op that carries no ink, because reordering changes nothing about any page's drawing —
and `beginReorder`/`endReorder` hold the tools for the length of it. All of that is still
here and still tested.

**What is gone is the control.** There was a tab on the top edge of the paper: drag it left
or right and the drawing went with the pointer, hold it out to one side and the rest of the
flipbook came past underneath, let go and the sheet slid home to a page bar that had already
arrived. `usePageReorder`, `engine/reorder.ts` and `PageHandle` were the gesture, the
arithmetic and the tab, and they are out of the tree.

It was built when the create page was a *column*: a strip of full-size thumbnails either
side of the drawing, laid out at a measured pitch, and the drag was that row told to stand
somewhere else for a moment. The strip went first (`docs/create-page.md` says why) and the
gesture was kept, reading on the page bar's handle instead. Once the page bar was the whole
of page navigation, a tab hanging in the air above the sheet was a control belonging to a
layout that no longer existed — the one thing on the page that moved the drawing, in a
layout where nothing else does.

**There is no way to reorder pages from the UI today, and there is meant to be one again.**
Whatever it is will call `FlipbookEngine.movePage`, which is why the engine's half stayed.
`git log` has the gesture if any of it is worth having back; three things in it were dearly
bought and would be again:

- **Nothing moves in the scene until the gesture ends.** The whole drag was the drawing
  standing somewhere it doesn't belong, and `movePage` was called once, at the landing. So a
  drag that wandered across the flipbook and came back cost nothing — no history step, and
  no frame in which the flipbook was in a shape nobody asked for.
- **The handover at the end was a frame in which nothing moved.** The destination was held
  on the slot the page came *out* of and the page was drawn away from it by a transform; at
  the release the destination moved and the offset went to zero, so by the time `movePage`
  ran the array spliced and no element moved.
- **Moving a layer hands paper's active layer to a sibling.** `insertAbove` on a layer
  already in the project is a remove and a re-insert, and paper's `_remove` reassigns
  `project._activeLayer` when the layer it points at goes. `Scene.movePage` hands it
  straight back — without that, the next stroke lands on whichever page happened to be next
  door. That one is not history: it is in the code now.
- **The reference layer is read in the old numbering, and the two directions differ by
  one.** `insertAbove` removes this layer *before* it reads the reference's index, so what
  it inserts above is the reference's position in the gap-closed array — which is exactly
  `splice` out, `splice` in. Dragging a page forwards passes over the page it is displacing
  and dragging it back does not, which is the whole of `to < from ? to - 1 : to`. Page zero
  goes above the last of the system layers, as `insertPageAt` does. Also in the code now.


## Undo and redo

`history.ts`. Fifty steps deep, one stack for the whole flipbook, and it covers
everything: strokes, erases, moves, scales, rotations, flips, pushes, deleting a
selection, adding, duplicating, reordering or deleting a page, and the trace photo — taken,
moved, replaced or removed. That last one rides along in `Step.trace` rather than in an op,
because it is not ink; see **Tracing over a photograph** in [`create-page.md`](create-page.md). What that replaces is 2013's
single snapshot, taken on mouse-down by whichever tool was about to change something
and spent by the next ⌘Z. Four things about it are load-bearing:

- **A step is a whole gesture, and the engine records it, not the tools.** Every edit
  on the canvas begins with a pointer going down on it and ends with the pointer coming
  up, so that is where the before and after are taken — `handlePointerDown` and
  `handlePointerUp`, which were already there. The transform tool
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

- **Page structure lands instantly.** Undoing a delete puts the page back on one frame.
  There is nothing left to replay: the 750ms throw is gone with the strip it was written
  for, and `animations.ts` is one media query.
- **`Op.index` is safe where `pageId` wouldn't be**, because the stack is spent
  last-in-first-out: when a step is applied the flipbook is in exactly the shape it was
  in when the step was recorded. `move`'s `from` and `to` are indices for the same
  reason, and it is the one op that carries no ink at all: reordering is the only page
  operation that doesn't touch what is drawn on anything, so a state to restore would be
  fifty copies of a drawing nobody changed. `weighStep` skips it; `label()` in the test
  has to ask what kind of op it has before reading one.
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

## Copy and paste

`clipboard.ts`, and two more discs in the row undo and redo already stand in. Copy takes
what is selected; paste puts it down in the middle of the page you are on, selected, a
little way off centre. It crosses pages, it survives being pressed again, and it takes
as many strokes as you have picked up.

What it replaces is alt-drag, which is still there and is still the quickest way to
repeat something *on one page*: hold alt and drag a selection with the transform tool
and a copy is left behind. That gesture has no finger version — there is no alt to hold
— and it can't reach the next frame, which is where a flipbook wants a copy of a drawing
to go. So the clipboard is not a phone workaround for alt-drag; it does the job alt-drag
can't.

- **A paste never lands in the exact middle, and never twice in the same place.** The
  centre of the frame plus an offset of 4–10px on each axis, sign drawn separately —
  which is a *ring* around the middle rather than a square, because an offset drawn
  uniformly from ±10 is sometimes half a pixel and half a pixel is invisible. Pressing
  paste four times has to look like four drawings rather than one, and it is the offset
  that says so. `pasteCentre` is pure and unit-tested; the rest of the file needs paper
  and a project to clone into.
- **It lands selected, and that is most of how a paste announces itself.** A drawing
  that arrives lying flat in the same ink as everything around it is indistinguishable
  from one that was already there. What you want to do next is move it, which needs it
  picked up anyway.
- **Which is why pasting with the pencil in hand takes the transform tool.** A selection
  is the transform tool's state, and the selection layer is *active* while something is
  held — so a pencil stroke drawn from there would land in the selection rather than on
  the page. Pasting with a pencil in your hand and then being able to do nothing with
  what arrived is the worse of the two surprises. Push keeps push: it dresses a selection
  its own way and `init()` is what re-dresses it, exactly as it is after a page duplicate.
- **The clipboard holds clones, not references and not JSON.** Editing or deleting the
  original after copying changes nothing, and every paste clones again — five pastes are
  five drawings. JSON is what the history holds, and for a reason this hasn't got: it
  needs one comparable string per page. A clone is what a paste has to make anyway.
- **Several strokes copied together are one drawing.** The whole set moves by one delta,
  so what lands keeps its own spacing and the box round it is the box round all of it.
- **Copy is dim until something is selected and paste until something has been copied**,
  which between them are the whole of the instructions: the pair lights up in the order
  you have to press it.
- **`canCopy` is published at the end of a gesture, not as the selection changes.** A
  marquee drag empties the selection and refills it on every pointer move — a store
  write there is a React render at pointer rate, re-rendering a strip of page canvases to
  change a button from grey to black and back. `Selection.onChange` fires either way and
  `publishSelection` holds it back while the pointer is down; the end of the gesture is
  also the first moment there is a hand free to press the button with. Everything that
  isn't a gesture — undo, a page turn, a tool change, a paste — publishes immediately.
- **One step in the history, recorded the way `deleteSelection` records one.** Paste
  isn't a pointer gesture, so it takes its own before-and-after rather than riding on
  `handlePointerDown`/`Up`. Undo puts the page back without the paste on it; copy records
  nothing, because it changes nothing.
- **⌘C and ⌘V, and the default is prevented either way.** There is nothing on this page
  to copy but a drawing — the one place with text in it is the save form, and the
  shortcuts are off while that is up.
- **There is no cut and no system clipboard.** Cut is delete-then-copy and the Delete key
  already exists. The system clipboard would mean a permission prompt, a second artwork
  format to read, and an answer to what happens when somebody pastes a holiday photo.

## Invariants

- **`SYSTEM_LAYERS === 3`, and `LEADING_SYSTEM_GROUPS === 3` with it.** paper exports
  one `<g>` per layer, and every one of the 585 archive flipbooks was written by a
  project with three scaffolding layers under the pages. Change one without the other
  and every page in the archive shifts by one, silently. `assertLeadingGroups()`
  refuses to save an export that doesn't match, and there are tests either side. Layer
  2 was the one-step undo's snapshot and is now `stagingLayer`, which the history
  serialises through — **and it has to be left empty between uses**, because
  `exportSVG` writes every layer in the project and a page's worth of ink parked there
  would be saved with the flipbook.
- **The canvas has a z-index and the page bar has a lower one.** The drawing stands at 15
  and the bar at 10, so the paper's shadow falls onto the top of the bar and the two read as
  one object. What they used to be ordered against was the page strip — every thumbnail
  carried a 9 — and before that the tools — the pencil and eraser were 304px images anchored by
  their tips, most of each sitting *behind* the canvas — and dropping either out of that
  order put enormous pencils across the drawing. The tools are glyphs in a panel now; the
  numbers stayed, and what they mean changed.
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
  changes page every 83ms, and adding or removing one underneath that is a flipbook
  changing length while something else is reading it. `beginPageChange()` stops playback and returns false, so
  the press buys the pause and the next one does the work. It lives in the engine, so
  the `n` and `d` shortcuts go through it as well as the buttons. The drawing tools
  don't need it — they stop playback themselves, and nothing is animating when they do.
  **And `selectTool` is not held either**, though it was: drawing through a page
  animation has been allowed since 2013 and the scene is in its final shape before the
  first frame of one moves, so refusing to say *what* you are drawing with was the odd
  one out. It was worse than a no-op now that pressing a tool button also *uses* it —
  the press was refused, the hold went ahead, and the previous tool did the work. Undo and `goToPage` stay held, which is a different question: those change what
  is on the page the animation is carrying.
- **Never size a canvas in a ref callback.** Assigning `width` clears the bitmap, and a ref
  runs at moments that have nothing to do with the size being wrong. Anything that has to be
  sized takes it from JSX attributes, so React writes it only when it has changed. And a ref
  callback does *not* run again on a re-render — it runs when React mounts the element and
  when React replaces it, and that is all, so a canvas resized *in place* fires nothing.
  Measured on React 19.2 rather than assumed, when the page strip depended on it.

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

## Where it differs from `time-capsule`

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
- **There are no page animations any more, and most of this section is history.** Adding
  and deleting a page used to be 750ms of choreography — the old thumbnail thrown up the
  column, the new canvas flown in, every page ahead of the gap pinned by `freeze()` so the
  strip could travel out from under it. All of it was written against a strip *positioned
  by arithmetic*, and none of it survived that strip becoming a scroll container's content:
  `freeze()` pins an element to the viewport, and the viewport is exactly what the scroll
  is moving. What replaces it is one movement of the one thing that moves — `PageStrip`
  eases the scroll position to wherever the page you are left on now is. `animations.ts`
  is two constants and a media query, and says the rest. The paragraphs below are kept
  because they are what the machinery *was*, and because anything that brings paper back
  will have to answer the frozen-page problem they describe.
- **A page animation can't lock the tool up.** The page actions are held while one
  plays, and a hidden document doesn't run animations at all — so `finished` never
  settles and 2013 stays held until a reload. `play()` races it against a deadline.
  (Drawing is *not* held: you can put a stroke down mid-animation, as you could then.)
- **The engine can rearrange pages, and 2013's could not at all**: a frame drawn in the
  wrong place was redrawn somewhere else or the flipbook was rebuilt round it, and the page
  actions have only ever been able to add next to the page you are on. There is no control
  for it at the moment — the tab that was there went with the layout it belonged to. See
  **Rearranging pages** above.
- **The eraser's recursion is a loop**, with a bound.
- **The pencil-width control is a real slider** to assistive technology, and works
  from the keyboard. The 2013 one was three divs. It is desktop-only now.
- **Undo is fifty steps deep and covers everything**, including transforms, which 2013
  could not undo at all. See **Undo and redo** above. ⌘Z and ⇧⌘Z (and ⌘Y), plus two buttons on both
  layouts.
- **There is a clipboard.** Copy what is selected, turn the page, paste it: two buttons
  beside undo and redo, and ⌘C/⌘V. 2013 had alt-drag and nothing else, which is one page
  and one gesture and needs a keyboard to reach at all. See **Copy and paste** above.
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
  the gallery, and the revival kept that. See [`drawing-modes.md`](drawing-modes.md).
- **You can trace over a photograph.** A sixth disc in the phone's footer takes a picture
  with the camera and lays it over the paper at 30% to draw on top of. Wholly new, and
  wholly outside the artwork — see **Tracing over a photograph** in
  [`create-page.md`](create-page.md).

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

## The project is 640×360 whatever the canvas is shown at

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
- **Which is also why a loaded page has to be *asked* for its thumbnail.** A thumbnail
  is a copy of the live canvas — `captureActivePage` draws whatever is on screen — and
  every page of a load but the first is built behind what is on screen and never goes
  in front of it. So opening a flipbook in the drawing tool gave a strip of blank white
  sheets either side of the drawing, and each one stayed blank until you turned to it
  *and drew on it*: the capture is on the ends of a pointer gesture, and turning a page
  isn't one. `capturePage` shows the page it is copying and hands the scene straight
  back, the way `captureCover` already photographs the cover at save time — nothing is
  painted in between, because the browser paints at frame boundaries and all of it runs
  in one go. `replay` marks every page it builds as owed one and `registerThumbnail`
  pays as React hands each canvas over, which is the mechanism the history already used
  for a page it had just put back: the element doesn't exist until React renders it, and
  waiting a frame for it works exactly while somebody is watching and fails when nobody
  is. It costs one extra `view.update()` per page of a load, spread across the same
  renders the load is already causing. `owedThumbnails` is keyed by page id rather than
  index, because both the things that fill it are about to renumber the flipbook.
- **Playback starts at two pages and won't lap while `loading` is set.** `scheduleFrame`
  holds the last page it has rather than looping three pages while the other forty
  arrive. So `loading` has to be cleared even when a load is abandoned — a flag left
  set behind an early return is a flipbook that plays once and stops dead. That is
  what the `finally` in `replay()` is for.

## Rearranging pages

A tab on the top edge of the paper, dragged left or right: the drawing goes with the
pointer, the pages either side step aside to open a gap, and letting go closes the
flipbook up round it. Hold it out to one side and the rest of the flipbook comes past
underneath. `usePageReorder` is the gesture, `engine/reorder.ts` is the arithmetic under
it, `PageHandle` is the tab, and `Scene.movePage` is the two lines that actually do it.
Both layouts and both kinds of pointer, and the keyboard as well.

Nothing new was added to the flipbook to make it possible: the strip was already a row
of full-size copies of the drawing laid out at a measured pitch, and this is that row
told to stand somewhere else for a moment.

- **Nothing moves in the scene until the gesture ends.** The whole drag is the strip and
  the canvas standing in different places; `FlipbookEngine.movePage` is called once, at
  the landing. So a drag that wanders across the flipbook and comes back costs nothing —
  no history step, and no frame in which the flipbook was in a shape nobody asked for.
  It also means the *page* being dragged is never in an intermediate slot, which is what
  would otherwise have to be undone one slot at a time.
- **The handover at the end is a frame in which nothing moves, and that is the whole
  design.** Throughout the gesture the strip's row is anchored on the slot the page came
  *out* of, and the page is drawn away from it by a transform. At the release the anchor
  moves to the destination and the drawing's own offset goes back to zero — the same
  distance in opposite directions — so what you watch is the flipbook and the page it now
  contains sliding home as one thing. By the time `movePage` runs, every element is
  already standing exactly where the reordered flipbook puts it: the array is spliced,
  the row's `left` is recomputed to the number it already had, and each thumbnail swaps a
  transform for a slot at the same coordinate. Worked through in `usePageReorder`, and
  it is why `pageShift` gives the carried page an answer too even though nothing can see
  it.
- **The transitions only exist while a page is in hand.** `.carrying` on the strip and
  `.settling` on the sheet, both gone in the same render as the commit — a transition
  still on the element at that frame would be 300ms of easing a transform away to
  nothing, on top of a layout change that already happened. It is also how the strip
  keeps its rule that turning a page is a cut: it eases here and nowhere else.
- **`--settle` is one number in one place.** The settle is three transitions on three
  elements — the row's `left`, each thumbnail's `transform`, the drawing's own — plus the
  `setTimeout` that waits for them, and they compose into a single movement only for as
  long as all four agree. `SETTLE_MS` in `engine/reorder.ts` is handed to both
  stylesheets as a custom property. Under `prefers-reduced-motion` the CSS drops the
  transitions and the timeout is zero, so the landing is immediate rather than
  half-eased.
- **The offset does not go through React.** A pointer moves a hundred times a second and
  each move changes one number, so `--drag` is written straight onto `.book`; React is
  told only when the destination *slot* changes, which is a handful of times in a drag.
  Same bargain the gallery's scrub makes. React never sets that property, so a re-render
  can't clobber it — but the settle's `--drag: 0` has to be written from an effect, after
  the render that adds `.settling`, or the class and the value land together and the
  drawing snaps home instead of sliding.
- **The transform on `.book` costs a `z-index`, and the class costs less than the
  property would.** A transformed element is a stacking context painted as one thing at
  its parent's level, so `.book` would drop below the page thumbnails at 9 and take the
  canvas's own 15 with it — the drawing would slide *behind* the flipbook it is being
  dragged through. `.dragging` restates 15. It is a class rather than a permanent
  `translate3d(0,0,0)` because the same stacking context would put the save form and its
  wash under the footer, and because a transform re-bases anything `position: fixed`
  inside it. The page thumbnails' own transform is under `.carrying` for exactly that
  second reason: `freeze()` pins a thumbnail for a page animation by making it fixed, and
  a transform on every `.page` would quietly re-base every one of those.
- **The tab is above the paper, not on it, and it costs the drawing no height.** The
  whole sheet is somewhere you draw, so a control lying on it would be a hole in the
  page; the gap between the header and the top of the paper is the column's own
  padding-top and was empty. `--book-reserve` is unchanged at every width. What it costs
  instead is a press area much bigger than the tab, grown by a pseudo-element *upwards*
  into that empty band and sideways — deliberately not downwards, which is the drawing.
- **It is `z-index: 101`, one past the header**, and that is not decoration. Held
  sideways the air above the paper is 8px deep, and the header's box runs the full width
  of the window at 100: the top of the tab and most of the press area behind it are
  inside it. Nothing is painted there — the wordmark is at the other end of the row — but
  a box with no background is hit-tested exactly like one with, so at 16 the target was
  five usable pixels deep on the layout with the least room to spare.
- **The tools are held off, and by a different flag from the page actions.** `busy` is
  set for the length of the gesture, which is what holds the page buttons, undo and the
  page bar — but drawing through a page *animation* has been allowed since 2013 and
  `busy` covers those too. So `reordering` says the other thing: `pointer-events: none`
  on the canvas, because paper binds `mousedown` to that element in its own constructor
  and no state inside the engine talks it out of that; and a refusal in
  `PointerLayer.engage`, which is the finger's half. `togglePlay` is guarded by hand,
  being the one thing the page bar offers that `busy` doesn't already stop.
- **Moving a layer hands paper's active layer to a sibling.** `insertAbove` on a layer
  already in the project is a remove and a re-insert, and paper's `_remove` reassigns
  `project._activeLayer` when the layer it points at goes. Nothing has changed about
  which page is being drawn on, so `Scene.movePage` hands it straight back — without
  that, the next stroke lands on whichever page happened to be next door.
- **The reference layer is read in the old numbering, and the two directions differ by
  one.** `insertAbove` removes this layer *before* it reads the reference's index, so
  what it inserts above is the reference's position in the gap-closed array — which is
  exactly `splice` out, `splice` in. Dragging a page forwards passes over the page it is
  displacing and dragging it back does not, which is the whole of `to < from ? to - 1 :
  to`. Page zero goes above the last of the system layers, as `insertPageAt` does.
- **The keyboard gets the arrow keys, on the tab rather than beside it**, and they run
  the same settle with no drag behind them: the drawing never leaves the middle of the
  column and what moves is the page it swaps with, travelling past the canvas from one
  side to the other. Held down, the key's own repeat carries the page along a page at a
  time, which is the keyboard's version of holding it out to one side. Propagation is
  stopped as well as the default prevented — the document's own ←/→ page-turn would be
  refused anyway, `busy` being set by then, but a control that depends on being refused
  elsewhere breaks when the elsewhere changes.
- **`pages` and `step` are read once, at the press.** The flipbook can't change shape
  mid-gesture — everything that would change it is held — and a drag that recomputed its
  own pitch would be a drag that jumps if the window is resized under it.

**Hold the page out to one side and the flipbook runs underneath it.** The drag itself is
1:1 with the pointer, and the pitch on a phone is nearly the width of the window — so a
gesture on its own can reach exactly one slot in either direction, which for a long
flipbook is a lot of gestures. Holding is what reaches the rest of it: after a dwell the
book starts coming past a page at a time, faster the further out it is held, with the page
staying exactly where your hand is.

- **The page bar follows the destination, and it is the only thing that can.** Dragging
  the tab turns no pages, so `activePage` doesn't change until the gesture commits — and
  a bar that sits still through the whole of it is a bar that says nothing at the one
  moment it is most wanted. A long run carries the drawing clean off the side of the
  window, and from then on the handle is the only thing on screen saying where the page
  would land against the *whole* flipbook. So `CreatePage` hands `PageNav` the destination
  rather than the page being drawn on, and while the book is running it hands the run's
  own timing down as `--glide` too, so the handle travels with the pages instead of
  hopping a slot behind them. It reads the same value back at the commit, so the handover
  moves it by nothing.
- **It is the anchor that moves, and that is the whole mechanism.** `Reorder.anchor` is
  the slot the strip's row is lined up on — where the *flipbook* is standing, which is not
  where the page is. A tick advances it by one; `to` is measured from it, so the
  destination advances with it and the gap stays under the drawing while the row slides.
  Nothing else in the gesture knows a run is happening: `--drag` is untouched, so the page
  does not move at all, and the settle at the end is the same settle.
- **The gap and the book move at the same time, and one page moves twice as far.** The
  page being passed is both scrolling with the book and crossing the gap, which is a step
  each — so on the frame it is passed it travels two. That is correct rather than a bug
  (it is what "passing" is), and it happens under the drawing, which is where the gap is.
  What it needs is for both halves to share a curve and a duration, which is why
  `.sliding` sets the timing on the row *and* on the thumbnails.
- **The run is linear and lasts exactly as long as the gap until the next page.**
  `--slide` is both numbers, so consecutive steps join into one continuous glide instead
  of reading as a series of hops — the trick `PageNav`'s sweep already uses to turn twelve
  frames a second into a moving handle. Measured at both ends of the throttle — a ten-page
  run at full tilt and a three-page one at the slowest rate there is: no frame in which the
  row went backwards, and none in which it stood still.
- **`SLIDE_DWELL_MS` is what keeps a nudge a nudge.** Holding the page one slot over is
  also how you move it exactly one place, and that is much the commoner thing to want, so
  a gesture that goes out and comes straight back must never turn into a run.
- **How far out the page is held is the throttle, and that is measured against the window
  rather than the flipbook.** About a page a second where the run starts, five times that
  held out at the edge of the screen. "Held out at the edge" is a statement about the
  screen, and `slideReach` asks it as "how far through the travel you actually had", which
  is the same question on both layouts and needs no breakpoint to ask it: `room` is the
  distance from the press to the edge it is being dragged towards, taken once, at the
  press.
- **It was a ramp on elapsed time first, and distance is better because it goes both
  ways.** A time ramp is a control you can only push: it winds up whether you meant it to
  or not, and the only way to slow down is to let go and start again. Pull the page back
  towards the middle of the column and this eases off under it — 174ms a page at the edge,
  846ms back at 250px out — so stopping on the page you wanted is something you aim at
  rather than something you catch.
- **The curve is squared, and that is what makes the throttle legible at all.** A straight
  line was the first version of it and it was very nearly indistinguishable from having no
  throttle, for a reason that is obvious once measured: half a page out is where a hand
  rests when it has just moved the page one slot, and on a straight line from the gate to
  the window edge that is already a third open. The rate anybody actually *held* was
  therefore never the slow one. Squared keeps the whole middle of the travel at nearly the
  slow rate and spends the difference next to the edge, where there is a hard stop to aim
  at. Measured on a 1200px window at 225 / 330 / 400 / 470 / 530 / 570 / 599px out: 1.16,
  1.25, 1.44, 1.80, 2.50, 3.59, 5.8 pages a second — where the straight line gave 2.5 at
  the one-slot-out mark that matters most.
- **It is the *interval* that is interpolated, not the rate**, which bends the
  pages-per-second curve the same way again and for the same reason.
- **The rate is read once per page, as it sets off**, which is the one place this is
  deliberately a beat behind the finger — up to `SLIDE_SLOW_MS` of it. Opening the
  throttle takes effect on the page after the one in flight, because a rate changed
  mid-page would mean either a glide that stalls short of the next slot or one that jumps
  to catch up, and both are the hop the linear timing exists to avoid. Retiming the page
  in flight instead was worked through and is worse: the row would have to be advanced
  early, which drifts the gap away from the page being held.
- **`SLIDE_FULL` caps the throttle's travel at a page and a half**, which is past the
  window edge on every ordinary window and so does nothing at all on one. What it is for
  is the ultrawide, where the edge is nearly two thousand pixels from the handle and a
  throttle you have to drag a metre of desk to open is one nobody finds the top of.
- **`SLIDE_FAST_MS` is a readability floor.** Six pages a second is quick but each page is
  on screen long enough to be recognised, which is the point of running the flipbook past
  you rather than jumping to an index. An unbounded ramp ends at a page every two frames,
  which is a blur you have to stop and read afterwards.
- **The run starts a third of a page out, where the swap needs half**, and the gap between
  the two is a measurement rather than a taste. The handle starts in the middle of the
  paper and the pitch on a phone is nearly the window, so a finger has about half a page
  of travel before it runs out of glass: gating the run at half a page would mean it could
  only be started by a swipe ending on the very edge of the screen. A third is a
  comfortable swipe on both layouts — 134px of a 390px phone, tested — and it starts
  *before* anything has swapped, so a hold can begin from a drag that hasn't moved a page
  yet and walk it a slot at a time from there.
- **The clamp has half a page of overhang, and half is exactly the right amount.** A run
  ends with the anchor as far along as it can go while the page is still over a slot, and
  `Math.round` leaves that up to half a step out — so without the slack the clamp would
  tighten under a finger that hasn't moved and snatch the drawing sideways at the very end
  of a run. Proved for every displacement in `reorder.test.ts` rather than checked at one.
  What it buys as a side effect is that a page dragged past either end of the flipbook
  hangs over nothing and slides home, which is a fair picture of there being nothing there.
- **`.sliding` stays on the strip once a run has happened**, for the rest of the gesture.
  Taking the class off would take its `transition` with it, and a transition removed
  mid-flight does not stop — it finishes instantly, which is the last page of the run
  snapping into place. Nothing moves the row while the run is stopped, so a rule with
  nothing to animate costs nothing; the settle clears it in the same render that it wants
  the other curve.
- **Pulling back eases off and then stops it where it is, rather than unwinding it.** The
  run has genuinely carried the page along, so bringing it back to the middle of the column
  means "drop it here", not "undo the last four pages" — the anchor is where the page now
  lives.

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
- **The canvas has a z-index and the page bar has a lower one, and what they are ordered
  against is the page strip.** Every thumbnail in the column carries a `z-index: 9`; the
  drawing stands at 15 and the bar at 10, so the drawing is in front of the flipbook it
  belongs to and the bar passes behind the page peeking up from below. It used to be the
  tools they were ordered against — the pencil and eraser were 304px images anchored by
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
- **Never size a canvas in a ref callback.** Assigning `width` clears the bitmap, and a
  ref runs at moments that have nothing to do with the size being wrong. Page thumbnails
  take their size from JSX attributes, so React writes it only when it has changed.
- **And a ref callback does *not* run again on a re-render**, which is the other half of
  the same rule and was believed the other way round here until it was measured. It runs
  when React mounts the element and when React replaces it, and that is all — a canvas
  that is resized *in place* is the same element, so nothing fires. That is why
  `owedThumbnails` (draw it when its canvas arrives) cannot pay for a resize and
  `engine.redrawThumbnails()` exists: the strip calls it from a **layout** effect, in the
  commit that resized the canvases and before the frame it would otherwise have been seen
  in. Measured on React 19.2 by leaving every page owed a thumbnail and re-rendering the
  strip: none of them was drawn, then or on any render after it.

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
  by arithmetic*, and none of it survived that strip becoming the document's own scroll:
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
- **Pages can be rearranged.** There was no way to at all: a frame drawn in the wrong
  place was redrawn somewhere else or the flipbook was rebuilt round it, and the page
  actions have only ever been able to add next to the page you are on. The tab above the
  paper is new markup rather than a port of anything. See **Rearranging pages** above.
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

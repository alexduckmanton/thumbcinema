# Drawing with a finger

The thirteen answers to "a finger is opaque", the admin-only switch between them, and
v13 — the one the site ships. `src/flipbook/drawModes.ts`, `pointer.ts` and
`zoomStage.ts`.

A finger is opaque, so the thing you are aiming at on a phone is under the thing you are
aiming with. There is no settled industry answer to that — a survey turned up four
separate families and no consensus — so rather than pick one blind, thirteen of them are
built behind an **admin-only** switch — the last disc in the phone's row of edit actions,
wearing ⚿ — and drawn side by side: a
follower loupe, a corner loupe, a fixed offset, a trailing steady stroke, two that change
over on half a second of stillness, four that move the cursor off the fingertip
altogether, two that leave the finger where it is and magnify the drawing under it
instead, and one that is both of those last two families at once depending on where you
put your finger. `drawModes.ts` is the list and where each one comes from;
`DrawModeSwitch` is the switch; `pointer.ts` is nearly all of the mechanism, and
`zoomStage.ts` is the last three's own.

**They are numbered `v1` upwards rather than named, and the numbers are the point.**
These differ from each other by a *rule* rather than by a picture, and half of them look
identical until you touch the glass, so "the one where you hold the tool" is a slow way to
say which is which. The numbers are stable handles that survive reordering the list and
survive a different one winning; each entry keeps the name it went under while the testbed
first ran (`was`), so a note written then still resolves, and a new candidate takes the
next number rather than displacing anybody. The number leads each entry in the picker's own
list, because a mode you can't name is a mode you can't report on — there is no caption on
the page any more, the switch itself being the one place a mode is named.
They are grouped rather than ordered by history: **v1–v5 keep the finger as the pointer**,
**v6–v10 stand the cursor away from the hand** and differ only in how the tool is told to
start working, and **v11–v13 move the canvas instead of the cursor** — see below. v13 is
the one that belongs to two groups at once, being v12 on the drawing and v10 off it.

**v13 is the default and is what the site ships**, which is what `DEFAULT_DRAW_MODE` says
rather than "whichever is last in the list" — and since the switch is admin-only it is now
the only thing that decides what anybody else gets. See **v13** below for the mode itself.

**Phone only**, because the row it sits in is. Not a loss worth working around: thirteen
answers to "a finger is opaque" is a question about fingers, and a desktop has a pointer.
It used to float in the top-right corner of every layout — a corner three of these modes
like to park a magnifier in. The glyph is U+26BF ⚿, checked against Pecita's cmap rather
than assumed: the face has the squared key and not U+1F512, and a key is the honest
picture for a control you only see because you hold the token.

**The switch is gated on the admin token**, the same shared secret the gallery's
moderation toggles use and by the same one line (`isAdmin()`, `lib/admin.ts`). The other
twelve modes are a question being asked rather than a setting: a picker offering a stranger
thirteen ways to hold a pencil is a worse first thirty seconds than any of them is an
improvement, and nothing on the page says a choice exists. The gate is in **two halves and
both are needed** — `DrawModeSwitch` renders nothing, *and* `read` stops honouring what is
in storage. Hiding the control alone would strand anybody who picked a mode while holding
the token and then lost it: there would be nothing on the page saying which mode was on and
no way out of it. Ignoring storage rather than clearing it is deliberate too, so an admin
who comes back gets their choice back.

(`tc:drawMode` is where that choice is remembered, per browser rather than per flipbook. It
is the key the first testbed used and its values were names, so anything left over from then
reads as unrecognised and falls back to the default — which is the same thing that happens
to a mode that is later deleted, and is why `read` validates against the list rather than
casting.)

**v10 is described here in full** even though it no longer ships, because half of what
follows reads as branching around it and v13 is built out of it: **the cursor is a thing
standing on the page, and a finger anywhere nudges it by however far the finger moved.**
It never travels to the contact point — that is the whole idea, and it has to hold from the first event of every gesture or the
cursor would jump under the hand and back — and it survives the gesture that moved it,
because a cursor you have carefully placed and then lost by lifting your finger is worse
than no cursor. So the hand and the mark are never in the same place, which is the
occlusion problem answered rather than worked around. What sets the tool *working* is a
second contact: a second finger anywhere on the page, or a tool held down in the tray by
the other hand. Either finger steers, and the cursor follows the average of whichever
contacts the browser reports as having moved.

Things worth knowing before touching anything nearby:

- **paper drives no touch here at all**, and in nine of the thirteen modes it drives none.
  paper 0.12 is single-pointer by construction — it reads `targetTouches[0]`, has one drag
  in flight and no notion of a pointer id — so it cannot see a second contact, and it
  works at the *fingertip*, which in those six is neither the cursor nor anywhere on the
  drawing. `PointerLayer` listens in the **capture** phase, which runs before the canvas's
  own listeners and before anything can bubble as far as the document, calls
  `stopPropagation()`, and drives whichever tool is in hand through
  `engine.toolDown`/`toolDrag`/`toolUp`. It is *touch* events that are intercepted and not
  pointer events: the two are separate streams, and stopping a `pointerdown` does nothing
  at all to the `touchstart` paper is listening for. The four modes that mark at the
  fingertip need none of it — paper draws as it always has and this layer only watches, so
  that the ring and the loupe have somewhere to read the pointer from. `intercepts()` is
  the one place that question is asked.
- **The field is the whole page, not the drawing** — in the modes that nudge, which is
  what `aimsFromWholePage` answers and `ownsTouch` enforces. A cursor that is nudged
  rather than placed doesn't care where the nudge comes from, and a phone's create page is a column
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

  **The minimum is `100dvh` and has to be**, which is a lesson rather than a preference.
  It was `100%`, resolved against a `<body>` that the lock made `position: fixed` and so
  viewport-tall. When that `position: fixed` came off — for the iOS toolbar tinting, see
  the note in `base.css` — the body went back to `height: auto`, a percentage minimum
  against an auto height computes to nothing, and the column quietly stopped at its own
  content. Nothing looked wrong: the drawing, the bar and the tray were all where they
  had always been. What had gone was the empty half of the window under them, so a stroke
  started low simply never began. A viewport unit says what was meant without caring what
  the body is doing.
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
  the canvas already says); and selecting a tool slides its button 20px down out from
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
- **Interception asks which mode and which tool, and nothing about what the engine is
  doing.** It used
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
  moving: a stroke laid on a page that is about to be replaced is a stroke thrown away.
  Adding, duplicating and deleting a page are not that — they are done between one frame
  and the next, and the animations that made them a state to be in are gone.
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

## v11, v12 and v13, which move the canvas instead of the cursor

The three modes whose answer is a **layout** rather than a gesture, and the odd ones out in
every list above. All three put the drawing under the finger at up to four times life size,
so the fingertip covers proportionally less of it — the answer photo editors and CAD tools
reached for long before anybody tried a magnifier. They share `zoomStage.ts`, the section
of `PointerLayer` that owns their gestures, and the paint loop in `ZoomStage`; what differs
is whether there is an overview, whether the space around the drawing does anything — and
**what a pinch is actually holding**, which is the one thing the three do not agree about.

**v11 pinches a window; v12 and v13 pinch the paper.** v11's stage is a second canvas of
its own shape, so the only thing it can be showing is a rectangle on the page and a pinch
makes that rectangle smaller: you zoom in by cropping. The two that stand *in the paper's
own place* do the opposite and never crop at all — their window is the whole page and stays
the whole page, and what a pinch changes is how big the sheet is drawn and where its corner
sits. It grows out of its frame, over the pages either side of it in the strip, under the
page bar and the tray, and off the edges of the window; letting go of the zoom drops it
exactly home. `Viewport` is v11's state and `PageZoom` is theirs, both in `zoomStage.ts`
and both unit-tested.

### v11: two canvases

The page carries two canvases. The **paper** is the whole drawing at the
size it has always been, with a rectangle on it saying which part is magnified; you don't
draw there. The **stage** is a second canvas in the band under the tools, showing the
inside of that rectangle blown up, and it is the surface you draw on — one finger,
directly under the fingertip, which is v2's rule exactly. What answers the occlusion
problem is that the drawing is two to four times life size, so the tip covers
proportionally less of it. It is what photo editors and CAD tools reached for long before
anybody tried a magnifier.

`zoomStage.ts` is the window and the arithmetic on it, unit-tested; `ZoomStage` is the
canvas and the outline; and the gestures are `PointerLayer`'s, kept in a section of their
own because v11 shares none of the machinery the other ten do.

- **The whole of the state is four numbers**: a rectangle on the page, in the page's own
  units — so it needs telling which page, since there are two shapes and the bounds differ. The outline, the magnified copy and where a finger lands in the
  artwork are three readings of those four, so there is one thing to be right about rather
  than three.
- **The trace photograph is drawn into the stage, not laid over it.** On the paper the
  picture is a sibling of the canvas with `mix-blend-mode: multiply`, and it can be,
  because the paper *is* the whole page and a layer can simply cover it. Down here the
  stage is a window on the page, so the photo has to go through the placement and then
  through the window, with only the part inside it drawn — `paintTrace` does that with the
  same transform chain `.plate` states in CSS, in the page's own units, and clips to the
  sheet because the paper's layer is `overflow: hidden`. A DOM layer would need every one
  of those numbers anyway and would then be a second thing able to disagree with the copy
  underneath it about where the page is. `fittedSize` is the one expression both surfaces
  size the picture from; a photo that sat at one size on the paper and another in the
  stage is a photo you cannot trace. Verified rather than eyeballed: with the photo
  dragged, scaled 1.84× and turned 12.5°, fifty points sampled across the window all land
  in the part of the picture the paper's own transform puts there. The blend is the same
  arithmetic too — `(1−α)·dst + α·blend(src, dst)` is what CSS and a canvas both do — so
  the ink stays as dark as it was drawn down here as well.
- **The stage is a copy, not a second drawing.** One `drawImage` out of the live
  canvas on every frame that has something new in it — the loupe's mechanism at a larger
  size — and a finger's position handed back through the same window the other way. The
  loop runs every frame, because page turns, undo and playback all change the paper
  without a finger on the stage; what it paints is gated on `engine.draws`, a count of
  paper's own draws kept by `Scene.countDraws`, and on the window, the page and the
  photograph. Idle, the copy of a 1920² backing store sixty times a second was the one
  thing this page did with nothing happening. So there is nothing here for the save path, the
  history or the page strip to know about: a gesture that arrives from down there is one
  history step and one thumbnail, and the artwork is still its own size whatever is on
  screen.
  Copying is also what keeps it honest, because what you see is the live canvas: the
  stroke in progress, the onion skin and a selected stroke's blue are all in it without
  this code knowing any of them exist. **What it costs is sharpness at the far end of the
  zoom** — the source is the paper's backing store, 640 units across (both page shapes
  share a width) at the device's pixel ratio, so at 4× the copy magnifies about 2:1. On a phone that is a soft edge on a
  hand-drawn line.
- **Its size is measured, and its shape falls out of the measurement.** The stage takes
  what the column has left once the strip, the paper, the page bar and the tray have taken
  theirs — nothing above it moves, and `--book-reserve` is the number it always was — so
  its aspect ratio is whatever the phone leaves it, and **the rectangle takes its shape
  from the stage rather than the other way round**. Which is why the rectangle is not
  16:9 and cannot be: on a 390pt phone the band comes out about 2.2:1, so the largest
  window is the full width of the page and about two thirds of its height. That is not a
  limitation to work around — the paper above is the view that shows everything.
- **`flex: 1 1 0`, and the zero is load-bearing.** A basis of `auto` takes the item's
  content size, and the content is a canvas whose element height is its backing store —
  897px on a three-times screen — so the column grew to fit it, ran off the bottom of the
  window, and settled whenever the observer next measured the overflow.
- **The paper wears a transparent sheet, and that is what takes the presses.** Dragging
  anywhere on it moves the window, which is far more forgiving than asking anybody to hit
  a rectangle that may be 60px across, and a tap centres the window on the point tapped.
  The sheet is also the only thing that keeps paper.js out of a canvas that is no longer a
  drawing surface: paper binds `mousedown` to that element in its own constructor.
  `pointer-events: none` on the canvas was the first attempt and is wrong — it drops the
  touch through to the *page thumbnails* standing behind the drawing, which are not in
  `.book` and so are nobody's surface at all.
- **Pinch works on both canvases and reads in opposite senses, deliberately.** On the
  stage you are handling the drawing: fingers apart is a closer look, which is a smaller
  window. On the paper you are handling the rectangle: fingers apart makes the rectangle
  bigger, and the view underneath wider. Both are what the thing under your fingers would
  do if you could pick it up, which is the only test either has to pass. It is the
  *interval* that is incremental rather than measured from where the pinch began — an
  absolute pinch goes on accumulating scale against a window that has stopped at a limit,
  so the fingers have to travel all the way back before anything happens again.
- **A second finger cancels the stroke it interrupts, but only if that stroke had just
  started.** Nobody puts two fingers down at the same instant, so a pinch arrives as two
  `touchstart`s a few tens of milliseconds apart and the first has already drawn a dot;
  within `PINCH_GRACE` that dot is taken back off the page, and after it the stroke is
  somebody's work and is kept. The stroke is always *ended* and only sometimes undone.
  **And the undo has to be deferred a tick**, because `handlePointerUp` commits its
  history step on a `setTimeout(0)` of its own — an undo issued in the same turn reads
  `canUndo: false`, does nothing at all, and the mark stays.
- **A `ResizeObserver` that measures and then writes puts the red screen up.** Chrome
  reports the leftover as `ResizeObserver loop completed with undelivered notifications` —
  an `error` event with no exception behind it, harmless everywhere except this page,
  where `useCrashRecovery` listens for exactly that. The read is deferred a frame and the
  write is guarded on the numbers actually changing; both halves are needed.
- **Where there is no room, v11 is v2.** Above the breakpoint the stylesheet hides the
  stage outright — a mouse has a visible cursor a pixel wide and occludes nothing, so the
  whole mode is answering a question a desktop hasn't got — and on a phone held sideways
  the band is nothing at all. Either way the measurement comes back under
  `MIN_STAGE_HEIGHT`, `stageView()` is null, and every branch in `PointerLayer` falls back
  to marking at the fingertip on the paper. One condition, read in one place, and no media
  query written out again in JavaScript.
- **The column had to become a flex column, and only on the phone layout.** `.content` and
  `.center` distribute height so the stage can take what is left; above the breakpoint
  both go back to block flow, because a flex column doesn't collapse margins and the
  tray's 15px bottom margin and the save button's 15px top margin are a single 15px gap in
  flow and 30 in flex. Measured both ways round: with the stage up and without it, in
  three modes and on both layouts, the paper, the page bar, the tray, the strip and the
  footer are at the same pixel they were before any of this.
- **The `PointerLayer` moved out of `InkCursor`.** Two components now draw a cursor — the
  paper's and the stage's — and neither can own the object that decides what a finger
  means. `usePointerLayer` builds it and the page hands it to both; `Cursor.surface` is
  what tells them which cursor is theirs, and `--span` on the ring is how the same
  three-unit pencil draws four times the size down there, which is the truth about the
  mark it is about to make.
### v12: one canvas, which is the page

The overview taken away, and the window with it. One canvas, in the place the drawing has
always been: **two fingers pinch and pan the sheet, one finger draws on it.** At rest
nothing else about the column changes — the strip, the page bar, the tray and the footer
are at the pixel they are in every other mode, measured.

- **A pinch makes the page bigger; it does not crop it.** The sheet grows out of its frame
  and keeps growing, up to four times life size, which is the thing under your fingers
  doing what it would do if you could pick it up. What that costs is the frame's tidy
  edges: the drawing runs out over the neighbouring pages in the strip, under the page bar
  and the tray, and off the window. It is a `transform` on the stage element and nothing
  else moves — `PageZoom` is the three numbers (`scale`, and the sheet's top-left corner in
  the frame's own pixels), `zoomPage` and `panPage` are what a pinch does to them, and
  `onPage` is how a finger's position on the frame becomes a position on the paper again.
- **The frame always has drawing in it.** The offsets clamp so the sheet, however far it
  has been pinched and dragged, still covers the box the paper belongs in — so no
  arrangement of a pinch and a pan shows a strip of nothing where the page used to be, and
  at life size the offsets are pinned to zero, which is the sheet sitting exactly home.
- **The page bar and the tray lift over a pinched sheet.** They are under the paper in the
  stacking order by five and by fourteen, which is deliberate — the tray's tools are 304px
  pictures whose barrels pass up behind whatever is above them — and a sheet at 4× covers
  both outright, along with every press meant for them. So while one is pinched the two
  come over the top and the drawing goes on growing underneath them, which is what a page
  growing past its frame ought to do to the furniture around it. `.raised` in
  `PageNav.module.css` and `Tray.module.css`; `CreatePage` is what knows there is a stage
  at all, so it reads the scale and hands each of them the flag.
- **It starts at the whole page, where v11 starts at 2×.** With no second view to find
  your bearings in, arriving already magnified would be arriving somewhere you didn't ask
  to be — so until you pinch, v12 *is* v2, and the first stroke of a session lands exactly
  where a finger touched. `startingZoom` is the difference and it is the mode's answer
  rather than a constant; `defaultViewport` takes it.
- **A finger is measured against `.book` rather than against the stage.** The stage is the
  element the pinch transforms, so its rectangle grows and slides with the gesture that is
  measuring against it; `.book` is the same box at rest and never moves. `boxOf` is the one
  place that is decided, and everything downstream of it goes through `onPage` first.
- **The live canvas is still the drawing, and is hidden.** paper renders into it exactly
  as always — a hidden element still has a backing store, which is what the stage copies
  from and what the page strip photographs — so the artwork, the thumbnails, the history
  and the save know nothing about any of this. `visibility` rather than `opacity` for two
  reasons that are both the point: a hidden element is not a hit target, so paper's own
  `mousedown` on that canvas can never fire while something else drives the tools; and it
  casts no shadow, which is why the stage carries the paper's.
- **`surfaceOf` never answers `book` here**, said outright rather than left to the stage's
  box happening to cover every corner. The `book` branch drags a window this mode hasn't
  got, and a gap in the covering would find it.
- **Two fingers in one `touchstart` open a pinch directly.** A browser may report several
  contacts as changed in a single event and anything synthesising touch certainly does —
  and without this the extras were dropped, so two fingers landing together drew instead of
  pinching and nothing ever corrected it. Opening the pinch before `engage` is also what
  means there is no dot to take back off the page afterwards.
- **A trace photo is placed at 1×.** The stage and the placing layer are the same box up
  here, and the placing layer's gestures are stated in the paper's own pixels — so a sheet
  standing at some other size underneath it would have the photo moving at one rate and the
  drawing at another. `suspended` stands the sheet back in its frame for the length of the
  placement and leaves the photograph to the DOM layer, which is what every other mode
  does; the moment it settles the stage takes the photo back and the stored zoom returns.
  The two are never both drawing it.
- **Above the breakpoint it is v2**, by the same one condition v11 uses: the stylesheet
  hides the stage, the measurement comes back empty, `stageView()` is null and the live
  canvas is visible again.

Measured rather than eyeballed, in a 390×844 window with the page pinched to its ceiling:
the sheet stands at `scale(4)` and fills the window, the page bar and the tray are still on
top of it and still answer a press, a stroke drawn while it is pinched lands under the
finger to the pixel, and pinching back in returns the sheet to `translate(0, 0) scale(1)`
with the stroke a quarter of the size it was drawn — which is the same ink at life size. A
pinch that takes the fingers *through* each other ratchets against the clamp: that is the
clamp working, not a bug, and it is not a gesture a hand can make.

### v13: v12 on the drawing, v10 everywhere else

The same canvas and the same gestures on it, plus the band of white under the tools, where
a finger nudges a cursor around the page and a second one down there sets it working. So
the two families stop being rivals: **draw directly where the drawing is now big enough to
draw directly on, and reach below it for the mark that has to land where your hand already
is.** Nothing is visualised down there and nothing needs to be — the band is the empty part
of the column, it is where a thumb already rests, and the only thing that moves when you
touch it is the cursor up on the drawing. **A pinched page takes some of it back**, the
sheet growing down over the white as well as up over the strip: the band is whatever is
left of the column that the paper is not standing on. That is the honest reading rather
than a limitation — the empty part of the column is empty because the drawing is not there,
and where the drawing now is, a finger draws.

The point is that neither half answers the question on its own. Magnifying the page makes a
mark big enough to place under a fingertip, which is most of the job and is no help at all
with the mark that lands under the hand making it — the bottom edge of a stroke you are
extending, a handle on the near side of a selection. Aiming from below has nothing to say
about how big the mark is. `aimsOffStage` is the mode's whole predicate, and
`--- v13's aiming band ---` in `pointer.ts` is the mechanism.

- **The cursor belongs to the band, and touching the drawing puts it away.** It is drawn
  from the moment a finger lands below and stays where it is left; a finger on the canvas
  hides it for the whole of that gesture *and after it*, until the next touch in the band
  brings it back where it was. So the two halves read as two tools rather than as one tool
  with something flickering in it, which is what `half` is for — and it is sticky rather
  than a property of the gesture in flight, which is the whole point: a cursor drawn only
  while a band gesture was live came back at the end of every stroke made on the canvas, in
  a place the hand that drew the stroke had nothing to do with, at the exact moment you are
  looking at what you just drew. A pinch counts as touching the drawing, for the same
  reason. What it gives up is v12's ring on the stage saying how wide the mark will be —
  which said it under a fingertip, where a 6px ring is 40px of finger away from being
  visible, so there was nothing there to lose.
- **A gesture belongs to the surface it opened on, and the two never mix.** `surfaceOf`
  answers `stage` or `field` at the `touchstart` and the gesture is that for the rest of
  its life, so a finger that starts below and slides up onto the drawing is still aiming
  and a stroke that wanders off the bottom of the canvas is still a stroke. One gesture at
  a time: a finger arriving on the other surface is swallowed. What that gives up is
  drawing on the paper and aiming below it simultaneously, which is two hands doing
  different things to the same drawing and is not a thing anybody asked for; what it buys
  is that neither half has to know the other exists.
- **The cursor is kept in the page's own units, not in pixels.** v6–v10 stand theirs on a
  canvas showing the whole page, where the two are the same thing scaled; v13's stands on a
  page that is being pinched and dragged about under it. In project units the cursor stays
  on the part of the drawing it was put on when the sheet moves, and the scale decides how
  far a pixel of finger carries it — both of which are what a thing standing on the page
  would do, and neither of which survives being stored as a position on the glass.
  `stagePlace` is the inverse of `stagePoint` and is what puts it back on the glass to be
  drawn; it is unit-tested as a round trip at every zoom. It is drawn *inside* the element
  the pinch transforms, which is why it is published in the stage's own unpinched pixels
  and why the ring is the right size for the mark at every scale without arranging for it.
- **Which is also the whole of why the two halves compose.** The cursor moves 1:1 with the
  finger *on the screen* at every magnification — measured at 1× and zoomed, in both
  directions — because the sheet's scale cancels between the nudge and the drawing of it.
  In *artwork* units it therefore moves four times less at 4×, so the same comfortable drag
  places the mark four times as precisely. That falls out of holding the cursor in project
  units rather than being arranged for.
- **It is clamped to what is on screen rather than to the page.** Clamping to the page is
  more faithful to "a thing standing on the drawing" and is worse to use: a cursor you
  cannot see is one you have to go and find, and the only way to find it is to pan back.
  Being nudged along by the edge of what is showing costs nothing by comparison — it was
  going to be moved before it was next used anyway. What "showing" means is measured rather
  than reasoned about, the sheet now hanging out of its frame and mostly off the window
  with it: `visiblePage` is the overlap between the paper's rectangle and the window's, in
  project units, and `clampCursor` runs it after a pinch and after the stage is
  re-measured.
- **`onStageChanged` exists because the cursor has to be there before anything is
  touched.** The stage is measured a frame or two after the page mounts, and v13's cursor
  is published from `PointerLayer`'s store rather than the stage's — so without a
  subscription there is no cursor at all until the first finger lands. It stands down while
  a gesture is in flight, that path clamping and publishing for itself.
- **A held tray tool engages only the aiming gesture.** `holdsTool` is v8's, v10's and now
  v13's, but a stroke on the stage is the finger's own from end to end: a tool button
  pressed part-way through one must neither claim to have started it nor end it on the way
  back up, which is exactly what the release branch would otherwise do, the stroke being
  `engaged` by then either way. `holdsAtCursor` is that one extra question.
- **The mouse gets none of it.** `onStagePointerDown` refuses the `field` surface outright,
  the same stand-down the relative modes make: a mouse has its own arrow and asking
  somebody to shove a cursor about with a device that already points at things is testing a
  different idea.
- **Above the breakpoint it is v2**, by the same one condition v11 and v12 use — and with
  no stage there is no field either, because `ownsTouch` falls back to the drawing alone.

Measured on an iPhone 13: a drag in the band moves the cursor by exactly the finger's
delta and marks nothing; the cursor goes the instant a finger lands on the canvas and is
still gone after the stroke, after the release and after a pinch, and comes back on the
next touch in the band at the pixel it was parked on; it survives the lift; a second finger down there draws
(916 px) and either finger steers; a held pencil in the tray with one aiming finger draws
(2267 px); a stroke drawn entirely from the band lands 1816 px of ink; the transform tool
marqueed from the band selects (1060 blue px) and a bare tap down there puts it down again;
and on the stage a one-finger stroke and a two-finger pinch behave exactly as v12's.

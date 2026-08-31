# The create page

The layout, the rail, the page bar, tracing over a photograph, naming a flipbook, and
the playback page that shares most of it. How a finger drives the tools is its own file:
[`drawing-modes.md`](drawing-modes.md).

**The one place on the site that is deliberately no longer a port.** Everywhere else the
2026 rewrite kept 2013's design; here it was replaced. Every control is a 40×40 tile
wearing a single Pecita glyph, in a rail down the left-hand side at every width; the page
bar is the whole of page navigation; and a finger aims from a pad at the bottom of the
screen rather than from anywhere in the white. The hand-drawn tool sprite went with it.

## The layout

Four boxes and nothing else: a header carrying one button, a rail pinned to the left, the
drawing taking whatever height is left, and the page bar under it. v14 adds a fifth over
the bottom of the window — the aiming pad — which is furniture laid over the page rather
than a box in it.

- **Nothing scrolls, and everything is sized to what is left.** `html.locked` in
  `base.css` holds the document still and makes `#root` a flex column of a definite
  height with `main` taking what the header leaves; `--book-reserve` is everything in the
  window that is not the drawing, and the sheet is sized against `100svh` less that. A page
  that scrolls while you draw on it is a page that has taken the stroke away from you.
- **A square page is what makes `--book-reserve` worth getting right.** At 640 across, a
  square sheet is 640 tall where a 16:9 one was 360 — so the *height* term is what binds at
  almost every size now rather than at almost none, and an over-generous reserve that used
  to cost nothing now costs a visibly smaller drawing. The numbers are broken down in the
  stylesheet, and they are measured rather than reasoned.
- **`100svh`, never `100dvh`.** Every box here is drawn off every other one: the aiming
  pad's height is a term in `--chrome-bottom`, `--chrome-bottom` is a term in
  `--book-reserve`, and `--book-reserve` is what the drawing is sized against. A unit that
  changes when a browser slides its own chrome in or out is a drawing that resizes under
  your hand. `svh` is the small viewport and is a constant.

### There was a scrolling column of thumbnails, and there isn't now

Worth writing down, because it worked and was still the wrong answer.

The flipbook was a column of full-size page thumbnails you scrolled, with the drawing
pinned over the middle of it and `scroll-snap-type: y mandatory` making the sheet cut from
page to page rather than slide. Scrolling was the browser's, so it had momentum and the
trackpad's whole feel, and the pages either side of the drawing said where you were far
better than a bar does.

What it took to hold up:

- a scroll container, and a decision about *which* box scrolls. The document, so iOS
  Safari would collapse its URL bar — which then resized the viewport mid-fling, and a
  mandatory snap container whose height moves mid-fling stops mid-fling and jumps. Then
  back to a nested box, with the body pinned, which gave that up again.
- a `position: sticky` wrapper holding every piece of chrome, because a `position: fixed`
  element is **not** in a scroll container's chain — measured: a wheel over a fixed child
  moved the scroller 0px and over a sticky one it moved by the delta exactly — so without
  it a drag on the rail, or on the white either side of the paper, scrolled nothing.
- a snap offset measured in JavaScript, because where the drawing actually ends up is the
  one thing about that layout no stylesheet could state.
- two rules stopping the scroll and the page number from answering each other, both of
  which were bugs first: a scroll that turned the page had its momentum taken away at every
  page, and a cancelled scroll animation could leave snapping switched off for the session.
- one full-size canvas per page, at the device pixel ratio, under a memory ceiling that
  iOS enforces by *blanking* canvases rather than by failing.

The page bar does the same job in one control and 56px of height, and it can say where you
are in a 200-page flipbook, which three visible thumbnails never could. `PageStrip` and its
stylesheet are gone, and so, a round later, is the reorder gesture that used to read on the
strip and was left reading on the bar — see **The tab above the paper is gone too** below.

### The tab above the paper is gone too

The reorder gesture outlived the strip it was built for by one round. A tab on the top edge
of the paper: drag it and the drawing went with the pointer, hold it out to one side and the
flipbook came past underneath, let go and the sheet slid home. It was good, and it was a
control belonging to a layout that isn't here — the one thing on the page that moved the
drawing, hanging in the air above a sheet that now sits in a rail and a page bar and nothing
else. `usePageReorder`, `engine/reorder.ts` and `PageHandle` are out of the tree, and with
them the page bar's `--glide` and the sheet's `.dragging`/`.settling`.

**The engine's half stayed.** `FlipbookEngine.movePage`, its `move` history op and
`beginReorder`/`endReorder` are untouched and still tested: reordering pages is a thing the
flipbook can do, and what went is the one way there was of asking for it. There will be
another. `docs/drawing-tool.md` says what the gesture knew that a new one would have to know
too.

### You could draw past the edge of the page, for about a day

Also worth writing down, because it was asked for, built, used, and then didn't survive
being used.

The create page became an infinite canvas: the drawable area was `CANVAS_SCALE` times the
page in each direction with the page centred in it, the surround ran to *negative*
coordinates on both axes so the artwork's own numbers were untouched, and a crop frame said
which ink the save would keep. Ink outside the frame was deleted at save (`withoutOverspill`),
`Scene.exportRoot()` pinned the exported root to the page so a file couldn't state the
extent's shape, and `getEventPoint` scaled about the canvas's origin rather than about zero.
The whole thing worked.

What it was like to draw on is why it went: the flipbook stopped having an edge. Every mark
you made was as valid as every other and only a hairline said which ones counted, and the
thing you were making — a 640-wide page that will be played back at 640 — read as a detail
of something larger. Cropping to the sheet is what makes it a sheet.

**Pinch to zoom survived it**, and was the good half all along — but not the way it was
built. Cropping back to the page put the zoom back into a fixed box, and a magnified window
inside a rectangle that never moves is the drawing being done to rather than picked up. So
the viewport is written out as a CSS transform now and the sheet itself scales and slides,
off under the page bar and the aiming pad and the rail: `stageTransform` in `zoomStage.ts`,
`.sheet` in `ZoomStage.module.css`, and `docs/drawing-modes.md` for the whole of it. You can
go in as far as `MAX_ZOOM` and come back out to exactly the size the layout chose and no
further, because `maxWidth` is the page and `defaultViewport` opens there.

### The rail

- **Every control is a 40×40 tile wearing a single Pecita glyph**, in one column: what
  marks the page, what changes the page, what undoes it, what it is traced from, and — for
  an admin — the drawing-mode switch. Save is not in it; it is in the header, being the one
  control on this page that is not about the drawing.
- **A rail at every width**, which it was not at first. The phone had the same buttons
  lying down in a bar along the bottom. Standing them up gave the row's overflow somewhere
  sensible to go — a column that runs past the bottom of a phone is a list you scroll,
  where a row that runs off the right-hand edge is a list nobody knows is there.
- **It is `position: absolute` inside `main`, at `top: 0`.** `main` is the box that starts
  where the header ends, so the rail is flush against the header *by construction* rather
  than by arithmetic. It used to stand on a stated constant that was deliberately larger
  than the header — the air the *drawing* keeps clear — which left 45px of nothing under
  the header on a desktop and a 16px overlap on a phone.
- **On a desktop it stands beside the drawing**, 16px off its left edge, rather than pinned
  to the edge of the window: on a wide screen a column in the far corner is a toolbar in a
  different postcode from the thing it works on. What makes it fit is that the drawing is
  centred in the *window* up here and the rail's lane is taken out of the paper's width on
  **both** sides. At the narrowest desktop this layout holds, 731px, that gives a 547px
  drawing and puts the rail 20px from the left edge; without the symmetry it would have
  been at -26.
- **The bleed is what stops the shadows being clipped.** The rail scrolls when the list is
  longer than the window, and `overflow` clips a tile's shadow at the edge of the box. It
  carries 8px of padding with an equal negative margin, so the shadows have somewhere to
  land and nothing moves.
- **There are four tools, not three.** Transform's two modes used to be a fan of spokes
  behind one picture, and then two buttons indented under one tile — both of which made you
  open a thing before you could reach either half of it. They are ordinary tools now: ✥
  moves, scales and rotates, ✍ pushes the line about, and pressing either picks transform
  up in that mode. `selectTransform()` on the engine does both halves at once, because
  picking the tool up resets the mode and setting the mode is refused until the tool is up
  — either order on its own always landed on "move".
- **The hand-drawn tool sprite is gone, and that is the real cost of this.** The tools were
  304px pictures anchored by their tips, cut off at the tray's top edge so a pencil appeared
  to hang off the bottom of the paper with its length running up behind the drawing. It was
  the best thing on the old page and it could not come across: a rail 56px wide has no
  length for a pencil to run up. What carries the hand instead is the face — Pecita is the
  wordmark's, its dingbats are drawn rather than geometric, and ✎ ⌫ ✥ ✍ are the same pen as
  ↺ ↻ ↥ ↧, which were already here.
- **Which glyphs Pecita actually has decided the set**, checked against the font rather
  than guessed: it has no scissors, no overlapping sheets and no play triangle, and a glyph
  the face hasn't got falls silently through to a system font and stops looking like this
  website. Where the obvious mark is missing the tooltip and the label carry the words —
  ⊡ for duplicate is a page with its drawing still on it, which is a compromise and is worth
  knowing is one.

### The header, and Save

- **No wordmark.** It is a 70px word plus a header's worth of padding, and what it buys is
  a link home that the drawing tool has to interrupt anyway — `guardNavigation()` asks
  before it lets go of unsaved work. A square page needed the room more.
- **Save is what is left up there**, at the right-hand end. It is the gallery's create
  button seen from the other end — the two are the ends of one errand — so it is the same
  yellow at the same rounding with the same shades, which are tokens and cannot drift. Not
  the same component: that one collapses to a circle on scroll and is a link.
- **A flipbook of one page is not one you can save**, so the button is disabled and
  invisible until the second page arrives — and stays in the layout, so nothing jumps when
  it does. The boot shell draws that same empty box, and has to: `SiteHeader` drops the row
  altogether when it holds neither wordmark nor actions, and a header 68px shorter than the
  page's is a sheet of paper 34px higher up at the handover.

- **The canvas scales; the artwork does not.** See `Scene.pinCoordinates()` above.
- **The sheet casts no shadow here, and it does everywhere else.** `.flat` on the canvas.
  A gallery card, a playback page, the boot shell: there the flipbook is one object among
  others and the drop shadow is what says it is a sheet lying on the site rather than a
  hole cut in it. Here it is the only thing on a white field, with the rail down one side
  and the page bar under it, and the shadow read as a second frame inside the first. The
  rounding stays — those are the flipbook's own corners and it has them in the grid too.
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
  `--book-width` is declared on the create page's `.content` so both are sized off one formula — which
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
- **The page bar is on the desktop layout too, and there is no desktop block for it any
  more.** It was hidden above the breakpoint on the grounds that up there you could click
  straight onto a page thumbnail; then the thumbnails went, and it is now the only page
  navigation there is at any width. Its desktop block used to state `width: 656px` rather
  than take the `--book-width` formula, because `.book` was *pinned* to 640 up there while
  the formula went on being height-derived — so between 561 and about 680px of window
  height the formula answered a few hundred pixels while the drawing above stayed 640, and
  a bar visibly narrower than the paper is worse than no bar. That pin is gone (see
  `FlipbookCanvas.module.css`), the drawing shrinks with the same formula the bar does, and
  stating the width now would be the same bug the other way round: a 656px bar under a
  516px sheet.
- **The pointer over the drawing is a ring, or one of four shapes.** `InkCursor`, which
  reads nothing but the `Cursor` `pointer.ts` publishes and knows nothing about paper.js.

  The ring is the two tools that mark. It replaces the arrow outright, on every layout
  and for both kinds of pointer: it is the diameter of the mark about to be made — the
  pencil's width, or the eraser's bite, which is `ERASE_TOLERANCE` doubled — stated in
  project units and turned into a percentage of `.book`, which is exactly the size the
  canvas is shown at. So it needs no measuring and no JavaScript scale. Two things to
  keep straight there: a percentage *height* resolves against the height of the box, and
  the box is not square, so the same expression on both axes drew an ellipse nearly twice
  as wide as it was tall on a 16:9 page (`aspect-ratio: 1` instead — which is also what
  keeps it a circle now that a page can be square); and there is a 6px floor, because a
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

  There is also a **loupe**: 80px, twice life size, floating above the fingertip and
  allowed to hang off the top of the paper to stay there, or pinned in whichever top
  corner the finger isn't. It belongs to two of the thirteen drawing modes and is drawn by
  nothing else — a magnifier is the answer to a mark landing under the finger making it,
  and the default puts the cursor somewhere else entirely, so with nothing under the
  finger to see there is nothing to magnify. See [`drawing-modes.md`](drawing-modes.md).
- **Zoom is off site-wide, and on the create page the document is held still.**
  `maximum-scale=1, user-scalable=no` in the viewport tag, which Android honours and iOS
  ignores, plus `preventPinchZoom()` in `lib/zoom.ts` for Safari's gesture events.
  Double-tap zoom goes with `touch-action: manipulation` on the body; the canvas takes
  `touch-action: none`, so a stroke is never a scroll and never a pinch.

  **Cancelling the gesture events is not the whole answer, and that took a while to
  believe.** A pinch still got through occasionally, and the gap is which touches anything
  is watching: `PointerLayer` prevents the gestures it owns, but a touch that starts on a
  *control* is left alone by design — the page actions, undo, redo, save, the page bar and
  its arrows, the rail, and the whole header, which is outside the field altogether. Two fingers landing there met nothing that objected. So the create page
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
  is lost by it: the form has put `inert` on `main` by then, so the page behind it is
  out of reach anyway, and `beforeunload` is already guarding the reload.

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

## Naming a flipbook

A black wash over the window and a white card in the middle of it, asking for a title and
an optional description. `SaveForm.tsx` and its stylesheet.

**What it replaced was a blue panel laid over the canvas** — the one moment the chrome was
loud — and the reason it went is the reason for most of what follows: the panel was
positioned inside `.book` and sized against the drawing, so once a page could be square it
covered a 16:9 lid's worth of a taller sheet and left two different blues stacked on each
other. A modal belongs to the window, not to the artwork, and is measured against nothing.

- **The "contains adult stuff" checkbox is gone.** A title is the only thing anybody has
  to type. NSFW is set from admin mode now — see the note in `CLAUDE.md` — and the field
  is still in the save contract because `time-capsule` still posts it.
- **It is a positioned `<div>`, not a `<dialog>` opened with `showModal()`, and that is a
  reversal worth stating.** The dialog gave us the backdrop, the inert page and the focus
  trap for nothing, and those reasons still hold. What it also does is put the element in
  the **top layer** — and since Safari 26, iOS tints the strip behind the status bar and
  the strip behind the URL bar from the page, and **the top layer is never sampled**. So
  the wash covered the drawing and left a pale band of `--page` above and below it.

  That cost three attempts to establish, because each one moved the wash somewhere else
  inside the dialog: the `::backdrop` first, then the dialog's own background, then a
  separate wash div underneath a transparent dialog. The third is the interesting one —
  the wash was by then exactly the kind of element the sampler looks for, and the toolbars
  still didn't follow it. **An open modal dialog suppresses the sampling altogether**,
  wherever the paint is and whatever it is painted in; verified on the iOS 26.2 simulator
  against a reduced case, both with the dialog covering the viewport and with it inset
  16px clear of both edges. Take the dialog away and the same wash tints both toolbars.

  What is sampled is the background colour of `<body>`, or of a `position: fixed`/`sticky`
  element lying against the edge of the viewport, which wins over the body. `<meta
  name="theme-color">` is **not read at all** any more. So the overlay has to *be* such an
  element, and the other half of the fix is in `base.css`: the create page's lock makes
  `<body>` itself a fixed, opaque, full-viewport element. Both halves are needed — either
  one alone leaves the bands.
- **So four things the element used to do are hand-rolled**: Esc, the Tab trap, focus moved
  in on open and put back on close, and `inert` on `#root`. That is about thirty lines to
  replace an element that did it for nothing, and it buys a wash that reaches the edges of
  the phone. `inert` goes on `#root` rather than on every sibling because the overlay is
  portalled to `<body>` and so is that element's sibling; naming the one element the app
  renders into is what keeps it from inerting the overlay itself.
- **The order there is load-bearing.** `inert` blurs whatever it swallows, so focus has to
  be placed *after* the attribute lands — which an `autoFocus` on the markup cannot do,
  React applying that during commit.
- **Focus lands on the overlay, not on the title field.** It has to land somewhere inside,
  because that is what Esc and the Tab trap listen from and `inert` has just taken it off
  whatever had it. Focusing the input instead raises the on-screen keyboard the moment the
  form appears, which covers half the card and collapses Safari's own toolbar before you
  have decided to type anything. Hence `tabIndex={-1}` on the overlay: focusable, not
  tabbable, and not a text field.
- **The keyboard is an inset, not a smaller overlay.** There is no CSS-only answer that
  works where it needs to: `interactive-widget=resizes-content` is the declarative one and
  WebKit has not shipped it, so on an iPhone `100dvh` is still the whole screen and a card
  centred in it sits half behind the keyboard. `visualViewport` is what every engine
  including iOS agrees on, and what `useKeyboardInset` publishes is the **inset** — the
  overlay stays the full size of the window so the wash goes on reaching under the browser
  chrome, and the keyboard is taken off the *card* as a margin. Sizing the overlay to the
  visible height would have fixed the keyboard and put the pale bands back. `offsetTop` is
  part of the sum, because iOS scrolls the layout viewport to bring a focused field up.
- **The entrance is the Web Animations API, not a CSS animation, and that is not fussiness.**
  An animating element gets a compositing layer of its own, which is exactly the kind of
  thing the toolbar sampler is sensitive to. Both elements start at `opacity: 0` in the
  stylesheet and `element.animate()` brings them up, with `fill: 'both'` holding the last
  frame. Reduced motion is honoured in JavaScript rather than by a media query, because the
  starting frame is now in CSS: with no animation to run, something still has to put the
  two elements at their finished state or the form never appears at all.
- **The page behind is left exactly as it was**, tools, page bar, handle and all. `inert`
  is what makes that safe, and it is why none of the hiding the old panel needed is left.
- **The document stays locked while the form is up, except for `touch-action`.** A page
  scrolling behind a modal is the conflict the modal exists to avoid; but `touch-action:
  none` is an intersection down the ancestor chain that a descendant cannot give back, and
  a description longer than the 72px field has to be pannable. `.pannable` in `base.css` is
  that one exception.

## Tracing over a photograph

The ⊙ tile in the rail takes a picture with the camera and lays it over the paper at 30%,
on the page you are on, to be drawn on top of. One finger drags it, two pinch to scale and
turn it; tap the drawing to accept it, and press the tile again to move it, replace it or
take it away. **Choose several and they are laid out one per frame**, making frames as they
run off the end. **At both widths**, which it was not: it used to exist on the phone layout
only, there being nowhere on the desktop to put it. A file picker is a camera on a machine
that hasn't got one, so it is now offered where the hardware is and where it isn't.

It is in two halves, and the split is the thing to understand first. **The picture is a
pair of DOM layers over the canvas; the record of it belongs to the engine.**

- **The picture is never in the paper.js scene**, and that is the decision the rest
  follows from. A `Raster` in the project would be a fourth thing under `SYSTEM_LAYERS`,
  would be written into `exportSVG()` and so into every saved flipbook, would be
  photographed by `exportForSave` into the cover, and would have to be taught to the undo
  history. A reference you trace over is
  none of those: it is scaffolding, it belongs to the session rather than to the drawing,
  and the artwork has to come out byte-identical whether or not one was ever on screen. In
  the DOM all of that is true by construction rather than by remembering to exclude it in
  six places. Verified as well as reasoned: the exported SVG and the saved cover hold zero
  coloured pixels with a colour photograph on the sheet.
- **The record is `FlipbookState.trace`, in the engine**, keyed by page id, and it started
  in React. It had to move, because every question about a photo is a page question: it has
  to stay with its frame when a page is inserted before it, travel with that frame when it
  is dragged elsewhere, leave when it is deleted, come back when the delete is undone, and
  be handed to the copy when the page is duplicated. The engine is the only thing that
  knows when any of that happened; React mirroring all six was wrong about one of them
  within a day. `engine/trace.ts` holds the types and nothing else — no React, no paper —
  which is the same hoist `engine/formats.ts` makes for `preview/`.
- **What is left in `flipbook/trace/` is the browser's half**: the file input, the decode,
  the downscale, the pinch arithmetic and the two layers. `useTracePhoto` is now the camera
  and nothing else.

**`mix-blend-mode: multiply` is what buys back drawing "under" an opaque canvas.**

- Over white paper, `0.7·white + 0.3·(photo × white)` is the photo washed out to a third —
  which is what tracing paper looks like. Over a black stroke, `photo × black` is black
  however bright the photo is. Measured on screen pixels rather than reasoned about: the
  darkest pixel of a stroke reads 68 with no photo and 48 with one over it — **darker,
  never lighter**. That 20-level shift where the photo is dark is the one fidelity cost, it
  is only ever on screen, and it goes the moment the photo does. The alternative — a
  transparent canvas with a white sheet slid in behind it — means a second sheet on both
  pages, a thumbnail capture with no background left, and a shadow to re-home, for a shade
  nobody can name.
- **It blends with the backdrop of the parent stacking context**, which is why the photo
  and its chrome are two siblings inside `.book` at z-index 16 and 17 rather than one box
  containing both. Wrapping the pair would have sealed the photo in with nothing behind it
  and multiplied it against transparency — which is the identity, and looks exactly like
  the blend silently not being applied. `.book` itself must *not* get `isolation: isolate`
  for the same reason `.dragging` costs a `z-index`: it would become a stacking context
  permanently and take the drawing out of the argument it is currently winning.

**Undo and redo cover it, in the same stack as the drawing.**

- **A `Step` carries the whole trace map on either side of it**, in `Step.trace`, and only
  on the steps that changed it. The same argument the ink makes one line up — a state
  cannot be subtly wrong — except that here it is nearly free: the map is a handful of
  entries of a URL and four numbers, where a page of ink is megabytes. Absent means "leave
  them alone" rather than "empty", which is what stops undoing a stroke from putting a
  photo back.
- **A page operation carries its trace delta in the same step**, so one press of undo
  restores a deleted page's drawing and its photograph together. `traceDelta` is the two
  lines that do it, and it answers `undefined` for the operations that left the photos
  alone, which is most of them.
- **A placement is one step per gesture**, exactly as a stroke is. Recorded at the end
  rather than as the fingers move: a pinch is one thing you did, and fifty steps of it is a
  history nobody can walk back through.
- **Object URLs are therefore held for the life of the page and revoked all at once.**
  Revoking one when its photo is replaced or removed is the obvious thing and is wrong: the
  stack holds steps that name it, so a photo taken away and brought back by ⌘Z would come
  back as a broken image. It costs the few megabytes of however many photographs were
  actually taken in one sitting, each of which needed the camera opening.

**Everything that is plainly not "still placing this" settles the photo.**

- Turning a page, adding one, duplicating one, deleting one, taking hold of the page
  handle, pressing play, loading a flipbook, and reaching for a tool. `settleTrace` is one
  call in each; `beginPageChange` covers three of them at once.
- **The tool is put down while a photo is in hand, and given back afterwards.** A tool in
  hand while a photograph is being moved about under it is two things answering the same
  finger, and a rail showing one lit says the drawing is live when it isn't. It needs
  `putToolDown` rather than `selectTool(null)`, because that one falls back to the pencil
  when `init()` refuses and an id of null looks exactly like a refusal to it. Reaching for
  a *different* tool is its own answer, so `selectTool` settles without giving the old one
  back.
- **Which is why `InkCursor` stays mounted through all of it**, drawing nothing. It is
  what builds `PointerLayer`, and that is the only subscriber to `setToolPressed` — and on
  a phone the rail is driven by touch with `preventDefault()`, so there is no click behind
  it to fall back on. Rendering it only when there is a tool to draw a cursor for left the
  three tools completely dead while a photo was being placed, and reset the standing cursor
  to the middle of the page every time a photo was picked up. Neither is visible in a test
  that presses the button with a synthesised click: `event.detail === 0` is the keyboard
  path, and the keyboard path goes through `onClick` and works either way.
- **Duplicating hands the photo to the copy, not to the page you end up on.** The copy
  takes the current page's place and you carry on drawing on the original, so the frame you
  were just tracing is the copy — and the original moves along to become the *next* frame
  and should arrive clean, ready for the next pose. Following the page *id* instead put the
  photo on the frame you had just moved to, which reads as it having jumped forwards while
  the frame you traced lost its reference. `sameTrace` tests the case that catches: same
  size, same picture, different id.

**The gesture.**

- **The pinch is absolute, not incremental.** `geometry.ts` is two pure functions of the
  placement *at the press* and the contacts then and now, and the property they exist to
  have is that whatever was under the middle of the two fingers when they landed is under
  the middle of the two fingers now. Measuring from the press rather than from the last
  event is what stops a hundred deltas a second accumulating rounding, and what stops the
  scale clamp ratcheting: open a pinch past the ceiling, close it again, and the photo
  comes back down with it. Both are in `geometry.test.ts`, including the pinned point at
  the clamp.
- **The baseline is retaken whenever a finger lands or leaves**, which is what stops the
  photo jumping when a second finger arrives mid-drag or the first of two lifts.
- **Nothing goes through React until the fingers come off.** The placement is written
  straight onto both layers as four custom properties, the same bargain `--drag` makes.
- **The placing field says `data-owns-touch`, which is how `PointerLayer` lets go.** It is
  the same statement the page's controls make through `CONTROLS`, and without it the aiming
  layer would take every gesture in the capture phase and nudge the drawing cursor about
  instead. `refuseMultiTouch()` is unaffected and still wanted: it only calls
  `preventDefault()`, so the pinch is still delivered and iOS still doesn't zoom the page.

**The chrome.**

- **The dashed edge is an SVG rect with `vector-effect: non-scaling-stroke`**, and a CSS
  border cannot do this job. Everything under `.plate` is scaled with the picture, so a 2px
  dash pinched to 8× is a rope — and the obvious compensation,
  `calc(2px / var(--trace-scale))`, lands on a sub-pixel border width that a browser is
  free to round away. That is a dashed edge that comes and goes as you pinch and is missing
  altogether at some scales, which is exactly what shipped first. A non-scaling stroke is
  2px on the glass at every scale by definition, and the dash pattern is in screen units
  too, so `preserveAspectRatio="none"` can stretch the viewBox to the picture's shape
  without stretching the dashes with it. Where the picture reaches the edge of the sheet
  its outer half is clipped and the line reads 1px rather than 2; an inset would have to be
  stated in the picture's own units, which are scaled, so it would be 1px at life size and
  16px at 8×.
- **The picture is sized in numbers rather than by `object-fit: contain`.** They come to
  the same rectangle, but only one of them is a rectangle anything else can be drawn
  around: `object-fit` letterboxes inside the element's box, so the box stays the frame and
  there is nowhere to hang an outline but around the whole sheet. The frame keeps its shape
  at every width, so the fit is two `min`s and needs nothing measured — it takes the page's
  shape as an argument, because there are two of those now and a photo is fitted to the
  paper it is lying on. It is `fittedSize` in
  `engine/trace.ts` rather than an expression here, because **three things read it**: the
  picture, the dashed outline, and v11's magnified stage, which draws the same photograph
  into a canvas from the same numbers.
- **It is stronger while it is being placed** — 55% against 30% — because a third is what
  you want to draw *against* and is not what you want to aim with. Lining a photograph up
  by its edges at 30% over white is guesswork.
- **It goes while the flipbook plays, and while one is still loading.** Twelve frames a
  second under a photograph pinned to one of them says nothing about any of them; and a
  load is replacing the pages the photo would be standing on.
- **The sheet of choices focuses itself, not its first button.** `:focus-visible` is the
  browser's own judgement about whether focus arrived from a keyboard, and a programmatic
  `.focus()` poisons it — the same trap the gallery card's focus ring is written up for —
  so autofocusing the first choice drew a blue ring round it for anyone who had *tapped*
  the camera. A container with `tabIndex={-1}` takes focus without drawing anything, and
  Tab from there reaches the three choices in order.

**Several at once, one per frame.**

- **`capture` is gone and `multiple` is in its place, and the two are a choice rather
  than a pair.** `capture="environment"` opens straight into the viewfinder, which is one
  tap better — and it can only ever hand back one photograph, because the OS camera takes
  one: `multiple` is *ignored* while `capture` is set. Without it both platforms show
  their own sheet — Take Photo, or the library with multi-select — which is the only route
  a web page has to more than one picture at a time. There is no burst capture short of
  building a viewfinder on `getUserMedia`, which is a much larger thing.
- **`addTracePhotos` is where a batch lands**, and it is one step in the history however
  many photos there are. A batch is one thing you did; undoing it eight times to get back
  where you were is not undo. The step carries a `page` op per frame it made and the whole
  trace map either side of it, which between them are the entire operation.
- **Nothing lands in hand, where a single photo does.** "In hand" is an offer to place
  *this* one, and there is no sensible answer to which of eight that would be — so they
  land centred and fitted, and pressing the camera on any frame picks that one up. You
  stay where you were, which is the frame the first photo is on and the one you are about
  to draw.
- **Sorted by `lastModified`, not by the order the picker gave them.** `input.files` comes
  back in *album* order on iOS however you tapped them, which for a sequence photographed
  in one go is the wrong way round about as often as it is the right one. The sort is
  stable, so files that all claim the same time — a download, an AirDrop — keep the
  picker's order.
- **Decoded one at a time**, which is why it is a loop rather than a `Promise.all`. Twelve
  megapixels is about 48 MB decoded and two dozen of those at once is a gigabyte held for
  as long as the slowest one takes; sequentially it is one, thrown away as soon as the
  downscaled copy exists. A file that won't decode is skipped rather than failing the
  batch.
- **`MAX_BATCH` is 24.** Each photo is about 4 MB decoded and is held until the tab
  closes, and iOS enforces its per-tab canvas allowance by *blanking* canvases rather than
  by failing. Anything past 24 is dropped and said so in plain words rather than silently.
  This used to be the tighter of two limits — every frame also carried a full-size
  thumbnail canvas in the page strip — and the strip is gone, so 24 is now the photos'
  number alone and there is more room under it than there was.

**And v11 draws it a second time.** The picture stays a pair of DOM layers over the paper
— nothing here goes near the artwork, and that is the decision the whole feature is built
on — but the zoom stage is a canvas showing a window on the page, so it composites the same
photograph itself from the same placement. Placing is still the paper's: you drag and pinch
it up there, and the stage follows. See **v11** in
[`drawing-modes.md`](drawing-modes.md).

**Two things about the picture itself.**

- **Not persisted, and that is a decision rather than an omission.** The crash-recovery
  file is already carrying the artwork and a phone camera JPEG is megabytes; a reference
  photo is also the one thing on this page that can be got back in two taps.
- **The file is downscaled to 1280 on its long edge on the way in.** Twelve megapixels
  decodes to about 48 MB, per photo, and there can be one on every page. Redrawing it
  through a canvas also bakes in the EXIF orientation a phone writes, rather than carrying
  it about.

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
  left and went with the stylesheet it was in.
- **`PageNav` is here**, the create page's bar, at every width and full width under the
  flipbook. It is the only play button this page has: the handle is tapped to play and
  dragged to scrub, which is what took circleplay's job as well as play's. It stands 8px
  under the paper and the title's row stands 20px under it — the bar belongs to the
  flipbook, which is why it takes the paper's shadow, and a title tucked up against it
  reads as owning the bar instead.
- **There is no tray here at all any more, at any width.** It was the create page's row
  of controls carrying print, play, circleplay and the admin toggles; play became the
  handle above and circleplay was deleted, which left a full-width bar of chrome holding
  one printer icon. `PlaybackTray.tsx` is gone, and so is `Tray.module.css`: the create
  page's rail replaced the tray there too, so the last user of that stylesheet went with
  this one.
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

## Memory, and leaving the page

iOS enforces its per-tab canvas allowance by *blanking* canvases rather than by failing,
so the ceiling has to be respected rather than discovered. There used to be two things
under it and now there is one.

- **The page strip was most of that budget, and it is gone.** Every page in it was a
  canvas the size of the drawing at the device pixel ratio — a thumbnail stands behind the
  live canvas at exactly its size, so at 1:1 it was a soft copy of a sharp drawing right
  beside it — capped at 2× and costing 3.6 MB a page on a 16:9 flipbook. A square page is
  78% more pixels again, which would have made it 6.6. Past `HIDPI_PAGE_LIMIT`, 50 pages,
  the strip dropped back to 1:1 and never climbed back, because changing the scale emptied
  and redrew every canvas in it.

  A 200-page archive flipbook was 184 MB of thumbnails with that limit and 737 without,
  which is what the limit was for. It is now zero, and the number that replaced all of it
  is one control 56px tall.
- **Trace photos are in that same budget, and every one taken is held until the tab
  closes.** Not until it is replaced or removed: the undo stack holds steps that name its
  object URL, so revoking early is a ⌘Z that brings back a broken image. `MAX_EDGE` is
  what keeps each one to about 4 MB decoded rather than the ~48 MB a phone camera hands
  over, and each one costs a trip to the camera to make. With the strip gone they are the
  whole of this budget. See **Tracing over a photograph**.
- **An unsaved drawing holds a spare history entry.** 2013 left the page for real on
  every navigation, so `beforeunload` covered the logo and the back button along with
  everything else; here neither one is a page load. `<Link>` goes through the router's
  `guardNavigation()`, and back is answered rather than blocked — a duplicate entry is
  pushed so the first press lands on the same URL and can be asked about. Cost: one
  extra entry, and a live forward button, while the flipbook is unsaved.
- **A successful save leaves the SPA** — `window.location.href`, not `navigate()`. The
  drawing tool has a paper scene, a megabyte of artwork and an unsaved-work guard
  attached to the document, and none of it should follow you to the flipbook page.

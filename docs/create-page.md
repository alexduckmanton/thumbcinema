# The create page

The layout, the page bar, the tray, tracing over a photograph, naming a flipbook, and
the playback page that shares most of it. How a finger drives the tools is its own file:
[`drawing-modes.md`](drawing-modes.md).

The one place this is deliberately no longer a port. It started as the phone layout —
the same tool laid out for a screen a third of the width and for a finger rather than a
pointer — and the desktop has since been brought up to meet it, so most of what follows
is now true at both widths and the differences are called out where they exist.

- **The canvas scales; the artwork does not.** See `Scene.pinCoordinates()` above.
- **There is a tab on the top edge of the paper, and dragging it moves the page** to
  another place in the flipbook — or holding it to one side runs the flipbook past
  underneath. It is the only thing in the column that isn't 2013's,
  and it is deliberately not *in* the column: it hangs in the empty band above the
  drawing, so it changes no layout and `--book-reserve` is the same number it was. See
  **Rearranging pages** above for the whole of it.
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
  coloured slivers. `clip-path: inset(-68px …)` on the list keeps them out of exactly
  that gap — 68 is the bar's top edge — and **that is the whole of what the clip does.**

  **What decides how much of a tool you see is the bar, not the clip.** The bar carries
  `z-index: 10` and the tools carry 1, so it paints over them: what shows is the run
  between the bar's bottom edge and wherever the tool's own `bottom` puts its tip. The
  canvas covers the rest of the way up on its own. This is worth stating plainly because
  it has already been got wrong once — the clip was moved from -20 to -44 to "stop the
  tools reading as cropped", which cannot work and did nothing, since every value in that
  range cuts a stretch the bar is already covering.

  The two numbers that do move it are on `.tool`. It hangs 20px below the row rather than
  10, which is free — the tray already carries 20px of padding under the list, so the tip
  reaches the tray's own bottom edge and the row grows by nothing — and selecting one
  slides it 20px rather than 50. The 50 is 2013's, from when the thing above this row was
  360px of *paper*: a tool sliding down came out from under a sheet and the extra length
  read as tool. Under a 48px floating pill it brought out a bare stretch of barrel, and
  the selected tool looked worse than the unselected one, which is the wrong way round
  for the one in your hand. The transform gets the same 20px where it had 11: it is the
  tool whose picture reads worst when cut — a pencil's bottom 55px is a recognisable
  point, a pocket knife's is a rounded red end that could be anything — so it was the one
  revealing least on being picked up.

  **None of this makes the transform whole.** It is a 151px picture in a band that shows
  85, and the only levers left cost canvas: a taller row, or a shorter page bar.
- **The page strip stays, scaled, and `PageNav` is added under it.** The strip was
  hidden on a phone at first, and everything about that was wrong: a page change is the
  flipbook rearranging itself, and with the row not rendered there was nothing on screen
  saying so — the strip was also where half of the old page animations were played, on an
  element with no layout box. It is on both layouts now. A page is `--page-width` wide, which the component sets
  from the live canvas, so the thumbnails are copies of the drawing at the size the
  drawing is currently drawn at. What that costs on a phone is the peek: the drawing
  takes all but 16px of the window, and the gutter is spent twice out of that, so 4px
  of gutter leaves 8px of the next page showing. More than that means a smaller
  drawing.
- **Nothing knows the pitch at build time any more.** It was `CANVAS_WIDTH +
  PAGE_MARGIN * 2`, a constant in three places; it is now measured — the component
  reads the page's own padding back off the box and hands the total to
  `engine.setPageStep()`, which is what the reorder gesture measures a drag in pages
  against. `PAGE_MARGIN` is gone from `constants.ts`, and `DEFAULT_PAGE_STEP` in
  `reorder.ts` is only the fallback until the strip has laid itself out and said.
- **`PageNav` is one white bar under the drawing: two arrows, a scrubber, and play.**
  The handle follows the finger while it's held and settles onto the nearest page when
  it's let go (`fractionAt` and `pageAt`, both unit tested), and it follows playback as
  well as leading it, because the engine publishes every page change including the
  twelve a second that `play` makes — which is also the one time the settle's
  transition is turned off. **It also follows a page being carried somewhere else**, which
  is the one thing it points at that isn't the page being drawn on: see `.gliding`, and
  **Rearranging pages** for why. The two arrows stand *on* the bar rather than beside it,
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
- **The strip doesn't ease at all. Turning a page is a cut, and so is adding one and
  deleting one.** It used to slide from page to page over 0.3s, matched to the page
  animations' travel time — every keyframe set that threw a page into the next slot
  arrived at offset 0.35–0.4 of its 750ms, and the strip carried every page that *wasn't*
  individually animated, so the two had to cover the same ground in the same time. But it
  also eased on an ordinary page turn, where nothing was being thrown, and half a second
  of the whole flipbook sliding under the drawing every time you step a page reads as the
  pages being dragged about rather than turned. It was already switched off under a finger
  on the page bar; if it was wrong there it was wrong everywhere. Gone with the
  transition: `scrubbing` (create page → `PageStrip`, and `PageNav`'s `onScrubbing`) and
  `useSnapOnRemoval`, both of which existed only to switch it off.
- **And the page animations are gone altogether, which is what removed the exception.**
  Adding, duplicating and deleting a page were 750ms of 2013's keyframes — the new canvas
  spinning in from off to the right, the page you were on thrown left into the strip, the
  deleted page tumbling off the bottom of the window — and the row eased for the length of
  a throw (`.throwing`, `PAGE_TRAVEL_MS`) because everything ahead of the gap had to travel
  exactly as far as the thrown page and nothing was animating those individually. A page
  change is a cut now: the scene, the store and the strip are in their final shape on the
  frame the button is pressed, and pressing it twice adds two pages rather than being
  refused for three-quarters of a second. What went with the keyframes is the whole of the
  machinery around them — `animations.ts` (`play`, `freeze`, `freezeRange`, `animateInsert`,
  `PAGE_TRAVEL_MS`), the `.throwing` rule and its `--throw`, `FlipbookState.arriving` and
  the `.handedOver` canvas it hid behind, `PageState.leaving` and `settledPageCount`, which
  existed because a deleted page had to stay in the list for as long as it took to fall, and
  `busy` for anything but a page in hand. `prefersReducedMotion` moved to `lib/device.ts`,
  the reorder settle being the one thing left that asks.

  **The one movement kept is carrying a page to another slot**, which is a gesture rather
  than an animation: the flipbook is being moved by a finger and closes up round the page
  when the finger goes, and neither half reads without the movement. See **Rearranging
  pages**.
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
- **On a phone the bottom of the window is a footer bar: the camera and four edit actions
  at one end, save at the other** — and, for an admin, the drawing-mode switch on the end
  of the row. It was the save button alone, floating in the middle; a bar is what lets the
  others stand next to it without any of them looking like an afterthought. The camera
  leads the row — it is the one disc there that isn't spending a stack, so it stands at
  the far corner where the four that are can stay adjacent, and as far from Save as the
  bar allows, those being the two presses least worth confusing. The mode switch takes the
  opposite end for the same reason in reverse: it is scaffolding, and the one control here
  nobody should reach for by accident. See **Tracing over a photograph** below, and its
  note on what a fifth disc did to the arithmetic. Fixed 8px off the bottom, because the
  column ends wherever the tools happen to end and the rest of a phone screen is air.

  **Nothing in this bar moves when the save form goes up, and that is a reversal.** The
  row used to slide off the bottom of the window on a phone and off the top on a desktop,
  and the tray's tools flew up out of their row to match — a 2013 keyframe kept through two
  rewrites. It was right while the form was a panel laid over the canvas, because the form
  was standing on the drawing. It is a modal now, and a modal puts `inert` on `main`, which
  is the whole of what the fly-away bought. See **Naming a flipbook** below.
- **Undo, redo, copy and paste are the phone's, and the phone's alone.** Each is a white
  disc exactly as tall as the save button and as wide as
  it is tall, wearing a Pecita glyph — ↺ ↻ ↥ ↧, set as live text for the same reason the
  wordmark is: the icon sheet is drawings of *things*, and none of these four is a thing.
  Dimmed rather than hidden when there is nothing to spend, because which of them is
  available changes with every stroke and every tap on the drawing, and a button that
  comes and goes under a resting thumb is a button pressed by accident.

  **The last two glyphs are a compromise, and worth saying so.** Pecita's dingbat block
  is hand-drawn pencils, nibs and a writing hand; it has no scissors, no clipboard and no
  pair of overlapping sheets, which is what every other application draws here. What it
  does have is a full set of arrows in the same weight as ↺ and ↻, and a bar under an
  arrow reads as a surface: ↥ takes a copy up off the page, ↧ brings one back down onto
  it. The four then look like one family rather than two borrowed from different sets,
  which they would not in any face the rest of the site doesn't use. The tooltip and the
  accessible name carry the actual words.

  They are the left-hand end of the footer, in that order — the two that spend the
  history, then the two that spend the clipboard.

  **There was a second copy of the row up beside the wordmark on a desktop, and it is
  gone.** It went in with the argument that a fifty-step history nothing on screen
  mentions is a feature people find out about by accident, which is true — but it was
  a header's worth of a window that a square page needs, and a desktop is the one place
  ⌘Z is already at hand. `useKeyboardShortcuts` is the whole of undo, redo, copy and
  paste up there now. The wordmark went with it for the same reason; see below.

  What that simplifies: the row is in the markup once, there is no `display: none` copy
  to keep in step, and nothing has to be disabled while the save form is up — the form
  puts `inert` on `main`, which takes the whole page out of reach in one attribute.

- **The create page has no header at all.** No wordmark, no actions — `SiteHeader` drops
  the row rather than rendering an empty one, so its 40px of padding goes too. It is the
  one page that isn't somewhere you read, and the ~110px it was spending on a sign is
  most of what a 640×640 page needed over a 640×360 one. The cost is the only link home,
  which the drawing tool had to interrupt anyway: `guardNavigation()` asks before it lets
  go of unsaved work, and the back button asks the same question.

  `--book-reserve` came down with it — 318 to 260 on a desktop, 212 to 154 in a short
  window — and those are measured rather than reasoned. With the old values the column
  ended 64px short of the bottom of the window and the drawing was that much smaller than
  the room it had. What is left over now is 6px at every size checked.

  **The gaps and the sizes are arithmetic, and it is written out under **Tracing over a
  photograph** below** — the camera made a five-across row out of a four-across one and
  the numbers were redone for it, and the admin switch makes it six and takes the whole
  row down another size. Both are `.actions` in `CreatePage.module.css`.
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
  special case. `--book-reserve` is 154 in a short window: the popover it used to be set
  from is gone, and the header went with it — see **The create page has no header at all**
  above for both numbers.
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
  bottom edge. (`position: fixed` on the body was a fifth property here and is gone —
  it was what iOS had already picked to tint its toolbars from, which is the whole of why
  the save form's wash could not reach them. See **Naming a flipbook**.)
  `overscroll-behavior: none` is what takes
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

  **A pinched page carries on behind iOS Safari's toolbar, and one line is what allows
  it.** The lock's `overflow: hidden` has to clip somewhere, and where it clips is the
  `<body>`'s box — `overflow` on the root propagates to the viewport and leaves the root
  itself `visible`, so the two clips in play are the viewport's, at the initial containing
  block, and the body's. Verified rather than reasoned, with the page pinched to 4×:
  shrinking the body's box cuts the sheet off at it and shrinking the root's box does
  nothing at all. The body's height is otherwise its content, `#root` at `100dvh` — and on
  a page that cannot scroll nothing ever collapses the toolbar, so `dvh` is permanently
  the viewport *with the toolbar out* and the sheet was cut off at precisely the top edge
  of the URL bar. `html.locked body { min-height: 100lvh }` makes the clip the viewport
  with the browser's UI retracted, which is exactly the strip the toolbar sits over, and
  since Safari 26 that toolbar is translucent: what is behind it shows through. Everything
  *laid out* stays on `100dvh` — the column, the paper's own size, the footer above
  `env(safe-area-inset-bottom)` — so the only thing with anything to paint down there is a
  sheet somebody has pinched out of its frame. It buys nothing for a *stroke* started in
  that strip, which is iOS's: the bottom edge is where its own toolbar and home-indicator
  gestures live, which is why the footer sits above the inset to begin with.

  **The status bar is a different question, and it can only be answered in colour.**
  The URL bar above is a real clip with a real fix; the strip behind the status bar is not
  page territory at all — the web view starts below it, and since Safari 26 what fills it
  is a tint *sampled from the page*, with `theme-color` not read any more and the
  `<body>`'s background, or a fixed element at the edge of the viewport, read instead.
  (That is the same sampler the save form's wash had to be built around; see **Naming a
  flipbook**.) So `html.locked.pinched body` carries the paper's own white for as long as
  a sheet is pinched, and the strip goes white with it: the drawing does not continue up
  there, but nothing says it stops either. `.pinched` is `useNoScrolling`'s third class,
  set in the one place `.locked` and `.pannable` are. What it costs is the grey surround
  at the low end of the zoom, where the sheet doesn't yet cover the window and the pages
  either side of it are white sheets on white, keeping only their shadows; at the top of
  the zoom there is no surround left to be any colour.

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

The white disc at the left-hand end of the phone's footer takes a picture with the
camera and lays it over the paper at 30%, on the page you are on, to be drawn on top of.
One finger drags it, two pinch to scale and turn it; tap the drawing to accept it, and
press the disc again to move it, replace it or take it away. **Choose several and they are
laid out one per frame**, making frames as they run off the end. **Phone layout only** —
the disc is in `.actions`, which is `display: none` above the breakpoint, and a desktop
has no row of these at all.

It is in two halves, and the split is the thing to understand first. **The picture is a
pair of DOM layers over the canvas; the record of it belongs to the engine.**

- **The picture is never in the paper.js scene**, and that is the decision the rest
  follows from. A `Raster` in the project would be a fourth thing under `SYSTEM_LAYERS`,
  would be written into `exportSVG()` and so into every saved flipbook, would be
  photographed by `captureActivePage` into the page strip and by `exportForSave` into the
  cover, and would have to be taught to the undo history. A reference you trace over is
  none of those: it is scaffolding, it belongs to the session rather than to the drawing,
  and the artwork has to come out byte-identical whether or not one was ever on screen. In
  the DOM all of that is true by construction rather than by remembering to exclude it in
  six places. Verified as well as reasoned: the page strip's thumbnails hold zero coloured
  pixels with a colour photograph on the sheet.
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
  permanently and drop the canvas below the page strip.

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
  finger, and a tray showing one selected says the drawing is live when it isn't. It needs
  `putToolDown` rather than `selectTool(null)`, because that one falls back to the pencil
  when `init()` refuses and an id of null looks exactly like a refusal to it. Reaching for
  a *different* tool is its own answer, so `selectTool` settles without giving the old one
  back.
- **Which is why `InkCursor` stays mounted through all of it**, drawing nothing. It is
  what builds `PointerLayer`, and that is the only subscriber to `setToolPressed` — and on
  a phone the tray is driven by touch with `preventDefault()`, so there is no click behind
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
- **The frames it makes go in as one operation**, which is the same insert `applyStep`
  uses to put a page back rather than eight trips through `addBlankPage` — eight history
  steps as well as eight flipbooks rearranging themselves.
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
- **`MAX_BATCH` is 24.** Each photo is ~4 MB decoded *and* gets a frame, whose thumbnail
  in the strip is a canvas the size of the drawing — both are the budget
  `HIDPI_PAGE_LIMIT` already lives under, and iOS enforces its canvas allowance by
  *blanking* canvases rather than by failing. Anything past 24 is dropped and said so in
  plain words rather than silently.

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
  decodes to about 48 MB, per photo, and there can be one on every page — which is the
  budget the page strip already lives under (`HIDPI_PAGE_LIMIT`). Redrawing it through a
  canvas also bakes in the EXIF orientation a phone writes, rather than carrying it about.

**And the footer's arithmetic had to be redone for five discs.**

- The narrowest layout that gets the row at full size is a 360px phone: a 328px column, of
  which "Save" measures 110, leaving 218. Five 38px discs 4px apart are 206 of it, 12px
  clear of the button — against the 11px the four 48px discs had. Below 360 and held
  sideways they go to 36, as the row already did. Measured at 390, 360, 320, 844×390,
  740×360 and 667×375: no overrun at any of them.
- **Held sideways the leading disc grazes the pencil's tip, and that is not new.** The
  sideways rule moves the whole bar right because each tool is a 304px picture anchored by
  its tip and the leftmost of them hangs into the footer's band; a wider row reaches back
  under it. Measured at 740×360, the overlap was 27×35px before this and is 36×31px now. It
  cannot be closed by sizing — clearing it at 740 needs discs of about 24px — and it is a
  decorative picture under a button that is drawn above it and stays pressable.

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

## Memory, and leaving the page

The page strip and the trace photos share one budget, and iOS enforces its per-tab
canvas allowance by *blanking* canvases rather than by failing — so the ceiling has to
be respected rather than discovered.

- **Every page in the strip is a canvas the size of the drawing**, on both layouts — the
  thumbnails are displayed smaller on a phone but they are not *drawn* smaller, because a
  page that has to stand behind the live canvas at full fidelity when you're on it can't
  be. And "full fidelity" is the *device* pixel ratio, not the page size: a thumbnail is a
  copy of a canvas paper draws at twice the size on a retina screen and shows at exactly
  the same size, so at 1:1 it was a soft copy of a sharp drawing, standing right beside it.
  `THUMBNAIL_SCALE` in `PageStrip` is that ratio, capped at 2 — 3.6 MB a page rather than
  0.9 on a 16:9 page.

  **A square page is 78% more pixels than a 16:9 one**, so the same cap costs 6.6 MB a
  page rather than 3.6. The limit below is a page *count* and was set against the smaller
  shape, which means it now buys correspondingly less headroom on the newer one. Worth
  re-measuring on a long square flipbook before trusting the old number.
- **Which is why the strip has a page limit, and it is the memory that sets it.** Four
  times the backing store is fine for a flipbook you drew by hand and is not fine for a
  200-page archive one, which the drawing tool could not open until Remix and now can:
  184 MB against 737 MB, and iOS enforces its per-tab canvas budget by *blanking*
  canvases rather than by failing. So past `HIDPI_PAGE_LIMIT` — 50 pages at 2×, which is
  the byte ceiling the strip already lived under — thumbnails go back to 1:1. The scale
  never climbs back, because every change of it empties and redraws every canvas in the
  strip, and buying sharpness back by deleting a page is not a trade worth making twice.
- **Trace photos are in that same budget, and every one taken is held until the tab
  closes.** Not until it is replaced or removed: the undo stack holds steps that name its
  object URL, so revoking early is a ⌘Z that brings back a broken image. `MAX_EDGE` is
  what keeps each one to about 4 MB decoded rather than the ~48 MB a phone camera hands
  over, and each one costs a trip to the camera to make. See **Tracing over a
  photograph**.
- **An unsaved drawing holds a spare history entry.** 2013 left the page for real on
  every navigation, so `beforeunload` covered the logo and the back button along with
  everything else; here neither one is a page load. `<Link>` goes through the router's
  `guardNavigation()`, and back is answered rather than blocked — a duplicate entry is
  pushed so the first press lands on the same URL and can be asked about. Cost: one
  extra entry, and a live forward button, while the flipbook is unsaved.
- **A successful save leaves the SPA** — `window.location.href`, not `navigate()`. The
  drawing tool has a paper scene, a megabyte of artwork and an unsaved-work guard
  attached to the document, and none of it should follow you to the flipbook page.

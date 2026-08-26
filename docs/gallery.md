# The gallery, and the flipbooks that play in it

The grid, the hover preview that plays a whole flipbook without loading paper.js, the
card gesture on a mouse and on a finger, and the play button.

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

## On a finger

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

## The play button

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
- **The canvas lies over the thumbnail rather than replacing it.** A canvas is
  transparent until something is drawn on it, so swapping them would put a frame of
  empty white card in the one moment the card is being looked at. It fades up when it
  has something to show; leaving the card takes it away and the thumbnail is simply
  there again. It is above without a z-index, because it comes after the link in the
  markup and both are positioned — worth knowing before reordering a card's children.
- **The thumbnail on a card is one page of the flipbook, not a picture of one.**
  `thumbnail_svg` is the cover page lifted out of the artwork and stored on its own,
  brotli'd; `/api/flipbooks/:id/thumbnail.svg` serves it. On a real row it is 718 bytes
  against that flipbook's 10,060-byte PNG, it is sharp at whatever size the card is
  rather than resampled from a fixed 640×360 grid, and across a grid of 24 it is the
  difference between roughly 480 KB and 70 KB. See `lib/thumbnail.js` for how a page is
  taken out, and **Data** below for why the PNG is still written on every save.

  Which of the two a card asks for is **stated by the listing** — `thumbnail_svg_url`
  is null on a row that hasn't got one and the card shows the PNG. It has to be stated
  rather than guessed: a card that tried the SVG first would put a 404 in front of every
  PNG in the grid.

  **A lifted page has to be given a viewBox, because the archive's artwork hasn't got
  one.** paper 0.8 wrote a bare `<svg xmlns="…">` — no viewBox, no width, no height —
  where 0.12 writes `width="640" height="360" viewBox="0,0,640,360"`. `coverSvg` copies
  the root's attributes wholesale, which is right for everything saved since the rewrite
  and left all 438 archive rows dimensionless; an `<img>` gives a dimensionless SVG the
  300×150 default, draws the page 1:1 into it, and `object-fit: cover` enlarges whatever
  corner survived, so the card showed about the top-left fifth of the drawing blown up.
  `rootAttributes` states 640×360 when the file doesn't. It went unnoticed twice over:
  every fixture in `lib/thumbnail.test.js` was the 0.12 root, and **this is the only
  place anything asks the *file* how big it is** — the engine and the gallery's preview
  renderer both state 640×360 themselves (`Scene.pinCoordinates`), which is why an
  archive flipbook plays and hovers perfectly and only its card was wrong.

  It is a fixed window and deliberately not a bounding box of the ink. A stroke drawn
  off the edge keeps its whole geometry — paper clips nothing, the viewport does — so
  archive pages hold coordinates well outside the canvas, −397 to 1279 across a
  40-flipbook sample. Fitting the content would zoom out and show strokes the drawing
  never did; stating the window clips them, as the PNG does and as the flipbook itself
  does when it plays.
- **The card's picture is an `<img>` now, not the link's `background-image`.** What
  changed is not the format, which a background would have shown perfectly well, but
  that a background image can't be lazy — the grid is an infinite scroll, and every card
  ever appended to it fetched its picture whether or not it was within a screen of the
  window. Two things came with it, both restoring what a background did for free: an
  `onError` that hides the image, because a picture that won't load used to leave a
  white card and an `<img>` draws a broken-image icon instead — and some archive rows
  have no thumbnail at all; and `draggable={false}`, because an image inside a link is a
  drag source by default, in a grid where dragging is how a finger scrubs.

## Fetching, paginating and the skeleton

What the grid does while it is filling up, and why.

- **Hovering a card downloads a whole flipbook.** That is the design and brotli is what
  makes it reasonable — median 45 KB across the first Featured page, worst 288 KB — but
  it is a real request per card hovered, and the archive's largest are still hundreds of
  kilobytes. Preloading a page of cards rather than waiting for the pointer is now
  arguably affordable (1.75 MB for all 24) and was not before; it is deliberately not
  done, because most of a grid is never hovered.
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

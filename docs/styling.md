# Styling

Plain CSS, one module per component. The breakpoint, the tokens, the sprite, and the
two typefaces.

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
  test alone hands it a full-size canvas and a page strip in a window that can hold
  neither — which a square page only makes truer, being taller at the same width. There's a note in `base.css` saying so.
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

## Type

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
- **Pecita signs the buttons that are about making a flipbook**: create on the gallery,
  save on the create page, and the four edit actions beside it. All three are set at
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

## Loading states

There is no spinner anywhere on the site. Every wait is a picture of the thing that is
coming, in the place it is coming to.

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
  there. It is why the create shell also draws a disabled row of edit actions out of
  `CreatePage.module.css` — those are in the header on a desktop, and a header that
  gains four buttons at the handover is exactly the move this exists to prevent. Their
  glyphs are repeated in that file rather than shared, because anything it imports lands
  in the entry bundle and `EditActions` lives in the create route's chunk. Applying
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

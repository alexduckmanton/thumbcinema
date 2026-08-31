# A flipbook as a GIF

Put `.gif` on the end of a flipbook’s URL and you get the flipbook as an animated GIF.
`lib/gif.js` is the whole of it — a rasteriser and a GIF writer, in Node, with no
dependency and no canvas.

Put `.gif` on the end of a flipbook's URL and you get the flipbook as an animated GIF:
`/f/a2715` is the page, `/f/a2715.gif` is the file. `lib/gif.js` is the whole of it —
a rasteriser and a GIF writer, in Node, with no dependency and no canvas.

- **It serves bytes and nothing else**, which is what the feature is rather than a
  simplification of it. Everything worth pasting a GIF link into — Slack, Discord, an
  `<img src>` — issues a GET and expects an image back, and none of them run
  JavaScript. A URL that returned a page which then drew a GIF would work nowhere.
- **It is a rewrite, not a route.** `vercel.json` maps `/f/:id.gif` to
  `/api/flipbooks/:id/gif` above the catch-all that hands everything else to the SPA,
  and `vite.config.ts`'s middleware states the same thing for `npm run dev`. The id
  pattern excludes dots so it can only ever match one `.gif`. Written twice because
  the two hosts express it in different languages; what must not drift is the
  destination.
- **Rendered per request and never stored.** Artwork is immutable, so the GIF is too,
  and `Cache-Control: immutable` means the CDN renders each flipbook once per edge
  region and serves it from memory after that — about 200ms, once, for a median
  flipbook. Storing them was measured and rejected: at a ~0.4 MB mean across 594 rows
  that is another ~240 MB of Neon against a 0.5 GB tier already holding 77 MB, for
  bytes that are LZW-compressed and so incompressible in `bytea`. Not storing it is
  also what makes editing a flipbook cheap later — there is no stale copy to
  invalidate, only the one `IMMUTABLE` constant that `/data` and both thumbnails
  already share.
- **No view is counted**, deliberately. An `<img>` on somebody else's page pulling
  this a thousand times is not a thousand people watching a flipbook.
- **It is the third reader of the artwork format**, after the engine and the gallery's
  preview renderer, and it reads the same three stroke vocabularies. What it shares is
  the awkward part: `lib/thumbnail.js`'s tag scanner, which walks a paper export
  without a parser and has tests around it, now exports `tags` and `pageGroups` for
  this. `legacy-json` renders too — those 147 rows can't be remixed and have no SVG
  thumbnail, but they are point lists and the same code path draws them.
- **A stroke is a distance test, not an outline.** Round caps and round joins mean the
  stroke is the set of points within half a width of the polyline, so there is no
  outline to build, no joins to mitre and no scanline fill — and only each segment's
  own bounding box is visited, which makes the cost proportional to the ink rather
  than to the canvas. Overlap is a `max` rather than a sum, which is what a union
  means and what stops a join coming out darker than the line either side.
- **It is not the same anti-aliaser the browser has, and that was measured rather than
  hoped.** Against Chromium's canvas — which is Skia, and which
  `preview/render.ts` is already verified against — this agrees to a mean of 0.43 in
  255 over the whole image, differing only along stroke edges and by at most ~78 on an
  individual edge pixel. Supersampling at 3×3 and 5×5 does not close it and neither
  does compositing strokes separately, so it is a different anti-aliaser rather than a
  cheaper one. It is visually indistinguishable, it lands on an export quantised to 16
  greys whose own step is 12, and the alternative was a 33 MB Skia binary in the API
  function's cold start. If that ever stops being the right trade, `@napi-rs/canvas`
  produces the same coverage buffer and matches Chromium to within 3 in 255.
- **Frames are whole, and not diffed against each other.** This is the optimisation
  every GIF encoder reaches for and it is wrong here: writing only the changed pixels
  made a 40-page flipbook *larger*, 815 KB against 563 KB. Consecutive frames of a
  flipbook are different drawings rather than a moved sprite, so nearly every stroke
  pixel changes, and a diff has to write an explicit white wherever the last frame's
  ink has gone — which scatters isolated pixels through the long runs of paper that
  are the entire reason a page compresses. Two things follow: transparency is unused,
  so all 16 palette slots are ink levels and a pixel costs four bits rather than five;
  and frames are independent, so they can be encoded and dropped one at a time. A
  200-page flipbook is 46 MB of raw frames and a 2.9 MB file, and this never holds
  more than one of them.
- **16 greys.** Measured on the same page: 2 is 260 KB and looks like a fax, 16 is
  574 KB, 64 is 829 KB for edge detail nobody can see on a hand-drawn line. 16 is also
  the last value that fits in four bits.
- **12fps, which GIF cannot state.** Delays are hundredths of a second and 1/12 is
  8.333 of them, so the frames alternate 8, 8, 9 — which averages it exactly, and a
  flipbook is a loop, so an error that cancels every three frames never accumulates.
- **The size of the flipbook itself**, read off the artwork's own `viewBox` — 640×360
  for anything up to 2026, 640×640 since, and 640×360 for any file that doesn't say
  (which is the whole archive). Sizes measured across the archive's distribution at
  640×360: 0.16 MB for a median flipbook, 0.81 MB at p90, 2.9 MB for the longest there
  is; a square page is 78% more pixels, so scale accordingly. There is deliberately no
  cap and no downscaling — the numbers are comfortable against a 100 GB/mo tier, and a
  flipbook served smaller than it was drawn is the wrong kind of surprise.

  This is the one surface where getting the size wrong fails *silently*: a square
  flipbook rasterised into a 16:9 buffer keeps its top 360 rows and drops the rest, and
  `/f/:id.gif` exists for other people's pages rather than for this one, so nobody here
  would ever see it. `lib/gif.test.js` asserts the ink below y=360 survives.
- **The GIF's own LZW is a flat `Int32Array`, not a Map.** Sixteen symbols means the
  whole dictionary is 65,536 slots and clearing between frames is a `fill(0)`; a
  200-page flipbook would otherwise build and discard millions of Map entries.
- **`gif.test.js` carries its own GIF decoder**, written to the specification rather
  than by mirroring the encoder — a decoder that shares the encoder's assumptions can
  only confirm that the file agrees with itself. It earned that immediately: the first
  version widened the code size one entry late, which is exactly the bug that makes a
  stream readable until the first width change and noise afterwards. The output is
  separately verified against Pillow, which nobody here wrote: 24 frames, looping,
  delays 80/80/90ms, and zero pixels differing from the rasteriser.

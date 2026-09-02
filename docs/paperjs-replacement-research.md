# Replacing paper.js: research

*2 September 2026. A decision document, not a rule: nothing here is implemented.
The rules that constrain any of it are in `CLAUDE.md`; the engine it describes is
`docs/drawing-tool.md`.*

## The short version

- **paper.js is dormant, not dead.** 0.12.18 shipped July 2024 and nothing has been
  committed since. 374 open issues, 55 open pull requests, no statement from the
  maintainers about the future. An XSS in `importSVG` was disclosed publicly in March
  2026 after, the reporter says, a year of ignored private disclosure, and it is still
  unanswered and unfixed.
- **That XSS is live in this app today.** Confirmed with a test, below. The fix is two
  lines and independent of everything else in this document.
- **There is no library to swap in.** Everything with paper's feature depth is bigger;
  everything smaller drops the pieces the engine leans on. And the engine uses a very
  small slice of paper: polylines, layers, hit-testing, affine transforms, SVG and JSON
  serialisation, and the tool event system. No curve fitting, no smoothing, no boolean
  operations, no rasters.
- **Writing our own is the realistic option**, and less of one than it sounds: three
  paper-free readers of the artwork already exist in the repo and one of them is
  measured pixel-identical to paper. What is left to write is roughly 2,000 lines of
  TypeScript, all testable in Node. Forking paper is a day to get building on modern
  tooling and a lifetime of owning 34,000 lines we use 5% of.
- **The things we would fix are the things `pointer.ts` already fights**: pointer
  events with ids and pressure, a coordinate space that is not the element's size, a
  renderer we call rather than one that schedules itself, and a file format we write
  rather than one we post-process.

## 1. Where paper.js stands

| | |
|---|---|
| Latest release | 0.12.18, 17 July 2024 (0.12.17 Nov 2022, 0.12.16 Oct 2022, 0.12.15 Mar 2021) |
| Last commit on `develop` | 17 July 2024, the release itself |
| Open issues / PRs | 374 / 55 |
| Maintainers | Jürg Lehni and Jonathan Puckey, no company, no sponsor |
| Last maintainer statement | Dec 2021, a core contributor on the mailing list: "not the most alive project nowadays but it's not dead" |
| Build | gulp 3 + a custom preprocessor; the TurboWarp fork's README says it only builds on Node 18 |
| Module format | UMD only. No ESM, no `exports`, no tree-shaking (issue #1844, open since 2020, no reply) |
| Pointer events | Issue #1354, open since 2017. The code path that would use them tests `navigator.pointerEnabled`, which no browser has shipped since 2014, so it is dead code |
| Security | #2100, XSS via `importSVG`, all versions since 0.9.12, open since March 2026 |

It is still downloaded 190,000 times a week, and the projects that depend on it
heavily have forked it rather than left it: Scratch (2017, `@scratch/paper`, a 0.11
line last published 2022), TurboWarp (`@turbowarp/paper` 0.13.0, March 2026, which
sandboxes `importSVG` in a CSP'd iframe and strips PaperScript, tweening and URL
loading), Kittl (`@kittl/paper` 0.12.30, changes undocumented). I found no project that
has documented moving *off* paper to something else. There is one TypeScript port of
the path geometry, `gluck/paper-core`, 22 commits all on one day in May 2026, zero
stars, not on npm. Nothing to build on.

A third-party report from June 2026 says React 19.2's dev-mode render logging walks
paper's enumerable prototype getters on removed paths and throws. Dev-mode only, and
I have not reproduced it here, but it is the shape of thing to expect from now on: the
world moves and paper does not.

## 2. The XSS, and that it reaches us

paper's `importSVG` wraps whatever element it is given in a container and appends it to
`document.body` so that computed styles resolve. It does that before checking whether it
has an importer for the element, so a `<foreignObject>` holding `<img onerror=…>` runs
script the moment it is attached.

The engine avoids `importSVG` for the three stroke elements it knows (`path`,
`polyline`, `line`) and falls back to it for anything else, in
`FlipbookEngine.buildStroke`. The save endpoint accepts any string beginning with
`<svg`, anonymously, and the loader hands every child of every page group to
`buildStroke`. So a flipbook saved with a `<foreignObject>` in a page group runs
attacker script for anyone who opens it on the playback page or remixes it. Admin mode
keeps its token in `localStorage`, which is what such a script would take.

Reproduced under jsdom: parsing a page group containing the payload, `strokeGeometry`
returns null, `layer.importSVG(element)` appends markup containing `onerror` to
`document.body`. The test was not committed.

**The fix**, whichever way the larger decision goes:

- `buildStroke` returns null for an element it does not recognise, which is what the
  gallery's `svgPageStrokes` already does. Across 594 flipbooks and fourteen years there
  has never been a fourth element, so the fallback has never fired legitimately.
- Optionally, reject unknown elements at save time in `createFlipbook`, using the tag
  scanner `lib/thumbnail.js` already runs over the file.

Unverified: whether `time-capsule`'s paper 0.8 has the same behaviour. The report says
0.9.12 onward; the 0.8 importer is older code and I have not read it.

## 3. What the engine actually uses

Tallied over `src/flipbook`:

| Used | Not used |
|---|---|
| `Path` as a polyline: `add`, `segments`, `removeSegments`, `addSegments` | `simplify()`, `smooth()`, `flatten()` (semantics changed in 0.12; reimplemented as `resamplePolyline`) |
| `Point`, `Rectangle`, `Size` arithmetic | Boolean operations (the one `.unite` is `Rectangle.unite`) |
| `Layer`, `Group`, `clone`, `translate`, `rotate`, `scale` about a pivot | `Raster`, `Symbol`, `PointText`, gradients, blend modes, tweening |
| `hitTest` with `segments` (eraser) and `stroke` + tolerance (selection) | Curves with handles: every stroke the tool has ever written is straight segments |
| `Path.Rectangle`, `Path.Circle`, `Path.Line` for the selection box, marquee, push dots | PaperScript, `view.zoom`, `onFrame` |
| `project.exportSVG`, `Layer#exportJSON` / `importJSON` (undo), `PathItem.create(d)` (load) | `importSVG` except as the fallback above |
| `Tool` with `onMouseDown/Drag/Move/Up`; `view.viewSize`, `view.update`, `view.getEventPoint` | |

Half the library by line count is path geometry we never call: `PathItem.Boolean`,
`Curve` intersections, `PathFitter`, `CurveLocation`, `CollisionDetection`, about 4,500
lines before comments. The parts we do call are the parts that are easy to write.

And the repo already has three readers of the artwork that do not use paper:

- `src/flipbook/preview/` renders any page to a 2D canvas in 79 lines, measured
  pixel-identical to paper on both formats.
- `lib/thumbnail.js` scans the file for the server without a parser.
- `lib/gif.js` rasterises it in Node with a distance test, including cubic subdivision
  for path data.

Plus `engine/formats.ts`, which knows both formats, all three stroke vocabularies and
the leading-three-groups contract, and has never imported paper. The hard part of a
replacement, reading fourteen years of files correctly, is done and tested.

## 4. Options

### A. Stay, and contain it

Fix the XSS, pin the version, accept that nothing upstream will change. Cost: an
afternoon.

What it costs over time is already visible. `pointer.ts` is 2,284 lines, and its
existence is that paper reads `targetTouches[0]`, has one drag in flight, cannot see a
second contact and binds `mousedown` to the canvas in its own constructor. Every one of
the thirteen drawing modes in `drawing-modes.md` is built around paper rather than
with it. `Scene.pinCoordinates` wraps `getEventPoint` and strips paper's inline styles
because paper takes the project's size from the element's bounding box. The history
strips names because paper uniquifies them on every insert. Pressure and tilt from an
Apple Pencil are unreachable because the pointer-events code path is dead. Each new
thing you want from the drawing surface is another workaround of that kind.

### B. Another library

None is a drop-in, and the interesting finding is that they all fail in the same way:
the ones with paper's depth are bigger, the ones that are smaller lack what we use.

| Library | Wire size (gz) | What it lacks for this app |
|---|---|---|
| paper.js core, today | 72 KB | baseline |
| Fabric.js 7.4 | 92 KB, barely tree-shakeable | Bigger. No pressure. SVG export is Fabric's own structure, not ours |
| Konva 10.3 | 39 KB for Core + Line + Path | No SVG export at all. Hit-testing is pixel-based via a colour-keyed canvas. Its freehand recipe erases with `destination-out`, a raster eraser |
| Two.js 0.8 | 50 KB | No hit testing. Not tree-shakeable |
| SVG.js 3.2 | 30 KB | SVG DOM only: every thumbnail is serialise, `Image`, `drawImage`. A thin wrapper over what the DOM gives free |
| PixiJS 8 | 147 KB tree-shaken | WebGL/WebGPU only: a GPU context per strip thumbnail, against the iOS canvas budget already documented |
| tldraw 5 | 229 KB for the editor | Source-available with a licence key required in production. A whiteboard, not a page tool |
| CanvasKit (Skia) | 2.9 MB | The best geometry of anything here, at forty times the size |
| perfect-freehand 1.2 | 2 KB | Not an engine. Produces a filled outline polygon, which is a different artwork format from 585 flipbooks of stroked polylines |
| Rough.js, p5, Pencil.js, Zdog, Snap, Raphaël, resvg, vello, lyon | | Wrong kind of thing, dead, LGPL, or no JS bindings |

Any of the plausible ones (Konva, Two, SVG.js) means rewriting `scene.ts`,
`selection.ts`, the four tools, `history.ts` and `clipboard.ts` against a new model,
which is the same work as writing our own, and then writing the SVG exporter that
satisfies `assertLeadingGroups` and `pageSizeFromSvg` anyway, because none of them
writes our file. You would do all the work of option D and still carry a scene graph
designed for someone else's product.

### C. Fork paper.js

I had an agent test this concretely. The custom preprocessor is 130 lines and MIT; a
12-line script driving it plus esbuild reproduces `paper-core.min.js` at parity (207 KB
vs 208 KB) and produces a working ESM bundle. Replacing gulp is a day.

What a fork does not give you is tree-shaking. Everything lives in one closure, classes
are built at runtime with `Base.extend` from straps.js, and the only static switches
are the preprocessor's: drop `svg` (1,300 lines), `booleanOperations` (1,400),
`paperScript` (700 plus acorn). That is the whole of the saving available without
rewriting the class machinery, which is a rewrite.

The fixes you would actually make in a fork are all in the thin layers, `View.js`,
`DomEvent.js`, `Tool.js`, `SvgImport.js`, `SvgExport.js`, and each is a few dozen lines
in files we understand, but the price of them is owning the other 33,000 lines,
written in a preprocessor dialect, with 374 open issues, on a build that needs Node 18.
TurboWarp's fork is the honest version of this option: they hardened by *removing*
things, not by modernising, and their README documents the toolchain rot.

A fork makes sense if you want paper's geometry: boolean operations on cubic Béziers
exist nowhere else in JavaScript at any size. The product does not want them.

**Interim option, unverified:** `@turbowarp/paper` 0.13.0 has the XSS fix. It descends
from Scratch's fork of the 0.11 line, so its API against our 0.12.18 workarounds
(`flatten` semantics, `insertAbove`, `hasFill`, `importJSON`) would need checking
before swapping the dependency. Our own two-line fix is cheaper and certain.

### D. Write our own

What has to exist, and where a start already is:

| Piece | Lines, roughly | Already have |
|---|---|---|
| Point, rectangle, matrix arithmetic | 150 | `engine/geometry.ts` has part |
| Stroke: points + width; page: strokes; flipbook: pages | 100 | |
| Renderer to any 2D canvas, at any scale | 100 | `preview/render.ts`, pixel-identical |
| Hit test: nearest point on a polyline within tolerance, nearest segment | 80 | `lib/gif.js` has the distance test |
| Transforms: translate, rotate about centre, scale about a pivot, mirror | 100 | `tools/transform.ts` has the arithmetic |
| Pointer input: `pointerdown/move/up` with capture, ids, pressure, coalesced events | 150 | `pointer.ts` knows the gestures |
| Selection as a flag on a stroke, drawn differently, not moved between layers | 150 | |
| Guides: selection box, marquee, push dots, drawn straight to the canvas | 100 | |
| SVG writer emitting exactly the current file: root with `viewBox`, three leading `<g>`, one `<g fill="none" stroke=… stroke-width=…>` per page, `<path d="M…l…">` per stroke | 120 | `assertLeadingGroups`, `pageSizeFromSvg`, the server scanner and `time-capsule` are the tests |
| Path-data reader for M/L/l/H/V/C/c/Z into points | 100 | `lib/gif.js` has one, in plain JS |
| Undo as arrays of points, clipboard | 150 | `history.ts` keeps its stack and page-id logic |
| Tools rewritten against the above | 600 | `tools/*` keep their behaviour |

About 1,800 to 2,500 lines of TypeScript, no runtime dependency, all of it unit-testable
without a canvas context or jsdom's Proxy stub. The chunk would be on the order of 10 KB
gzipped against 72, small enough to precache, which makes the drawing tool work offline
on a first visit rather than after one online one.

Risks, honestly:

- **Fidelity is the whole job.** The transform tool's feel, rotation about the box's
  centre, scale about the opposite handle, the mirror when a drag crosses the pivot,
  the eraser's bite, the push tool's falloff: these are behaviours, and behaviours drift
  in a rewrite. The mitigation is the one the repo already uses: pixel-diff the
  renderer against paper on the corpus, byte-diff `exportSVG` against the new writer on
  every flipbook in the database, and keep paper in the tree behind a flag until both
  are zero.
- **The file format is the real constraint, not paper.** `time-capsule` reads the file
  with paper 0.8, the server scans it without a parser, and the archive depends on
  three leading groups. A new engine must write the old file. That is a feature, not a
  cost: it is a small, exact contract with two readers you control and one you don't.
- **Pressure is a format question too.** Pointer events give you `pressure` for free,
  but the file has one `stroke-width` per element. Variable-width strokes mean either
  a new stroke vocabulary that `time-capsule`, the GIF rasteriser and the gallery all
  have to learn, or a filled outline (what perfect-freehand produces) which is a
  different kind of artwork. An engine of our own makes that decision *possible*; it
  does not make it free.
- **Hit testing at scale.** paper's own tracker has open issues about many items. A
  polyline engine with a bounds prefilter per stroke is faster than paper's general
  case, but the eraser's re-test-after-every-split loop should get a spatial check
  rather than a linear scan.

## 5. What we would want to change, whichever way

The list you asked for. Each is something paper prevents or taxes today, with where the
tax is paid.

1. **Pointer events, properly.** One stream, `pointerId` per contact, `pointerType`,
   `pressure`, `tiltX/Y`, `getCoalescedEvents()` for the samples a 120 Hz screen
   delivers between frames, `setPointerCapture` so a stroke that leaves the canvas still
   ends. paper: dead `pointerEnabled` branch, `targetTouches[0]`, one drag in flight.
   Paid in `pointer.ts` (2,284 lines), the capture-phase interception, `stopPropagation`,
   and the hidden-canvas trick in v11–v13.
2. **The coordinate space is a number we state.** 640 wide, whatever the element is.
   paper: measured from the bounding rectangle, with inline styles written on hidpi.
   Paid in `Scene.pinCoordinates`, the `getEventPoint` wrap, the `ResizeObserver`, and
   the rule that `view.zoom` must never be used because it folds into the export.
3. **Rendering is a function we call.** `render(page, canvas, scale)`. Thumbnails
   render the page directly instead of photographing the live canvas after
   `view.update()`; the strip's "owed thumbnails" mechanism goes away; the zoom stage
   is a second render, not a `drawImage` of the first.
4. **Selection is a flag.** Selected strokes are drawn blue over a faded page by the
   renderer, not physically moved into another layer. paper forced the 2013 model.
   Paid in `history.capture`'s normalisation (sort by id, repaint, strip names) and the
   staging-layer dance.
5. **We write the file.** The three leading groups become a line in the writer rather
   than an invariant enforced by an assertion over paper's output; `exportSVG` writing
   every layer, the staging layer, and the default-black-fill on import all go.
6. **Undo is data.** A page is an array of strokes; a step is two arrays. No
   `exportJSON` strings, no `importJSON` heuristics, no uniquified names.
7. **Untrusted input never touches the DOM.** The reader parses geometry out of a
   `DOMParser` document and builds nothing from it but numbers.
8. **No global scope.** paper registers a project and a view globally, which is the
   teardown ceremony in `useFlipbookEngine` and why the two paper routes can't coexist.
9. **Native TypeScript.** Not a 264 KB `.d.ts` generated from JSDoc with untyped
   corners (`getEventPoint`, the inline `hitTest` options).
10. **Size and offline.** ~10 KB gz, precached, no manual chunk, no "paper is the one
    thing the worker doesn't precache" rule, no risk that an import silently drags
    72 KB into the gallery.
11. **Testable in Node.** No canvas stub; geometry, hit tests, transforms and the writer
    are pure functions over arrays.
12. **Room for what the format can carry later**: per-stroke width from pressure,
    a second colour, both of which the current file could take with `time-capsule`
    still reading it, and neither of which paper stops you doing, but neither of which
    you would build on it either.

## 6. Recommendation

Two steps, and the first does not wait for the second.

**Now:** close the XSS by dropping the `importSVG` fallback in `buildStroke`, and
reject unknown elements at save. Pin `paper` at 0.12.18. Note in `CLAUDE.md` that
`importSVG` is not to be called on anything from the network.

**Then:** write our own engine, in stages, behind the `FlipbookEngine` API that React
already talks to, so the page and the store never know. The order that keeps every
step shippable and measurable:

1. Renderer and stroke model, used first for the strip's thumbnails and the zoom stage,
   diffed against paper's canvas on the corpus.
2. SVG writer, byte-diffed against `exportSVG` on every row in the database.
3. Hit testing and the eraser and pencil, the two simplest tools.
4. Selection, transform, push, clipboard, undo.
5. Delete paper, the manual chunk, the precache exception and `pinCoordinates`.

Do not fork. Do not switch libraries. The product draws polylines on a page and has
done since 2012; that is a small program, and the reason it is currently a large
dependency is history, not need.

## Sources

- paper.js repo, commits, issues: https://github.com/paperjs/paper.js — #2100 (XSS),
  #1354 (pointer events), #1844 (tree shaking), #1995, #2035, #1990 ("Is paper.js
  dead?"), #761 (boolean ops revamp), #2068, #1856
- npm registry data for `paper`, `@turbowarp/paper`, `@scratch/paper`, `@kittl/paper`
- TurboWarp fork: https://github.com/TurboWarp/paper.js
- Scratch fork: https://github.com/scratchfoundation/paper.js
- gluck/paper-core: https://github.com/gluck/paper-core
- Fabric 7.4.0: https://github.com/fabricjs/fabric.js/releases/tag/v740
- Konva changelog and comparison page: https://github.com/konvajs/konva/blob/master/CHANGELOG.md, https://konvajs.org/docs/guides/best-canvas-library.html
- Two.js: https://github.com/jonobr1/two.js
- perfect-freehand: https://github.com/steveruizok/perfect-freehand
- tldraw licence: https://tldraw.dev/community/license
- canvaskit-wasm: https://www.npmjs.com/package/canvaskit-wasm
- Sizes: bundlephobia API and local esbuild measurements (min / gzip / brotli), 2 Sep 2026
- Chunk sizes: `npm run build` on this branch, 2 Sep 2026: `paper-*.js` 209.29 kB, gzip 72.40 kB

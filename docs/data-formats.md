# Data formats

## The save contract

The save protocol was defined by 2013's `data.js`, and both the back end and the
rewritten front end conform to it rather than the other way round — because the 585
archive flipbooks were written by that code and have to keep working. It now lives in
`src/lib/api.ts`:

```ts
// api.ts, saveFlipbook()
const form = new URLSearchParams({
    title: payload.title,
    description: payload.description,
    project: payload.svg,                  // paper.js exportSVG(), serialised
    imgBase64: payload.thumbnailDataUrl,   // a PNG of the cover page
    cover: String(payload.cover),          // which page that is
    nsfw: payload.nsfw ? '1' : '0',
})

if (payload.remixOf) form.set('remix_of', payload.remixOf)  // what it was drawn on

const response = await fetch('/saveflipbook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
})

return (await response.text()).trim()      // <- a bare "/f/{id}"
```

So:

- The request is **`application/x-www-form-urlencoded`**, not JSON.
- The response is **a bare URL in a `text/plain` body**. Not JSON, no wrapper. It gets
  assigned directly to `window.location.href`.
- `cover` is new and additive. It is the index of the page the PNG is of, and the
  server cuts the SVG thumbnail out of that same page rather than picking one of its
  own — see **Thumbnails** below. Absent from a `time-capsule` save, and the server
  finds the busiest page itself when it is.
- `remix_of` is new and additive, and is **set only when it means something** — the
  field is absent from an ordinary save rather than sent empty. It is the id of the
  flipbook the drawing tool was opened on, which is what makes the save a remix. The
  server checks it exists and isn't `legacy-json`, and **drops the link rather than
  refusing the save** if either fails: a field that decides which page a flipbook gets
  listed on is not worth losing somebody's drawing over. Absent from a `time-capsule`
  save, which is the same thing as saying nothing saved over there is a remix.
- `draft` and `postID` are gone. Drafts needed an account to return to them with, and
  the server ignored both fields anyway.
- `nsfw` is honoured: flagged flipbooks keep working on their own URL but are left out
  of the browse grid, which is exactly what the original did with the `nsfw` category.

**Don't change this contract.** It's the 2013 endpoint, it is what the `time-capsule`
deployment still posts to, and both deployments share one database.

## Artwork: two formats

Both are still in the database and both still render.

### `svg` — 2013 onward

Output of paper.js `project.exportSVG()` run through `XMLSerializer`. One `<g>` per
page, in page order, each containing the strokes on that page:

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <g fill="none" id="1" stroke="rgb(68, 68, 68)" stroke-width="1" .../>
  <g fill="none" id="2" stroke="none" .../>
  <g fill="none" id="3" stroke="rgb(68, 68, 68)" stroke-width="10"
     stroke-linecap="round" stroke-linejoin="round">
    <polyline points="453,189 448.9,187 444.0,187 ..." id="19691_19709 1"/>
    ...
  </g>
</svg>
```

The first three groups are paper.js's system layers (guide, undo, selection); real
pages start at index 3. `parseSvgPages()` skips the same three, which is why the
numbering looks off — see `LEADING_SYSTEM_GROUPS` in `src/flipbook/engine/formats.ts`,
and `assertLeadingGroups()`, which refuses to save an export that doesn't match.

Loading parses the file with `DOMParser` and imports each stroke with
`layer.importSVG()`. Two things bite here and both are handled at the point they
matter: the strokes' `fill="none"` lives on the `<g>`, not on each polyline, so an
imported stroke comes back filled black unless the fill is cleared; and `stroke-width`
is inherited the same way, so it's reapplied per stroke from the group's value.

### `legacy-json` — 2012

The original format, before the SVG export existed. Raw paper.js layer/segment JSON:

```json
{"layers":[
  {"children":[]},
  {"children":[]},
  {"children":[
    {"segments":[{"x":"466.0","y":"83.0"},{"x":"470.7","y":"83.0"}, ...]}
  ]}
]}
```

Same three leading system layers. There are no paths, only point lists — so
there is nothing to import, so it is **replayed stroke by stroke through the pencil**
— `begin()`, `extend(point)` per segment, `end()`. It is genuinely re-drawing the
animation, though you no longer watch it happen: pages after the first are built on
layers that aren't showing, so playback can start on the pages that have landed while
the rest are still arriving. The replay yields in frame-sized slices rather than one
page per `setTimeout(0)`, which is what the 2013 loader did.

147 of the 585 archive pieces are in this format.

### Serving them

`/api/flipbooks/:id/data` picks the content type from the stored `format`:

| Format | Content-Type | Why |
|---|---|---|
| `svg` | `image/svg+xml` | It is an SVG |
| `legacy-json` | **`text/plain`** | 2013's jQuery parsed `application/json` before the client saw it, and `JSON.parse(object)` throws |

The original served these as WordPress attachments — `.xml` and `.txt` respectively —
which is where those content types come from. `time-capsule` still depends on the
legacy one being `text/plain`; getting it wrong breaks every 2012 flipbook there,
silently, only on those rows.

The rewritten client doesn't depend on either. `getFlipbookData()` returns the response
as text and the caller picks a parser from the flipbook's `format` field, which is the
thing that actually knows.

### The load race, and how it went away

There used to be a second, subtler way to break exactly the same set of rows.

2013's `data.js` scheduled the legacy pencil's setup with `_.defer()` while
`Flipbook.js` started the artwork fetch synchronously in the same constructor. In 2013
the fetch always lost — WordPress took tens of milliseconds to serve a file — but a
local dev server or a warm CDN edge answers in about 3 ms, the fetch won, and the
resulting `TypeError` was swallowed inside jQuery's success handler. Every 2012
flipbook sat on the spinner forever.

The revival worked around it in `boot-playback.js` without touching the original. The
rewrite doesn't have the race at all: the playback page awaits the artwork and then
awaits the replay, and both are ordinary promises. **`time-capsule` still has it, and
still has the workaround** — don't collapse that deferral back into the constructor
over there.

Faster infrastructure exposing a latent 2013 race is a fun way to lose an afternoon.

## Thumbnails

A flipbook is stored with two of them and the gallery shows the second:

| Column | What | Served as |
|---|---|---|
| `thumbnail` | a 640×360 PNG of the cover page | `/api/flipbooks/:id/thumbnail` |
| `thumbnail_svg` | that same page as a standalone SVG, brotli'd | `/api/flipbooks/:id/thumbnail.svg` |

On a real row those are 10,060 bytes and 718. The SVG is also vector, so it is sharp at
whatever size a card happens to be rather than resampled from a fixed grid of pixels.

**The PNG is not going anywhere.** `time-capsule` reads that column and serves it as
`image/png`, and both deployments share one database — so it is written on every save
from this branch too. It is also the fallback for every row without an SVG: a
`time-capsule` save, a `legacy-json` flipbook (point lists, with no paths anywhere in
it to take a page out of), or anything `npm run db:backfill-thumbnails` hasn't reached.
The listing says which a card should ask for; `thumbnail_svg_url` is null when there
isn't one.

`lib/thumbnail.js` is the whole of how a page is lifted out, and it is text in and text
out because both callers are Node — the save path and the backfill. It works because a
page group carries its own paint in both stroke vocabularies, in 0.8
(`stroke="rgb(68, 68, 68)"`) as in 0.12 (`stroke="#444444"`); what it strips is the
`visibility` every page but the last one saved is wearing, the `opacity` the onion skin
leaves on the page behind the one being drawn on, and the stroke ids, which nothing
reads. Verified rather than assumed: the lifted page and the whole artwork rasterised at
640×360 differ by 0 pixels of 230,400.

The PNG is written by `src/flipbook/engine/png.ts` rather than by `canvas.toDataURL`,
which is 8-bit RGBA and picks its filters for speed. A cover is grey ink on white paper,
so 8-bit greyscale is lossless here and between a third and a half the size.

## Storage

Everything is stored compressed into `bytea`, twice — gzip at level 9 in `data_gz`,
brotli at quality 11 in `data_br` — and served back with whichever `Content-Encoding`
the client asked for. See `docs/architecture.md` for why both, and why brotli is worth
so much more than usual on this particular data.

Measured over the archive: **247 MB of artwork → 62 MB of gzip → 18 MB of brotli.**
Add 12 MB of thumbnails and the table is about 92 MB on disk, holding both copies.

Size distribution of the archive artwork, uncompressed:

| | |
|---|---|
| median | 120 KB |
| p90 | 1.0 MB |
| max | 9.2 MB |
| mean | 443 KB |

## The ~4 MB save ceiling

Vercel caps serverless request bodies at 4.5 MB. Form encoding inflates SVG
noticeably — `<`, `>`, `"` and spaces all become three characters — so the practical
limit is somewhere around a 2.5 MB drawing.

`lib/http.js` enforces 4 MB on the stream and `lib/flipbooks.js` enforces 3 MB on the
decoded SVG, both returning `413`. The create page recognises that status and says
"that flipbook is too big to save, try deleting a few pages" rather than the generic
failure, which is at least actionable.

Judging by the archive, this would have affected roughly 5% of historical flipbooks —
the very long ones. Raising it means either compressing client-side before POST or
moving the upload to object storage with a presigned URL. Neither is worth it until
someone actually hits it.

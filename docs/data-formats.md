# Data formats

## The save contract

`public/script/flip/data.js` is original 2013 code and has not been touched. It
defines the save protocol, and the back end conforms to it rather than the other way
round.

```js
// data.js, send()
$.ajax({
    type: "POST",
    url: "/saveflipbook",
    data: {
        title:       flip_title,
        description: flip_desc,
        project:     flip_xml,      // paper.js exportSVG(), serialised
        imgBase64:   thumbnail,     // canvas.toDataURL("image/png")
        nsfw:        isNSFW,
        draft:       is_draft,
        postID:      post_id
    }
}).done(function(msg) {
    window.location.href = msg;     // <- the response body IS the redirect target
});
```

So:

- The request is **`application/x-www-form-urlencoded`**, not JSON.
- The response is **a bare URL in a `text/plain` body**. Not JSON, no wrapper. It gets
  assigned directly to `window.location.href`.
- `draft` and `postID` are vestigial. Drafts needed an account to return to them with,
  so the draft button is hidden by `revival.css` and these fields are ignored.
- `nsfw` is honoured: flagged flipbooks keep working on their own URL but are left out
  of the browse grid, which is exactly what the original did with the `nsfw` category.

**Do not change this contract without changing `data.js`, and don't change `data.js`.**

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
pages start at index 3. `data.js` `draw_page()` starts its loop there, which is why
the numbering looks off by three.

Loading is fast: `data.js` `load_xml()` drops the markup into a hidden `#svg` div and
`canvas_layer.importSVG()` reads each element back into paper.js.

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
`data.js` `load_legacy()` cannot import it, and instead **replays every stroke through
the pencil tool**, calling `beginDraw()`, `dragDraw(point)` per segment, `endDraw()`.
It's slow on big flipbooks and it is genuinely re-drawing the animation as you watch.

147 of the 585 archive pieces are in this format.

### Serving them

`/api/flipbooks/:id/data` picks the content type from the stored `format`:

| Format | Content-Type | Why |
|---|---|---|
| `svg` | `image/svg+xml` | jQuery `.load()` treats it as HTML and the parser handles SVG foreign content |
| `legacy-json` | **`text/plain`** | `data.js` calls `JSON.parse()` on the response itself. If jQuery sees `application/json` it parses first, and `JSON.parse(object)` throws. |

The original served these as WordPress attachments — `.xml` and `.txt` respectively —
which is where those content types come from. Getting the legacy one wrong breaks
every 2012 flipbook, silently, only on those rows.

### The load race

There is a second, subtler way to break exactly the same set of rows.

`data.js` `initialize()` schedules the legacy pencil's setup with `_.defer()`, but
`Flipbook.js` calls `data.load()` synchronously inside the same constructor — so the
fetch is already in flight before the pencil exists:

```js
// data.js
} else {
    _.defer(this.init_legacy_pencil);        // pencil ready on the next tick
}
...
legacy_draw_page: function(page_index, nodes) {
    ...
    this.legacy_pencil.beginDraw();          // throws if the fetch got here first
```

In 2013 this never lost: the artwork was a file served by WordPress over a real
network, taking tens of milliseconds. A local dev server or a warm CDN edge answers in
about 3 ms, which beats the deferred setup, and the resulting `TypeError` is swallowed
inside jQuery's success handler. The page just sits on the spinner forever.

`boot-playback.js` sidesteps it without touching `data.js`: the Flipbook is
constructed with **no** `data_json`/`data_xml`, so the constructor's `load()` returns
immediately, and the boot code sets the URL and calls `load()` itself one tick later.

Faster infrastructure exposing a latent 2013 race is a fun way to lose an afternoon.
Don't collapse that deferral back into the constructor.

## Storage

Everything is gzipped at level 9 into a `bytea` column and served back with
`Content-Encoding: gzip`. See `docs/architecture.md` for why.

Measured over the archive: **247 MB of artwork → 62 MB stored**, about 25%. Add 12 MB
of thumbnails and the table is 77 MB on disk.

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
decoded SVG, both returning `413`. `data.js`'s `.fail()` handler shows the "Oh no!
Something went wrong" message, which is the right user-facing outcome even if it isn't
a specific one.

Judging by the archive, this would have affected roughly 5% of historical flipbooks —
the very long ones. Raising it means either compressing client-side before POST (which
would mean editing `data.js`) or moving the upload to object storage with a presigned
URL. Neither is worth it until someone actually hits it.

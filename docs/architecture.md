# Architecture

## What this is

Thumbcinema is a flipbook animation tool. You draw a sketch on a canvas, add a page,
draw the next one — the previous page shows through as onion skin — and then play the
result back. A distinctive playback mode lets you scrub the animation by circling the
mouse: clockwise runs it forward, anticlockwise back, and how fast you circle is how
fast it plays.

It was built solo between 2012 and 2015, designed in Photoshop and built on
Backbone.js. The [write-up is here](https://alexduckmanton.com/article/thumbcinema).

## What changed, and when

The revival replaced everything behind the front end and left the front end alone.
The rewrite that followed replaced the front end too, without changing the product.

### Then (2012–2015)

WordPress, with BuddyPress bolted on for accounts, and a custom theme doing the
actual work:

- **Storage** — saving a flipbook created a WordPress *post*, wrote the artwork to a
  file in `wp-content/uploads/`, and attached that file to the post. The thumbnail
  was a second attachment. Likes, view counts and NSFW reports were rows in
  `postmeta`. Drafts, NSFW and "featured" were *categories*.
- **Auth** — BuddyPress. Registration, login, profiles, avatars.
- **Endpoints** — a handful of PHP page templates acting as ad-hoc API endpoints:
  `saveflipbook.php`, `likeflipbook.php`, `reportflipbook.php`, `publishflipbook.php`,
  `deleteflipbook.php`, `signon.php`, `updateprofile.php`.
- **Rendering** — `index.php` looped posts into the browse grid, `single.php` inlined
  a flipbook's attachment URLs into a `<script>` block for Backbone to pick up.

It worked, but it meant paying for PHP + MySQL hosting to run what is essentially a
static site with a save button. When the hosting bill stopped being worth it, the
server went off.

### Now

```
                       Vercel CDN
browser ──────────────> dist/index.html, /assets, /fonts, /images   static
        │
        ├── everything ─> /index.html                               rewrite
        │
        └── /api/*  ────> api/index.js ─> lib/router.js ─> Neon Postgres
            /saveflipbook
```

- **Front end**: a single-page app. React 19 + TypeScript, built with Vite; paper.js
  0.12 for the drawing. Four routes, lazily loaded, with paper in a chunk of its own
  so the gallery never downloads it.
- **Back end**: one Node serverless function and one Postgres table.
- **Accounts**: gone. Saving is anonymous.
- **Social layer**: gone. No likes, reports, profiles, avatars or drafts.

Both halves fit inside free tiers.

The 2013 front end still runs, unchanged, on the `time-capsule` branch and against the
same database — which makes it the reference for any question about how the old
behaviour worked.

### The one thing the two deployments cannot share

`time-capsule` draws into a hard-coded 640×360 paper project and has no concept of a
`viewBox`. Since 2026 this branch also saves 640×640 flipbooks, and there is no additive
change that teaches a frozen front end about a second page shape.

The schema half is fine. `width`/`height` are additive with a `DEFAULT` that is the right
answer for every row that predates them, and `time-capsule`'s `createFlipbook()` doesn't
mention them, so its saves land at 640×360 — which is genuinely what they are. Nothing
about the data is wrong in either direction.

**The rendering half is left alone deliberately.** A square flipbook over there is
cropped, not broken:

- **Its card** shows the middle of the drawing. The 2013 tiles are fixed sizes painted
  with `background-size: cover`, so a 640×640 PNG fills the width and overflows the
  height.
- **Playing it** shows the top 56%. `flip/canvas.js` is a 640×360 element and
  `flip/data.js` does `importSVG` per page, so coordinates below y=360 are simply
  outside the viewport.

Nothing throws, nothing 404s, no image breaks. Filtering those rows out of that
deployment's gallery was considered and rejected: it would mean editing the branch whose
entire job is to be frozen, and it would break the property that sharing one database
exists to provide — a flipbook saved in either version appears in both. A cropped card on
a reference exhibit is the cheaper of the two.

## Why one function

Every API path is rewritten to a single `/api` function in `vercel.json`:

```json
{ "source": "/api/:path*", "destination": "/api?__path=/api/:path*" }
```

Three reasons:

1. **One cold start.** Splitting six routes across six functions means six things to
   warm up, on a site that gets bursty portfolio traffic.
2. **One router.** `lib/router.js` is called identically by `api/index.js` on Vercel
   and by the Vite dev server's middleware locally (see `vite.config.ts`). There is no
   adapter, and no class of bug where local and production disagree about routing.
3. **Plain Node types.** Because handlers take raw `IncomingMessage`/`ServerResponse`
   and never touch `req.query` or `req.body`, they'd run on any Node host. Vercel is
   a deployment choice, not an architectural one.

The `__path` query parameter exists so routing never has to guess whether a given
platform preserves the original URL through a rewrite. It's passed explicitly.

## Why compressed blobs in a bytea column

The obvious alternatives were object storage (Vercel Blob, S3, R2) or static files
committed to the repo.

paper.js exports SVG as long `<polyline points="...">` runs — thousands of
`x,y` pairs, all similar magnitudes, comma separated. It is close to a best case for
DEFLATE and compresses to about **25%** of its original size. That takes the archive
artwork from 247 MB to 62 MB; with thumbnails the whole table is 77 MB, which fits
Neon's 0.5 GB free tier with room to spare.

So there's no object store, no second set of credentials, no lifecycle rules, and no
consistency question between "the row exists" and "the file exists".

### And why brotli beside it

Every row is stored twice — `data_gz` and `data_br` — and `sendFlipbookData` hands back
whichever the client's `Accept-Encoding` asked for: brotli first, gzip if it won't take
brotli or the row hasn't got one. Neither is ever decompressed server side; the only time `gunzip`
runs is the rare client that advertises no encoding at all.

Brotli takes the same 62 MB down to **18 MB**, and not a coordinate of it changes.
That is a much wider gap than the 15–20% brotli usually opens over gzip on text, and
the reason is what this data is. A flipbook is the same drawing forty times over, with
each page differing from the last by one stroke — so nearly all of the redundancy in
the file is *between* pages rather than within one. DEFLATE's window is 32 KB against
files that run to nine megabytes, so it can never see two pages at once; brotli's
window reaches 16 MB and matches page against page. The biggest archive flipbook goes
from 4.1 MB of gzip to 232 KB.

Per file it ranges from about 20% off a small one to 95% off the largest. What it buys
in practice is the gallery: a card that plays under the pointer has to fetch its
artwork, and the first page of Featured went from 5.0 MB to 1.75 MB, median card 45 KB.

Both copies are kept because `time-capsule` reads `data_gz` directly and knows nothing
about the other column — see the note in `db/schema.sql`. `data_br` is nullable for
the same reason: a save made on that branch simply doesn't have one, and is served as
gzip. `npm run db:backfill-brotli` fills in whatever is outstanding and is safe to
re-run, and is what to run after an archive import — which deliberately nulls `data_br`
on the rows it replaces rather than leaving a brotli copy of artwork that is no longer
there. Getting that wrong would serve one drawing to everyone who takes brotli and a
different one to everyone who doesn't, which is invisible from either side.

A brotli copy is only written when it is **smaller**. On the very smallest rows it isn't,
and those keep `data_br` null on purpose — the same rule the two thumbnails follow.

Artwork is immutable (a flipbook is never edited), so `/data`, `/thumbnail` and
`/thumbnail.svg` are served with `Cache-Control: immutable` and the CDN absorbs repeat
traffic.

### And why a card shows an SVG rather than the PNG

The same reasoning one step further: a thumbnail is one page of a flipbook, and one page
of a flipbook is a few hundred coordinates. Stored as the drawing rather than as pixels
it is 718 bytes where the PNG of it is 10,060, and it is sharp at whatever size the card
is drawn at. Both are kept — the PNG is what `time-capsule` serves and what every row
without an SVG falls back to. See [`data-formats.md`](data-formats.md).

## Where PHP used to be

| Old | New |
|---|---|
| `header.php` + `sidebar.php` + `footer.php` | `src/components/SiteHeader.tsx` |
| `index.php` (WP loop, `cat=6`, prev/next links) | `src/routes/gallery/` — Featured/All tabs, infinite scroll |
| `single.php` (inlined post data) | `src/routes/playback/PlaybackPage.tsx` |
| `create.php` (inlined `window.onload`) | `src/routes/create/CreatePage.tsx` |
| `Mobile_Detect.php` (`$GLOBALS['isMobile']`) | `src/lib/device.ts` |
| Modernizr gate in `header.php` | `<script nomodule>` in `index.html` |
| `saveflipbook.php` | `lib/router.js` → `lib/flipbooks.js` |
| `likeflipbook.php`, `reportflipbook.php`, `deleteflipbook.php`, `publishflipbook.php`, `signon.php`, `updateprofile.php` | dropped |
| `functions.php` view counter | `UPDATE ... RETURNING` in `getFlipbook()` |

The 2025 revival duplicated the header markup into three static HTML files, because
there was no build step to share it with. There is one now, and it's a component.

## Known limitations

- **No server-rendered Open Graph tags.** Shared links to `/f/{id}` don't preview with
  the flipbook's own thumbnail, because the page is a static shell and the title
  arrives by fetch. Fixing it means putting a function in front of `/f/:id` to inject
  meta tags — the shell stays, only the `<head>` becomes dynamic.
- **No server rendering at all.** The gallery is a fetch behind an empty grid, which
  costs a beat on a cold load. Worth revisiting only if the site ever needs to be
  found by something that doesn't run JavaScript.
- **~4 MB save limit**, imposed by Vercel's request body cap. See [`data-formats.md`](data-formats.md).
- **No rate limiting** on save. Deliberate, matching the original. `saveFlipbook()` in
  `lib/router.js` is the single place a throttle would go. New saves default to not
  featured, so the worst case is junk on the All tab rather than the front page, and
  admin mode's NSFW toggle pulls anything from both tabs.
- **Admin auth is one shared secret**, not accounts. Proportionate for one
  administrator toggling two booleans, and accounts are precisely what this rebuild
  deleted. It fails closed: no `ADMIN_TOKEN`, no admin API.

## Code splitting

paper.js is ~210 KB and only two of the four routes need it, so the routes are lazy
and paper is a manual chunk. The gallery — the page most visits land on — downloads
neither. Check this hasn't regressed after touching imports: `npm run build` prints
the chunk table.

**A lazy route waits for everything its chunk statically imports, and that used to
include paper.** `scene.ts` imported it at the top, so `import('./routes/playback/…')`
did not resolve — and the metadata and artwork fetches *inside* that route did not
start — until 71 kB gzipped of paper had downloaded and evaluated. It was 77% of the
playback route's second wave and the whole of the wait people were watching. paper is
now fetched by `useFlipbookEngine` and passed down (see `PaperCore` in `scene.ts`), so
it is in no route's preload set and downloads alongside the artwork rather than in
front of it. The route's second wave went from 93 kB to 18 kB; from the gallery, where
the shared chunks are already in memory, from 88 kB to 15 kB.

The trap is that a plain `import` of anything large, anywhere under a route, silently
puts it back. The chunk table won't say so — paper is still its own chunk either way.
What to check is the entry bundle's dependency list for each route: nothing that only
the drawing tool needs belongs in it.

**The gallery's hover preview is split for the same reason and warmed rather than
awaited.** `FlipbookPreview` is `lazy()` and its chunk is 1.8 kB gzipped, but it drags
`engine/formats.ts` along with it — and that file is also in both paper routes' chunks,
so leaving it in the entry would have every visit to every page carry a copy of it. The
factory is named (`loadPreview`) so a page with cards on it can call it in an effect on
mount: by the time a pointer lands on a card the module is in memory and `lazy` resolves
out of the module cache, so the Suspense boundary never shows. What must stay true is
that neither the gallery's chunk nor the preview's reaches paper — `grep from\"
dist/assets/GalleryPage-*.js` after a build is the check, and today it is five imports,
none of them paper: the runtime, the entry, `Button`, the icon sprite and the card.

The *composition* is what to read, not the number. `lib/api.ts` used to be a shared
chunk of its own in that list; it is in the entry bundle now, because `main.tsx` starts
the offline queue and the queue posts saves — see [`offline.md`](offline.md). That
folded one chunk away and split the icon sprite out into another, for no change in what
the gallery downloads and no change in what it must not.

**The remix list on the playback page is `lazy()` for the same reason at a smaller
scale.** It brings the card and its gestures with it — 1.7 kB gzipped — and a plain
import would put that in the playback route's *preload set*, fetched in front of the
artwork on every visit to every flipbook in order to draw a list most of them haven't
got. `RemixList.tsx` exists to be that boundary; it is deliberately not warmed, because
it is below the fold and the fetch that decides whether it exists at all is slower than
the chunk. The check is the same one: `PlaybackPage-*.js` must not import the card.

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

## Why gzip in a bytea column

The obvious alternatives were object storage (Vercel Blob, S3, R2) or static files
committed to the repo.

paper.js exports SVG as long `<polyline points="...">` runs — thousands of
`x,y` pairs, all similar magnitudes, comma separated. It is close to a best case for
DEFLATE and compresses to about **25%** of its original size. That takes the archive
artwork from 247 MB to 62 MB; with thumbnails the whole table is 77 MB, which fits
Neon's 0.5 GB free tier with room to spare.

So there's no object store, no second set of credentials, no lifecycle rules, and no
consistency question between "the row exists" and "the file exists". The bytes go out
with `Content-Encoding: gzip` and are never decompressed server side — the only time
`gunzip` runs is the rare client that doesn't advertise gzip support.

Artwork is immutable (a flipbook is never edited), so `/data` and `/thumbnail` are
served with `Cache-Control: immutable` and the CDN absorbs repeat traffic.

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
- **~4 MB save limit**, imposed by Vercel's request body cap. See `docs/data-formats.md`.
- **No rate limiting** on save. Deliberate, matching the original. `saveFlipbook()` in
  `lib/router.js` is the single place a throttle would go. New saves default to not
  featured, so the worst case is junk on the All tab rather than the front page, and
  admin mode's NSFW toggle pulls anything from both tabs.
- **Admin auth is one shared secret**, not accounts. Proportionate for one
  administrator toggling two booleans, and accounts are precisely what this rebuild
  deleted. It fails closed: no `ADMIN_TOKEN`, no admin API.

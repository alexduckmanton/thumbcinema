# thumbcinema

Draw a sketch. Add a page. Draw the next one. Play it back.

Thumbcinema is an online flipbook animation tool, originally built solo between 2012
and 2015. You draw with a pencil on a canvas, the previous page shows through as onion
skin, and a playback mode lets you scrub the animation by circling the mouse —
clockwise runs it forward, anticlockwise back, and how fast you circle is how fast it
plays.

There are no labels, alerts or confirmation messages anywhere in it. New pages fly in
from the right, deleted ones fall off the bottom of the screen. That was the point.

**[Read the original write-up →](https://alexduckmanton.com/article/thumbcinema)**

---

## About this repository

The site ran on WordPress until the hosting stopped being worth paying for. The 2025
revival brought the original front end back, unchanged, on a new back end; this
version rewrites that front end without changing what it does or how it looks.

| | |
|---|---|
| **Front end** | React 19 + TypeScript, built with Vite. paper.js for the drawing. |
| **Back end** | One Node serverless function, one Postgres table. |
| **Hosting** | Vercel + Neon, both on free tiers. |
| **Gone** | WordPress, BuddyPress, accounts, likes, reports, profiles, drafts — and, now, jQuery, Backbone, Underscore, Modernizr and svg.js. |

The rewrite is a port rather than a redesign: the drawing tool behaves as it did in
2013, down to the way pages fly in and fall away. The 2013 code still runs, on the
`time-capsule` branch, against the same database.

It also carries the **585 flipbooks that survived** from 2012–2015. The database
backup turned out to be a zero-byte file, so the artwork made it and the titles,
authors and view counts did not. The home page's Featured list was reconstructed from
what's left — see [`docs/archive.md`](docs/archive.md).

The gallery has a **Featured / All** toggle and an infinite scroll. Featured is what
the 2013 home page showed; new saves start off it and are promoted by hand from admin
mode, which is a single token rather than a login.

## Quick start

```bash
npm install
cp .env.example .env     # paste a Neon connection string into DATABASE_URL
npm run db:migrate
npm run db:import-archive
npm run dev              # http://localhost:3000
```

For the curation toggles locally, set `ADMIN_TOKEN` in `.env` and visit
`http://localhost:3000/?admin=<that value>` once.

`npm run dev` is Vite with the real API mounted as middleware — no Vercel CLI, no
Docker, no second process. The drawing tool works without a database; the gallery and
saving need one.

Node 22.12 or newer — there's an `.nvmrc`, and the scripts will find an installed
version that works if the one on your `PATH` doesn't.

| Command | |
|---|---|
| `npm run dev` | Local server on :3000 |
| `npm run build` | Typecheck and build to `dist/` |
| `npm test` | Run the tests |
| `npm run lint` | Biome (`lint:fix` to apply what it can) |
| `npm run check` | Typecheck, lint and tests together |
| `npm run db:migrate` | Apply `db/schema.sql` (idempotent) |
| `npm run db:import-archive` | Import the 2012–2015 flipbooks |
| `npm run db:stats` | Row counts and storage use |

## Layout

```
index.html       the single page
src/
  routes/        gallery, create, playback
  flipbook/      the drawing tool — engine/ has no React in it
  components/    header, buttons, messages, admin toggles
  lib/           API client, admin token, device, messages
  router/        ~60 lines over the History API
  styles/        tokens, element defaults, the 2013 icon sprite
public/          fonts, images, favicons, sadbrowser.html
api/index.js     Vercel entry point
lib/router.js    the entire API
db/schema.sql    one table
scripts/         migrate, archive import, stats
docs/            the long-form documentation — one file per part of the app
_original/       the WordPress backups (gitignored, read-only, do not delete)
```

## Docs

- [`CLAUDE.md`](CLAUDE.md) — the map and the rules, and the index to everything below
- [`docs/architecture.md`](docs/architecture.md) — how it fits together, why WordPress went, and how the bundle is split
- [`docs/drawing-tool.md`](docs/drawing-tool.md) — the paper.js engine: the upgrade, loading, undo, the invariants
- [`docs/drawing-modes.md`](docs/drawing-modes.md) — thirteen answers to "a finger is opaque", and the one that ships
- [`docs/create-page.md`](docs/create-page.md) — the create page, tracing over a photograph, and playback
- [`docs/gallery.md`](docs/gallery.md) — the grid, the hover preview, and the play button
- [`docs/remixes.md`](docs/remixes.md) — editable copies, and how a lineage is stored
- [`docs/gif.md`](docs/gif.md) — `/f/:id.gif`, rendered in Node with no dependency
- [`docs/styling.md`](docs/styling.md) — the CSS conventions, the tokens, the type
- [`docs/data-formats.md`](docs/data-formats.md) — the save contract, the two artwork formats, thumbnails, storage
- [`docs/archive.md`](docs/archive.md) — what survived the old server
- [`docs/deployment.md`](docs/deployment.md) — Vercel + Neon setup

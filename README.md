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

This is the 2025 revival. The site ran on WordPress until the hosting stopped being
worth paying for; this version keeps **the original front end, completely unchanged**,
and replaces everything behind it.

| | |
|---|---|
| **Front end** | 2013 code, untouched — Backbone 1.0, Underscore, jQuery 1.9.1, paper.js 0.8. No build step. |
| **Back end** | One Node serverless function, one Postgres table. |
| **Hosting** | Vercel + Neon, both on free tiers. |
| **Gone** | WordPress, BuddyPress, accounts, likes, reports, profiles, drafts. |

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

`npm run dev` serves the site and mounts the real API — no Vercel CLI, no Docker. The
drawing tool works without a database; the gallery and saving need one.

| Command | |
|---|---|
| `npm run dev` | Local server on :3000 |
| `npm run db:migrate` | Apply `db/schema.sql` (idempotent) |
| `npm run db:import-archive` | Import the 2012–2015 flipbooks |
| `npm run db:stats` | Row counts and storage use |

## Layout

```
public/          the site. script/ and style/ are 2013 originals — see CLAUDE.md
  *.html         hand-converted from the old PHP templates
api/index.js     Vercel entry point
lib/router.js    the entire API
db/schema.sql    one table
scripts/         dev server, migrate, archive import
docs/            architecture, data formats, archive, deployment
_original/       the WordPress backups (gitignored, read-only, do not delete)
```

## Docs

- [`CLAUDE.md`](CLAUDE.md) — conventions, and the rule about not modernising the front end
- [`docs/architecture.md`](docs/architecture.md) — how it fits together, and why WordPress went
- [`docs/data-formats.md`](docs/data-formats.md) — the save contract and the two artwork formats
- [`docs/archive.md`](docs/archive.md) — what survived the old server
- [`docs/deployment.md`](docs/deployment.md) — Vercel + Neon setup

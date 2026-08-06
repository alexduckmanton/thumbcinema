# The archive

## What survived

Two backups of the old site were recovered:

- `_original/thumbcinema/` — a local working copy
- `_original/thumbcine.ma-wp-backup/html/` — a copy pulled off the server

They are **code-identical**: both git repositories sit on the same commit
(`aa9bca4 Update version number`) and the theme directories diff clean. The server
copy has more files in `wp-content/uploads/`.

From those uploads, **586 unique flipbooks** were recovered, of which **585 import
cleanly** — 438 in the SVG format, 147 in the legacy JSON format — along with a
thumbnail for every one of them. (One 2013 file is truncated JSON and is skipped.)

## What did not survive

**The database.** `_original/thumbcine.ma-wp-backup/thmbc_20130202.sql` is a
**zero-byte file**. The dump either never completed or was truncated on transfer.

Everything WordPress held in MySQL is therefore gone:

- flipbook titles and descriptions
- authorship — who drew what
- like counts, view counts
- NSFW flags and reports
- every user account, profile and avatar
- the created date, to better than month precision

What remains is the uploads directory, and the only metadata still encoded there is
in the filenames:

```
{post_id}_u{user_id}_flipbook.xml     the artwork
{post_id}_u{user_id}_flipbook.txt     the artwork, legacy format
{post_id}_u{user_id}_thumbnail.png    the thumbnail
wp-content/uploads/{YYYY}/{MM}/       the month it was made
```

## Reconstructing "featured"

One thing that looks lost is mostly recoverable, and it's the one the home page
depends on.

WordPress category 6 was called *featured*, but nothing about it was editorial.
`saveflipbook.php` assigned it automatically:

```php
if ($nsfw != "true" && $isDraft != "true" && get_current_user_id()) {
    array_push($categories, 6);   // featured
}
```

and `functions.php` pointed the home page at it with `$query->set('cat', '6')`. So it
meant **"not NSFW, not a draft, and saved by a logged-in user"** — in practice, *not
anonymous*. Its real job was keeping anonymous saves off the front page.

The categories lived in `wp_term_relationships` and died with the database. But the
author ID survives in every filename, and `saveflipbook.php` reassigned anonymous
saves to a `lostandfound` account before writing that filename. Identify the account
and most of the flag comes back.

**User 84 is `lostandfound`.** The evidence:

- 258 of 588 flipbooks — 44% of everything from a single account.
- Continuous from Feb 2013 to Jan 2019, the whole life of the site. Real users appear
  in bursts (user 118 is a three-month run in 2014; user 74 is prolific but gappy).
- No custom avatar, while the only two accounts that have one are ordinary users.
- The clincher: 16 flipbooks are `u0` — `get_current_user_id()` returning 0 with
  nothing to fall back to — and they are **all** January 2013. `u84` starts in
  February 2013, the month `u0` stops. Clean handover, no overlap.
- An ID of 84 fits a catch-all created after ~83 people had already signed up.

So `ANON_USER_IDS = {84, 0}` in `scripts/import-archive.js`, giving **312 featured and
273 anonymous** out of 585.

**What this doesn't recover:** NSFW and draft status. Nothing on disk encodes either,
so a small unknown number of the 312 were actually drafts or flagged and wouldn't
have been on the 2013 home page. Both were probably rare, but the number is a guess
and isn't worth pretending otherwise.

Curation done since then wins: the import only sets `featured` on insert, so
re-running it won't undo work done in admin mode. `--reset-featured` re-derives.

## What each imported row gets

So the import can recover a stable identifier and a month, and nothing else. Imported
rows get:

- `id` — `a{post_id}`
- `title` — `Flipbook #{post_id}`, since the real one is unrecoverable
- `created_at` — the first of the month it was filed under
- `source` — `archive`, which is what makes the playback page show "from the archive"
  instead of a byline
- `legacy_id` — the original WordPress post ID, so a row can always be traced back to
  its file
- `legacy_user_id` — the WordPress author ID, which is the evidence base for `featured`
- `featured` — reconstructed as above

## Running the import

```bash
npm run db:import-archive                      # reads ./_original
npm run db:import-archive -- --dry-run         # count and measure, write nothing
npm run db:import-archive -- --source /path/to/some/other/backup
npm run db:import-archive -- --reset-featured  # re-derive featured, discarding curation
```

It is **idempotent**. `legacy_id` carries a unique index and the insert is
`ON CONFLICT ... DO UPDATE`, so re-running refreshes rows rather than duplicating
them. Safe to run repeatedly.

**Run both backfills afterwards**, and for the same reason in each case: the import
replaces `data_gz` and nulls the two columns derived from it, rather than leaving
either holding a copy of artwork that is no longer there.

```bash
npm run db:backfill-brotli       # data_br, the copy the API prefers to serve
npm run db:backfill-thumbnails   # thumbnail_svg, the page a gallery card shows
```

Until they have run, those rows serve gzip and show their PNG thumbnail — which is
the fallback working, not a gap.

It skips:

- files under 500 bytes — a handful of saves that failed halfway in 2013
- `.xml` files that don't start with `<svg`
- `.txt` files that don't parse as JSON with a non-empty `layers` array

Where both backups contain the same post ID, it prefers the SVG version over the
legacy JSON one, then simply the larger file — a truncated copy is the only way two
copies of the same post differ.

Because a re-run is an `UPDATE` of every row, it leaves the old tuples behind and
roughly doubles the table on disk until autovacuum catches up. After re-importing:

```sql
VACUUM FULL ANALYZE flipbooks;
```

Measured locally: 153 MB straight after a second import, 77 MB after the vacuum.

## Keep `_original/` safe

`_original/` is **gitignored**. It is not in the repository, and it is the only copy
of the seed data. A fresh clone can build and run the site, but cannot repopulate the
archive without it.

That trade was deliberate: committing it would mean carrying ~74 MB of gzipped
artwork and thumbnails in git forever, in a repo whose whole point is to be a readable
showpiece. The production database is the live copy; `_original/` is the master.

**Back it up somewhere that isn't this laptop.** If it's ever lost and the Neon
database is ever lost, the 2012–2015 archive is gone for good.

If you'd rather have reproducibility over repo size, the change is small: gzip the
585 artwork files into `data/archive/`, commit them, and point
`scripts/import-archive.js` at that directory instead.

## Never edit `_original/`

It's reference material and archive seed data. Nothing reads from it at runtime and
nothing should write to it. Treat it as read-only.

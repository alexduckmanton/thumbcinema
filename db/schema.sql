-- thumbcinema schema
--
-- One table. A flipbook is a title, a blob of vector artwork and a PNG thumbnail.
-- That is genuinely all the 2013 WordPress install was storing either; it just
-- needed a posts table, a postmeta table and two attachment rows to say it.
--
-- Artwork is stored gzipped. The SVG that paper.js exports is extremely
-- repetitive polyline data and compresses to roughly 25% of its original size,
-- which takes the 585-piece archive from 247 MB down to 62 MB. The API serves the
-- bytes back with Content-Encoding: gzip, so nothing decompresses server side.
--
-- This file is idempotent and is the whole migration story: `npm run db:migrate`
-- applies it, and re-applying it against a populated database is safe. New columns
-- go in as ADD COLUMN IF NOT EXISTS below the CREATE, since CREATE TABLE IF NOT
-- EXISTS won't alter a table that already exists.

CREATE TABLE IF NOT EXISTS flipbooks (
    id           TEXT PRIMARY KEY,
    title        TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',

    -- 'svg'         paper.js exportSVG output, the format used from 2013 onward
    -- 'legacy-json' paper.js layer/segment JSON, the original 2012 format
    format       TEXT        NOT NULL DEFAULT 'svg',

    -- 'user'    saved through the create tool
    -- 'archive' recovered from the 2012-2015 WordPress uploads directory
    source       TEXT        NOT NULL DEFAULT 'user',

    data_gz      BYTEA       NOT NULL,
    thumbnail    BYTEA,

    views        INTEGER     NOT NULL DEFAULT 0,

    -- The save form still has the "this contains adult stuff" checkbox it had in
    -- 2013. There are no accounts to report from any more, but honouring the
    -- self-declaration costs one column: flagged flipbooks keep working on their
    -- own URL and are left out of both browse tabs, exactly as before. It doubles
    -- as the moderation lever, since admin mode can set it on anything.
    nsfw         BOOLEAN     NOT NULL DEFAULT false,

    -- The original WordPress post ID, for archive rows only. Lets us trace a row
    -- back to its file in the backup.
    legacy_id    INTEGER,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT flipbooks_format_check CHECK (format IN ('svg', 'legacy-json')),
    CONSTRAINT flipbooks_source_check CHECK (source IN ('user', 'archive'))
);

-- What the 2013 homepage showed.
--
-- WordPress category 6 was called "featured", but nothing about it was editorial:
-- saveflipbook.php assigned it automatically to anything that wasn't NSFW, wasn't a
-- draft, and had a logged-in author. Its real job was keeping anonymous saves off
-- the front page. The category lived in wp_term_relationships and died with the
-- database, so for archive rows this is reconstructed from legacy_user_id — see
-- docs/archive.md for the reasoning.
--
-- New saves default to false and are promoted by hand from admin mode.
ALTER TABLE flipbooks ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;

-- The WordPress author ID, parsed from the archive filename ({post}_u{user}_...).
-- It is the entire evidence base for the featured reconstruction, so it's kept:
-- 84 was the `lostandfound` catch-all that anonymous saves were reassigned to, and
-- 0 was the same thing before that account existed in Feb 2013.
ALTER TABLE flipbooks ADD COLUMN IF NOT EXISTS legacy_user_id INTEGER;

-- The "All" tab: newest first, safe-for-work only.
CREATE INDEX IF NOT EXISTS flipbooks_gallery_idx
    ON flipbooks (created_at DESC, id DESC)
    WHERE NOT nsfw;

-- The "Featured" tab, which is the default view and so the hotter of the two.
CREATE INDEX IF NOT EXISTS flipbooks_featured_idx
    ON flipbooks (created_at DESC, id DESC)
    WHERE featured AND NOT nsfw;

-- Keeps the archive import idempotent: re-running it updates rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS flipbooks_legacy_id_idx
    ON flipbooks (legacy_id)
    WHERE legacy_id IS NOT NULL;

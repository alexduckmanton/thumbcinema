import { gzip as gzipCb, brotliCompress as brotliCb, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';

import { query } from './db.js';
import { newId } from './id.js';
import { HttpError } from './http.js';
import { coverSvg } from './thumbnail.js';

const gzip = promisify(gzipCb);
const brotliCompress = promisify(brotliCb);

/**
 * The artwork, brotli'd — the copy the API prefers to serve.
 *
 * Quality 11 rather than the default 11-for-text/4-for-buffers split, because this
 * runs once per flipbook ever and the bytes are then immutable and CDN-cached
 * forever. A second or two at save time buys every reader of that flipbook a
 * download six times smaller than the gzip.
 *
 * SIZE_HINT is not decoration: brotli sizes its window from it, and the whole reason
 * this beats gzip so heavily on flipbooks is the window reaching across pages. Left
 * unset on a nine-megabyte archive file it guesses low and gives back most of the win.
 */
export function brotli(buffer) {
	return brotliCompress(buffer, {
		params: {
			[zlibConstants.BROTLI_PARAM_QUALITY]: 11,
			[zlibConstants.BROTLI_PARAM_SIZE_HINT]: buffer.length
		}
	});
}

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MAX_SVG_BYTES = 3 * 1024 * 1024;

/** Postgres's `undefined_column`. */
const UNDEFINED_COLUMN = '42703';

/**
 * The columns added since the first deploy, and what each degrades to without them.
 *
 * Every one of these is nullable, additive, and read by code that already has to cope
 * with the value being absent on some rows — which is what makes carrying on without
 * the column a state the feature is built for rather than a fallback invented here.
 */
const OPTIONAL_COLUMNS = {
	thumbnail_svg: 'Cards will show their PNG thumbnails until it exists.',
	remix_of: 'Flipbooks will not say what they were remixed from until it exists.',
	remix_root: 'Remix lists will be empty until it exists.'
};

const warnedAbout = new Set();

/**
 * Runs a query that mentions a column the database may not have yet, and carries on
 * without it if it hasn't.
 *
 * Nothing here deploys the schema. A push builds and goes live on its own, and
 * `npm run db:migrate` is a thing a person runs — so between the two there is a
 * window in which new code is talking to the old table. `thumbnail_svg` is read by
 * the query behind the *home page*, and its first deploy spent that window serving a
 * 500 to every visitor and an empty grid, which is a poor trade for a field whose
 * only job is to say which of two URLs a card should ask for.
 *
 * So a missing column is treated as every row simply not having one. The gallery
 * shows PNGs, nothing claims to be a remix, and nobody sees anything worse than the
 * page they had last week.
 *
 * **The retry drops one column, not all of them.** These arrived in separate
 * migrations and a database can be missing any subset, so the name is taken out of
 * the error and only that column stands down; the loop then asks again, because a
 * statement mentioning two absent columns only ever reports the first. Dropping the
 * lot on the first failure would be simpler and would mean the remix deploy window
 * also took the SVG thumbnails off every card in the gallery. If the name can't be
 * parsed the whole set stands down, which is that simpler behaviour kept as a floor.
 *
 * Deliberately not cached. The cost of asking is one failed statement, paid only
 * inside that window and only until the migration lands; caching the answer would
 * save nothing in the normal case and would leave every warm serverless instance
 * still refusing to see the column for as long as it lived.
 *
 * `build(has)` returns the `[sql, params]` for whichever columns `has(name)` allows.
 */
async function queryColumnAware(build) {
	const missing = new Set();
	const has = (column) => !missing.has(column);

	for (;;) {
		try {
			return await query(...build(has));
		} catch (err) {
			if (err?.code !== UNDEFINED_COLUMN) throw err;

			const named = columnFromError(err);
			const standDown = named && named in OPTIONAL_COLUMNS ? [named] : Object.keys(OPTIONAL_COLUMNS);

			// No progress means the missing column isn't one of ours, so this is a real
			// bug in a statement rather than a database waiting on its migration.
			const before = missing.size;
			for (const column of standDown) missing.add(column);
			if (missing.size === before) throw err;

			for (const column of standDown) {
				if (warnedAbout.has(column)) continue;
				warnedAbout.add(column);
				console.warn(
					`[flipbooks] ${column} is missing — run \`npm run db:migrate\`. ${OPTIONAL_COLUMNS[column]}`
				);
			}
		}
	}
}

/**
 * The column name out of an `undefined_column` error.
 *
 * Postgres puts it in the message rather than in a field — `err.column` is for
 * constraint violations — and it has more than one way of saying it. All three of
 * these are the same error and all three happen here:
 *
 *     column "remix_root" does not exist                        -- a SELECT
 *     column flipbooks.remix_root does not exist                -- qualified
 *     column "remix_of" of relation "flipbooks" does not exist  -- an INSERT
 *
 * The third is why this is a regex worth testing rather than a one-liner. Missing it
 * doesn't break anything visibly — the caller falls back to standing *every* optional
 * column down, which still saves the flipbook — but it takes the SVG thumbnail off a
 * save that had nothing wrong with it, which is exactly the over-degradation the
 * per-column retry exists to avoid. It went unnoticed until a save was run against a
 * database with the columns actually missing.
 */
function columnFromError(err) {
	const match = /column "?(?:[\w$]+\.)?([\w$]+)"?(?: of relation "[^"]*")? does not exist/
		.exec(err?.message || '');
	return match ? match[1] : null;
}

export const VIEWS = ['featured', 'all'];

/**
 * The browse grid, in both its tabs.
 *
 * Keyset pagination rather than LIMIT/OFFSET, because the grid is now an infinite
 * scroll: with OFFSET, a flipbook saved while someone is scrolling shifts every
 * subsequent row down one and they see a duplicate. Comparing on (created_at, id)
 * is stable under inserts and matches the index exactly.
 */
export async function listFlipbooks({ view = 'featured', cursor = null, limit = 24, includeNsfw = false, remixOf = null } = {}) {
	const safeLimit = clamp(limit, 1, 60);
	const safeView = VIEWS.includes(view) ? view : 'featured';

	// Everything made from one flipbook, which is a different list rather than a
	// filtered gallery: `featured` says nothing about a remix, and a list that hid the
	// un-promoted ones would be a list of what somebody made from your drawing with
	// most of it missing. NSFW still applies — that is moderation, not curation.
	const lineage = typeof remixOf === 'string' && remixOf.length > 0 ? remixOf : null;

	const { rows } = await queryColumnAware((has) => {
		const where = [];
		const params = [];

		// Only ever true for an authenticated admin, so moderated flipbooks remain
		// findable by the one person who can un-moderate them.
		if (!includeNsfw) where.push('NOT nsfw');

		if (lineage) {
			// Keyed on the root, so a remix of a remix lists under the same original.
			//
			// `false` rather than no clause at all when the column hasn't landed yet.
			// Every other caller degrades to "no row has one"; dropping a *filter*
			// degrades the other way, and this one would answer "what was made from
			// this flipbook" with the entire gallery.
			if (has('remix_root')) {
				params.push(lineage);
				where.push(`remix_root = $${params.length}`);
			} else {
				where.push('false');
			}
		} else if (safeView === 'featured') {
			where.push('featured');
		}

		const decoded = decodeCursor(cursor);
		if (decoded) {
			params.push(decoded.createdAt, decoded.id);
			where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
		}

		params.push(safeLimit);

		// Admin viewing "all" filters on nothing at all, so the clause can be empty.
		const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

		// The SVG thumbnail is asked about rather than fetched: whether the row has one
		// decides which URL the card points at, and the bytes themselves are a separate
		// immutable request the CDN will answer.
		return [
			`SELECT id, title, source, format, featured, nsfw, created_at,
			        ${has('thumbnail_svg') ? 'thumbnail_svg IS NOT NULL' : 'false'} AS has_thumbnail_svg
			   FROM flipbooks
			   ${whereSql}
			  ORDER BY created_at DESC, id DESC
			  LIMIT $${params.length}`,
			params
		];
	});

	// `format` and `data_url` are here so the gallery can play a flipbook without
	// asking for its metadata first: hovering a card fetches the artwork directly,
	// and which of the two artwork formats it is has to come with the listing or the
	// hover costs a second round trip before it can start. Extra fields are harmless
	// to `time-capsule`, which reads the ones it knows and ignores the rest.
	//
	// `thumbnail_svg_url` is null on any row that hasn't got one — a `time-capsule`
	// save, a legacy-json flipbook, anything the backfill hasn't reached — and the
	// card falls back to the PNG. It has to be stated rather than guessed at: a card
	// that simply tried the SVG first would put a 404 in front of every one of them.
	const items = rows.map((row) => ({
		id: row.id,
		title: row.title,
		source: row.source,
		format: row.format,
		featured: row.featured,
		nsfw: row.nsfw,
		created_at: row.created_at,
		data_url: `/api/flipbooks/${row.id}/data`,
		thumbnail_url: `/api/flipbooks/${row.id}/thumbnail`,
		thumbnail_svg_url: row.has_thumbnail_svg ? `/api/flipbooks/${row.id}/thumbnail.svg` : null
	}));

	// A full page means there may be more; a short one is definitively the end.
	const last = rows[rows.length - 1];
	const nextCursor = rows.length === safeLimit && last
		? encodeCursor(last.created_at, last.id)
		: null;

	return { items, view: safeView, limit: safeLimit, next_cursor: nextCursor };
}

/**
 * Admin only. Sets either flag; leaves the other alone when it isn't passed.
 * Marking something NSFW is how a bad save gets pulled from both tabs.
 */
export async function setFlipbookFlags(id, { featured, nsfw }) {
	const sets = [];
	const params = [id];

	if (typeof featured === 'boolean') {
		params.push(featured);
		sets.push(`featured = $${params.length}`);
	}
	if (typeof nsfw === 'boolean') {
		params.push(nsfw);
		sets.push(`nsfw = $${params.length}`);
	}

	if (!sets.length) throw new HttpError(400, 'Nothing to update.');

	const { rows } = await query(
		`UPDATE flipbooks SET ${sets.join(', ')}
		  WHERE id = $1
	  RETURNING id, featured, nsfw`,
		params
	);

	if (!rows.length) throw new HttpError(404, 'Not found');
	return rows[0];
}

// Cursors are opaque on purpose — they're an implementation detail of the scroll,
// not a URL anyone should be constructing by hand.
function encodeCursor(createdAt, id) {
	return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
	if (!cursor || typeof cursor !== 'string' || cursor.length > 200) return null;
	try {
		const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
		const createdAt = new Date(timestamp);
		if (!id || Number.isNaN(createdAt.getTime())) return null;
		return { createdAt, id };
	} catch {
		return null;
	}
}

export async function getFlipbook(id, { countView = false } = {}) {
	// One statement: bump the counter and return the row. Doing it in two would
	// mean two round trips to Neon for what is the single hottest request.
	const { rows } = await queryColumnAware((has) => {
		const svg = `${has('thumbnail_svg') ? 'thumbnail_svg IS NOT NULL' : 'false'} AS has_thumbnail_svg`;

		// What this was made from, and what it is called — the backlink under the title
		// needs both, and a second request for one string in front of every playback
		// page is a round trip to save a scalar subquery.
		//
		// A subquery rather than a LEFT JOIN because half of this statement is an
		// UPDATE: joining a table to itself in `UPDATE ... FROM` can't be an outer join
		// without restating the row, and a flipbook that isn't a remix has to come back
		// all the same. Correlated on the primary key, so it is an index lookup or
		// nothing at all.
		const parent = has('remix_of')
			? `remix_of, (SELECT title FROM flipbooks parent WHERE parent.id = flipbooks.remix_of) AS remix_of_title`
			: `NULL AS remix_of, NULL AS remix_of_title`;

		// Not shown anywhere, but it is what says whether this flipbook's own page
		// should be listing anything, and it costs nothing to carry.
		const root = has('remix_root') ? 'remix_root' : 'NULL AS remix_root';

		return [
			countView
				? `UPDATE flipbooks SET views = views + 1
				    WHERE id = $1
				RETURNING id, title, description, format, source, views, featured, nsfw,
				          created_at, ${svg}, ${parent}, ${root}`
				: `SELECT id, title, description, format, source, views, featured, nsfw,
				          created_at, ${svg}, ${parent}, ${root}
				     FROM flipbooks WHERE id = $1`,
			[id]
		];
	});
	if (!rows.length) return null;

	const row = rows[0];
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		format: row.format,
		byline: row.source === 'archive' ? 'from the archive' : '',
		views: row.views,
		// Surfaced for the admin toggles. Harmless to everyone else — an NSFW
		// flipbook is reachable on its own URL by design, so this leaks nothing.
		featured: row.featured,
		nsfw: row.nsfw,
		created_at: row.created_at,
		data_url: `/api/flipbooks/${row.id}/data`,
		thumbnail_url: `/api/flipbooks/${row.id}/thumbnail`,
		thumbnail_svg_url: row.has_thumbnail_svg ? `/api/flipbooks/${row.id}/thumbnail.svg` : null,
		// What it was made from, as one object or null. Null on everything that isn't a
		// remix, which is every flipbook saved before this existed, every `time-capsule`
		// save, and all 585 archive pieces.
		//
		// The title can be null on a row that has one — a flipbook needs a title to be
		// saved, but the archive holds rows without one — so the link's wording has to
		// cope with that rather than assuming a string.
		remix_of: row.remix_of ? { id: row.remix_of, title: row.remix_of_title } : null,
		// Which list this flipbook's remixes belong to: its own id if it is an original,
		// the shared root if it is itself a remix. The lineage is flat, so a remix and
		// the thing it was made from show the same list.
		remix_root: row.remix_root || row.id
	};
}

export async function getFlipbookData(id) {
	// Both encodings, and the router picks. data_br is null for anything saved from
	// `time-capsule` and for anything the backfill hasn't reached, so gzip is not a
	// legacy path here — it is the fallback that has to keep working.
	const { rows } = await query('SELECT data_gz, data_br, format FROM flipbooks WHERE id = $1', [id]);
	return rows.length ? rows[0] : null;
}

export async function getFlipbookThumbnail(id) {
	const { rows } = await query('SELECT thumbnail FROM flipbooks WHERE id = $1', [id]);
	return rows.length ? rows[0].thumbnail : null;
}

/** The cover page as an SVG, brotli'd. Null on any row that hasn't got one. */
export async function getFlipbookThumbnailSvg(id) {
	const { rows } = await queryColumnAware((has) => [
		`SELECT ${has('thumbnail_svg') ? 'thumbnail_svg' : 'NULL AS thumbnail_svg'} FROM flipbooks WHERE id = $1`,
		[id]
	]);
	return rows.length ? rows[0].thumbnail_svg : null;
}

/**
 * The flipbook a save says it was made from, resolved to what actually goes in the
 * two columns — or null, meaning this is not a remix.
 *
 * Everything about it is decided here rather than trusted from the request, because
 * the parent id arrives in a form field and a form field is a suggestion:
 *
 *  - **It has to exist.** A remix of nothing is a backlink to a 404 and a list that
 *    can never be reached, and there is no useful thing to tell someone whose drawing
 *    is otherwise fine — so the link is dropped and the flipbook saves as an original.
 *  - **It can't be `legacy-json`.** The 2012 flipbooks are point lists that only come
 *    back through the pencil, so what the drawing tool can load is a resampled copy
 *    rather than the artwork. The button isn't offered on those; this is the same
 *    answer given where it can't be got round.
 *  - **The root comes from the parent, never from the client.** `parent.remix_root`
 *    when the parent is itself a remix, the parent's own id when it is an original.
 *    That is the whole of what keeps the lineage flat, and it is one row's worth of
 *    lookup rather than a walk up the chain, because every row already carries it.
 */
async function resolveRemixParent(id) {
	if (typeof id !== 'string' || !id) return null;

	const { rows } = await queryColumnAware((has) => [
		`SELECT id, format, ${has('remix_root') ? 'remix_root' : 'NULL AS remix_root'}
		   FROM flipbooks WHERE id = $1`,
		[id]
	]);

	const parent = rows[0];
	if (!parent || parent.format === 'legacy-json') return null;

	return { of: parent.id, root: parent.remix_root || parent.id };
}

export async function createFlipbook({ title, description, svg, thumbnailDataUrl, cover = null, nsfw = false, remixOf = null }) {
	const cleanTitle = cleanText(title, MAX_TITLE);
	if (!cleanTitle) throw new HttpError(400, 'A flipbook needs a title.');

	const cleanDescription = cleanText(description, MAX_DESCRIPTION);

	if (typeof svg !== 'string' || !svg.trim().startsWith('<svg')) {
		throw new HttpError(400, "That doesn't look like a flipbook.");
	}
	if (Buffer.byteLength(svg) > MAX_SVG_BYTES) {
		throw new HttpError(413, 'Flipbook is too large to save.');
	}

	const thumbnail = decodeThumbnail(thumbnailDataUrl);
	const raw = Buffer.from(svg, 'utf8');

	// Before the compression rather than after it, so a save that is going to be an
	// original anyway hasn't spent a second on brotli first. It is one indexed lookup.
	const remix = await resolveRemixParent(remixOf);

	// The card in the gallery: the cover page taken back out of the artwork we were
	// just handed, rather than a second thing for the client to send. `cover` is the
	// page the create page drew its PNG of, so the two pictures are of the same
	// drawing; without it lib/thumbnail.js picks the busiest page itself.
	const page = coverSvg(svg, { page: cover });

	// All three, on every save. The gzip is what `time-capsule` serves from and what
	// any client that won't take brotli gets; the brotli is what everyone else gets.
	// They compress in parallel because the brotli is the slow one and there is a
	// reader waiting on this request for their permalink.
	const [dataGz, dataBr, coverBr] = await Promise.all([
		gzip(raw, { level: 9 }),
		brotli(raw),
		page ? brotli(Buffer.from(page.svg, 'utf8')) : null
	]);

	// Only when it beats the picture of it, which is the rule data_br follows against
	// the gzip. It essentially always does — a page of vector against 640x360 of
	// raster — but a flipbook of one enormously dense page is the case where it might
	// not, and there is no sense storing a thumbnail that is worse than the fallback.
	const thumbnailSvg = coverBr && (!thumbnail || coverBr.length < thumbnail.length) ? coverBr : null;

	const id = newId();

	// The one place where carrying on without a column really matters: a gallery
	// showing PNGs is a cosmetic loss, and a save that 500s is somebody's drawing. A
	// flipbook saved into a database that hasn't been migrated yet lands as an
	// original, which is the same answer every pre-existing row already gives.
	//
	// Composed rather than written out per shape: with three optional columns there
	// are eight of them, and seven would be there to be got subtly wrong. The failed
	// statement writes nothing, so the retry can reuse the same id.
	await queryColumnAware((has) => {
		const columns = ['id', 'title', 'description', 'format', 'source', 'data_gz', 'data_br', 'thumbnail', 'nsfw'];
		const values = ['$1', '$2', '$3', `'svg'`, `'user'`, '$4', '$5', '$6', '$7'];
		const params = [id, cleanTitle, cleanDescription, dataGz, dataBr, thumbnail, Boolean(nsfw)];

		const add = (column, value) => {
			params.push(value);
			columns.push(column);
			values.push(`$${params.length}`);
		};

		if (has('thumbnail_svg')) add('thumbnail_svg', thumbnailSvg);
		// Both or neither: a root with no parent is a row that can be listed but can't
		// say where it came from, and the two columns are only ever written together.
		if (remix && has('remix_of') && has('remix_root')) {
			add('remix_of', remix.of);
			add('remix_root', remix.root);
		}

		return [
			`INSERT INTO flipbooks (${columns.join(', ')}) VALUES (${values.join(', ')})`,
			params
		];
	});

	return id;
}

// --- helpers ---------------------------------------------------------------

function cleanText(value, maxLength) {
	if (typeof value !== 'string') return '';
	// The original ran wp_strip_all_tags over both fields; same idea, and the
	// front end renders these with .text() so this is belt and braces.
	return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function decodeThumbnail(dataUrl) {
	if (typeof dataUrl !== 'string') return null;

	const match = /^data:image\/png;base64,(.+)$/s.exec(dataUrl.replace(/ /g, '+'));
	if (!match) return null;

	const buffer = Buffer.from(match[1], 'base64');
	// A PNG always starts with this signature. Anything else isn't one.
	const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	);
	return isPng ? buffer : null;
}

function clamp(value, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

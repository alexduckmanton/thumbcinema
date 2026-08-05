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

let warnedAboutColumn = false;

/**
 * Runs a query that mentions `thumbnail_svg`, and carries on without it if the
 * database hasn't got that column yet.
 *
 * Nothing here deploys the schema. A push builds and goes live on its own, and
 * `npm run db:migrate` is a thing a person runs — so between the two there is a
 * window in which new code is talking to the old table, and this column is read by
 * the query behind the *home page*. The first deploy of it spent that window serving
 * a 500 to every visitor and an empty grid, which is a poor trade for a field whose
 * only job is to say which of two URLs a card should ask for.
 *
 * So a missing column is treated as every row simply not having one — which is a
 * state the whole feature is already built for, since `time-capsule` saves and the
 * 2012 flipbooks never have one either. The gallery shows PNGs until the migration
 * runs, and nobody sees anything worse than the thumbnails they had last week.
 *
 * Deliberately not cached. The cost of asking is one failed statement, paid only
 * inside that window and only until the migration lands; caching the answer would
 * save nothing in the normal case and would leave every warm serverless instance
 * still refusing to see the column for as long as it lived.
 *
 * `build(hasColumn)` returns the `[sql, params]` for either shape.
 */
async function querySvgAware(build) {
	try {
		return await query(...build(true));
	} catch (err) {
		if (err?.code !== UNDEFINED_COLUMN) throw err;

		if (!warnedAboutColumn) {
			warnedAboutColumn = true;
			console.warn(
				'[flipbooks] thumbnail_svg is missing — run `npm run db:migrate`. ' +
				'Cards will show their PNG thumbnails until it exists.'
			);
		}

		return await query(...build(false));
	}
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
export async function listFlipbooks({ view = 'featured', cursor = null, limit = 24, includeNsfw = false } = {}) {
	const safeLimit = clamp(limit, 1, 60);
	const safeView = VIEWS.includes(view) ? view : 'featured';

	const where = [];
	const params = [];

	// Only ever true for an authenticated admin, so moderated flipbooks remain
	// findable by the one person who can un-moderate them.
	if (!includeNsfw) where.push('NOT nsfw');
	if (safeView === 'featured') where.push('featured');

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
	const { rows } = await querySvgAware((hasColumn) => [
		`SELECT id, title, source, format, featured, nsfw, created_at,
		        ${hasColumn ? 'thumbnail_svg IS NOT NULL' : 'false'} AS has_thumbnail_svg
		   FROM flipbooks
		   ${whereSql}
		  ORDER BY created_at DESC, id DESC
		  LIMIT $${params.length}`,
		params
	]);

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
	const { rows } = await querySvgAware((hasColumn) => {
		const svg = `${hasColumn ? 'thumbnail_svg IS NOT NULL' : 'false'} AS has_thumbnail_svg`;

		return [
			countView
				? `UPDATE flipbooks SET views = views + 1
				    WHERE id = $1
				RETURNING id, title, description, format, source, views, featured, nsfw,
				          created_at, ${svg}`
				: `SELECT id, title, description, format, source, views, featured, nsfw,
				          created_at, ${svg}
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
		thumbnail_svg_url: row.has_thumbnail_svg ? `/api/flipbooks/${row.id}/thumbnail.svg` : null
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
	const { rows } = await querySvgAware((hasColumn) => [
		`SELECT ${hasColumn ? 'thumbnail_svg' : 'NULL AS thumbnail_svg'} FROM flipbooks WHERE id = $1`,
		[id]
	]);
	return rows.length ? rows[0].thumbnail_svg : null;
}

export async function createFlipbook({ title, description, svg, thumbnailDataUrl, cover = null, nsfw = false }) {
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

	// The one place where carrying on without the column really matters: a gallery
	// showing PNGs is a cosmetic loss, and a save that 500s is somebody's drawing.
	// The failed statement writes nothing, so the retry can reuse the same id.
	await querySvgAware((hasColumn) =>
		hasColumn
			? [
				`INSERT INTO flipbooks (id, title, description, format, source, data_gz, data_br, thumbnail, thumbnail_svg, nsfw)
				 VALUES ($1, $2, $3, 'svg', 'user', $4, $5, $6, $7, $8)`,
				[id, cleanTitle, cleanDescription, dataGz, dataBr, thumbnail, thumbnailSvg, Boolean(nsfw)]
			]
			: [
				`INSERT INTO flipbooks (id, title, description, format, source, data_gz, data_br, thumbnail, nsfw)
				 VALUES ($1, $2, $3, 'svg', 'user', $4, $5, $6, $7)`,
				[id, cleanTitle, cleanDescription, dataGz, dataBr, thumbnail, Boolean(nsfw)]
			]
	);

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

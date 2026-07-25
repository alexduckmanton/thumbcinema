import { gzip as gzipCb } from 'node:zlib';
import { promisify } from 'node:util';

import { query } from './db.js';
import { newId } from './id.js';
import { HttpError } from './http.js';

const gzip = promisify(gzipCb);

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MAX_SVG_BYTES = 3 * 1024 * 1024;

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

	const { rows } = await query(
		`SELECT id, title, source, featured, nsfw, created_at
		   FROM flipbooks
		   ${whereSql}
		  ORDER BY created_at DESC, id DESC
		  LIMIT $${params.length}`,
		params
	);

	const items = rows.map((row) => ({
		id: row.id,
		title: row.title,
		source: row.source,
		featured: row.featured,
		nsfw: row.nsfw,
		created_at: row.created_at,
		thumbnail_url: `/api/flipbooks/${row.id}/thumbnail`
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
	const sql = countView
		? `UPDATE flipbooks SET views = views + 1
		    WHERE id = $1
		RETURNING id, title, description, format, source, views, featured, nsfw, created_at`
		: `SELECT id, title, description, format, source, views, featured, nsfw, created_at
		     FROM flipbooks WHERE id = $1`;

	const { rows } = await query(sql, [id]);
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
		thumbnail_url: `/api/flipbooks/${row.id}/thumbnail`
	};
}

export async function getFlipbookData(id) {
	const { rows } = await query('SELECT data_gz, format FROM flipbooks WHERE id = $1', [id]);
	return rows.length ? rows[0] : null;
}

export async function getFlipbookThumbnail(id) {
	const { rows } = await query('SELECT thumbnail FROM flipbooks WHERE id = $1', [id]);
	return rows.length ? rows[0].thumbnail : null;
}

export async function createFlipbook({ title, description, svg, thumbnailDataUrl, nsfw = false }) {
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
	const dataGz = await gzip(Buffer.from(svg, 'utf8'), { level: 9 });
	const id = newId();

	await query(
		`INSERT INTO flipbooks (id, title, description, format, source, data_gz, thumbnail, nsfw)
		 VALUES ($1, $2, $3, 'svg', 'user', $4, $5, $6)`,
		[id, cleanTitle, cleanDescription, dataGz, thumbnail, Boolean(nsfw)]
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

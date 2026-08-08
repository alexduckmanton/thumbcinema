import { gunzip as gunzipCb, brotliDecompress as brotliDecompressCb } from 'node:zlib';
import { promisify } from 'node:util';

import {
	listFlipbooks,
	getFlipbook,
	getFlipbookData,
	getFlipbookThumbnail,
	getFlipbookThumbnailSvg,
	createFlipbook,
	setFlipbookFlags
} from './flipbooks.js';
import { isValidId } from './id.js';
import { requireAdmin, isAdmin } from './admin.js';
import { HttpError, readBody, readForm, sendJson, sendText } from './http.js';

const gunzip = promisify(gunzipCb);
const brotliDecompress = promisify(brotliDecompressCb);

// Artwork and thumbnails are immutable once written — a flipbook is never edited —
// so they can be cached hard and served from the CDN forever.
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * The whole API. Mounted at /api by Vercel (see vercel.json) and called directly
 * by the dev server, so both environments run identical routing.
 */
export async function handleApi(req, res) {
	const url = new URL(req.url, 'http://localhost');

	// Every API route is rewritten to the single /api function, and vercel.json
	// passes the original path through as __path so routing never has to depend on
	// how a given platform rewrites req.url. The dev server calls us directly and
	// leaves it unset, in which case the real pathname is already correct.
	const rawPath = url.searchParams.get('__path') || url.pathname;
	const path = rawPath.replace(/\/+$/, '') || '/';

	try {
		// POST /saveflipbook — the 2013 endpoint, unchanged contract.
		// data.js posts a form and expects a bare permalink back in the body.
		if (path === '/saveflipbook') {
			if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
			return await saveFlipbook(req, res);
		}

		// GET /api/flipbooks?view=featured|all&cursor=&limit=
		// GET /api/flipbooks?remix_of=<id> — everything made from one flipbook.
		//
		// The same endpoint rather than a route of its own, because it answers with the
		// same rows in the same shape and the gallery's card renders them either way.
		// What differs is only which flipbooks are in it, which is what a filter is.
		if (path === '/api/flipbooks') {
			if (!isRead(req)) throw new HttpError(405, 'Method not allowed');

			// Rejected rather than ignored, which is the whole of why this is checked
			// here at all. A malformed id that fell through to `null` would not be an
			// empty list — it would be an ordinary gallery listing, and the page asking
			// "what was made from this flipbook" would answer with the front page.
			// Malformed is a 404 on the routes below for the same reason.
			const remixOf = url.searchParams.get('remix_of');
			if (remixOf !== null && !isValidId(remixOf)) throw new HttpError(404, 'Not found');

			const result = await listFlipbooks({
				view: url.searchParams.get('view') || 'featured',
				cursor: url.searchParams.get('cursor'),
				limit: Number(url.searchParams.get('limit')) || 24,
				includeNsfw: isAdmin(req),
				remixOf
			});
			return sendJson(res, 200, result);
		}

		// PATCH /api/admin/flipbooks/:id — set the featured and/or nsfw flags.
		const adminMatch = /^\/api\/admin\/flipbooks\/([^/]+)$/.exec(path);
		if (adminMatch) {
			requireAdmin(req);
			if (req.method !== 'PATCH') throw new HttpError(405, 'Method not allowed');

			const id = decodeURIComponent(adminMatch[1]);
			if (!isValidId(id)) throw new HttpError(404, 'Not found');

			return await updateFlags(req, res, id);
		}

		// The admin token also unlocks listing NSFW rows, so moderated flipbooks
		// can still be found and un-flagged. Everyone else never sees them.
		const match = /^\/api\/flipbooks\/([^/]+)(?:\/(data|thumbnail|thumbnail\.svg))?$/.exec(path);
		if (match) {
			if (!isRead(req)) throw new HttpError(405, 'Method not allowed');

			const id = decodeURIComponent(match[1]);
			if (!isValidId(id)) throw new HttpError(404, 'Not found');

			if (match[2] === 'data') return await sendFlipbookData(req, res, id);
			if (match[2] === 'thumbnail.svg') return await sendThumbnailSvg(req, res, id);
			if (match[2] === 'thumbnail') return await sendThumbnail(res, id);
			return await sendMetadata(res, id);
		}

		throw new HttpError(404, 'Not found');

	} catch (err) {
		const status = err instanceof HttpError ? err.status : 500;
		if (status >= 500) console.error('[api]', req.method, path, err);

		return sendJson(res, status, {
			error: status >= 500 ? 'Something went wrong.' : err.message
		});
	}
}


async function saveFlipbook(req, res) {
	const form = await readForm(req);

	const id = await createFlipbook({
		title: form.get('title'),
		description: form.get('description'),
		svg: form.get('project'),
		thumbnailDataUrl: form.get('imgBase64'),
		// Which page the PNG is of, so the SVG thumbnail cut from the same artwork is
		// of that page too. Absent from a `time-capsule` save and from any older
		// client, and the server picks the busiest page itself when it is.
		cover: parsePage(form.get('cover')),
		nsfw: form.get('nsfw') === 'true' || form.get('nsfw') === '1',
		// What this was drawn on top of, when the drawing tool was opened from a
		// flipbook rather than empty. Absent from a `time-capsule` save and from every
		// older client, which is the same thing as saying it isn't a remix.
		//
		// Checked for shape here and for existence in `createFlipbook`, which drops the
		// link rather than refusing the save: somebody's drawing is not worth losing
		// over a field that only decides which page it gets listed on.
		remixOf: isValidId(form.get('remix_of')) ? form.get('remix_of') : null
	});

	// data.js assigns this response straight to window.location.href.
	sendText(res, 200, `/f/${id}`, { 'Cache-Control': 'no-store' });
}


async function updateFlags(req, res, id) {
	const body = await readBody(req, 4096);

	let payload;
	try {
		payload = JSON.parse(body.toString('utf8') || '{}');
	} catch {
		throw new HttpError(400, 'Expected JSON.');
	}

	const updated = await setFlipbookFlags(id, {
		featured: payload.featured,
		nsfw: payload.nsfw
	});

	sendJson(res, 200, updated);
}


async function sendMetadata(res, id) {
	const flipbook = await getFlipbook(id, { countView: true });
	if (!flipbook) throw new HttpError(404, 'Not found');
	sendJson(res, 200, flipbook);
}


async function sendFlipbookData(req, res, id) {
	const row = await getFlipbookData(id);
	if (!row) throw new HttpError(404, 'Not found');

	// Legacy flipbooks must arrive as text/plain: data.js does JSON.parse() on the
	// response itself, so jQuery must not helpfully parse it first.
	const contentType = row.format === 'legacy-json'
		? 'text/plain; charset=utf-8'
		: 'image/svg+xml; charset=utf-8';

	const headers = {
		'Content-Type': contentType,
		'Cache-Control': IMMUTABLE,
		Vary: 'Accept-Encoding'
	};

	// Stored compressed in both encodings, so the common paths are a straight
	// passthrough and nothing is ever compressed per request.
	//
	// Brotli first, and by a long way: on this corpus it is a sixth of the gzip's
	// size, because a flipbook is one drawing repeated over forty pages and brotli's
	// window is wide enough to see that where deflate's 32 KB is not. It is null for
	// rows saved from `time-capsule` and for anything the backfill hasn't reached,
	// which is the whole of why gzip is still here.
	const encoding = row.data_br && accepts(req, 'br') ? 'br'
		: acceptsGzip(req) ? 'gzip'
		: null;

	if (encoding) {
		const body = encoding === 'br' ? row.data_br : row.data_gz;
		res.writeHead(200, {
			...headers,
			'Content-Encoding': encoding,
			'Content-Length': body.length
		});
		return res.end(body);
	}

	const raw = await gunzip(row.data_gz);
	res.writeHead(200, { ...headers, 'Content-Length': raw.length });
	res.end(raw);
}


async function sendThumbnail(res, id) {
	const thumbnail = await getFlipbookThumbnail(id);
	if (!thumbnail) throw new HttpError(404, 'Not found');

	res.writeHead(200, {
		'Content-Type': 'image/png',
		'Content-Length': thumbnail.length,
		'Cache-Control': IMMUTABLE
	});
	res.end(thumbnail);
}


/**
 * The same page, as the drawing rather than as pixels — what a gallery card shows.
 *
 * Stored brotli'd and only brotli'd, unlike the artwork: it is a couple of kilobytes,
 * so a client that won't take brotli is served a decompression rather than a second
 * copy of every row in the table. 404 for a row without one; the gallery knows which
 * rows those are from the listing and asks for the PNG instead.
 */
async function sendThumbnailSvg(req, res, id) {
	const compressed = await getFlipbookThumbnailSvg(id);
	if (!compressed) throw new HttpError(404, 'Not found');

	const headers = {
		'Content-Type': 'image/svg+xml; charset=utf-8',
		'Cache-Control': IMMUTABLE,
		Vary: 'Accept-Encoding'
	};

	if (accepts(req, 'br')) {
		res.writeHead(200, {
			...headers,
			'Content-Encoding': 'br',
			'Content-Length': compressed.length
		});
		return res.end(compressed);
	}

	const raw = await brotliDecompress(compressed);
	res.writeHead(200, { ...headers, 'Content-Length': raw.length });
	res.end(raw);
}


// A page index or nothing. Out of range is somebody else's problem: lib/thumbnail.js
// checks it against the artwork it is actually cutting up.
function parsePage(value) {
	const page = Number(value);
	return Number.isInteger(page) && page >= 0 ? page : null;
}


// A token match rather than a full q-value parse. Every browser that names an
// encoding here accepts it unweighted, and the cost of being wrong is one request
// served in the other encoding rather than anything breaking. `q=0` is the one form
// that would matter and is honoured explicitly.
function accepts(req, encoding) {
	const header = req.headers['accept-encoding'] || '';
	const match = new RegExp(`\\b${encoding}\\b\\s*(?:;\\s*q=([0-9.]+))?`).exec(header);
	return Boolean(match) && Number(match[1] ?? 1) > 0;
}

function acceptsGzip(req) {
	return accepts(req, 'gzip');
}

// HEAD is handled as GET — Node drops the body itself for HEAD responses, so the
// headers (and Content-Length in particular) come out right. CDNs and link
// previewers do issue it.
function isRead(req) {
	return req.method === 'GET' || req.method === 'HEAD';
}

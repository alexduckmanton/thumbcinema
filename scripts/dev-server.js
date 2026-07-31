#!/usr/bin/env node
//
// Local dev server. Serves public/ and mounts the same lib/router.js that runs on
// Vercel, so there is no Vercel CLI or login in the loop — `npm run dev` is enough.
// URL rewriting here mirrors vercel.json; if you change one, change the other.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './lib/env.js';
import { handleApi } from '../lib/router.js';

loadEnv();

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.eot': 'application/vnd.ms-fontobject'
};

// Mirrors the rewrites + cleanUrls behaviour in vercel.json.
function resolvePage(pathname) {
	if (pathname === '/' || pathname === '') return 'index.html';
	if (/^\/f\/[^/]+$/.test(pathname)) return 'flipbook.html';

	const clean = pathname.replace(/^\/+/, '');
	if (clean === 'create') return 'create.html';
	if (clean === 'sadbrowser') return 'sadbrowser.html';
	return null;
}

const server = createServer(async (req, res) => {
	const started = Date.now();
	const { pathname } = new URL(req.url, 'http://localhost');

	res.on('finish', () => {
		console.log(`${res.statusCode} ${req.method} ${req.url} ${Date.now() - started}ms`);
	});

	try {
		if (pathname === '/saveflipbook' || pathname.startsWith('/api/') || pathname === '/api') {
			return await handleApi(req, res);
		}

		const page = resolvePage(pathname);
		if (page) return await sendFile(res, join(ROOT, page));

		// Static asset. normalize() + the prefix check keep ../ out of the path.
		const filePath = normalize(join(ROOT, decodeURIComponent(pathname)));
		if (!filePath.startsWith(ROOT)) return notFound(res);

		return await sendFile(res, filePath);

	} catch (err) {
		if (err.code === 'ENOENT' || err.code === 'EISDIR') return notFound(res);
		console.error(err);
		res.writeHead(500, { 'Content-Type': 'text/plain' });
		res.end('Internal error');
	}
});

// `no-store`, not `no-cache`. They read like synonyms and aren't: `no-cache` lets a
// client *store* the response as long as it revalidates before reusing it — and
// revalidating needs a validator, which this server wasn't sending. With no ETag and
// no Last-Modified there was nothing to revalidate against, and clients fell back to
// serving the stored copy. That cost an afternoon once: revival.css kept coming back
// as an older version, edits appeared to do nothing, and the CSS looked broken when
// it was correct. `no-store` says don't keep it at all, which is the only thing a dev
// server actually wants.
//
// Last-Modified is still sent, but only as information — with no-store nothing will
// ever send it back as If-Modified-Since, and that's fine. The cost is that every
// reload re-fetches the fonts; they're on local disk, and it means the cold-load path
// (preload + font-display: block) is what you see every time, which is the one worth
// checking anyway.
const NO_STORE = {
	'Cache-Control': 'no-store, max-age=0',
	'Pragma': 'no-cache', // for anything speaking HTTP/1.0 in between
	'Expires': '0'
};

async function sendFile(res, filePath) {
	const info = await stat(filePath);
	if (!info.isFile()) return notFound(res);

	res.writeHead(200, {
		'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
		'Content-Length': info.size,
		'Last-Modified': info.mtime.toUTCString(),
		...NO_STORE
	});

	createReadStream(filePath).pipe(res);
}

function notFound(res) {
	// Also no-store: a cached 404 means a file you've just added stays missing.
	res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE });
	res.end('Not found');
}

server.listen(PORT, () => {
	console.log(`\n  thumbcinema  →  http://localhost:${PORT}\n`);
	if (!process.env.DATABASE_URL) {
		console.log('  ⚠  DATABASE_URL is not set — the gallery and saving will fail.');
		console.log('     Copy .env.example to .env and fill it in.\n');
	}
});

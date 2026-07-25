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

async function sendFile(res, filePath) {
	const info = await stat(filePath);
	if (!info.isFile()) return notFound(res);

	res.writeHead(200, {
		'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
		'Content-Length': info.size,
		'Cache-Control': 'no-cache' // always see your edits
	});

	createReadStream(filePath).pipe(res);
}

function notFound(res) {
	res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end('Not found');
}

server.listen(PORT, () => {
	console.log(`\n  thumbcinema  →  http://localhost:${PORT}\n`);
	if (!process.env.DATABASE_URL) {
		console.log('  ⚠  DATABASE_URL is not set — the gallery and saving will fail.');
		console.log('     Copy .env.example to .env and fill it in.\n');
	}
});

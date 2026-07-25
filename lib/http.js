// Small request/response helpers. Deliberately plain Node http types rather than
// Vercel's req.query/req.body sugar, so the exact same router runs under
// `npm run dev` and under Vercel with no adapter in between.

export const MAX_BODY_BYTES = 4 * 1024 * 1024; // just under Vercel's 4.5 MB request cap

export function readBody(req, limit = MAX_BODY_BYTES) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;

		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new HttpError(413, 'Flipbook is too large to save.'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});

		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

export async function readForm(req) {
	const body = await readBody(req);
	return new URLSearchParams(body.toString('utf8'));
}

export function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
		'Cache-Control': 'no-store'
	});
	res.end(body);
}

export function sendText(res, status, text, headers = {}) {
	res.writeHead(status, {
		'Content-Type': 'text/plain; charset=utf-8',
		'Content-Length': Buffer.byteLength(text),
		...headers
	});
	res.end(text);
}

export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

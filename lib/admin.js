import { timingSafeEqual } from 'node:crypto';

import { HttpError } from './http.js';

/**
 * Admin auth, such as it is: a single shared secret in ADMIN_TOKEN.
 *
 * That's proportionate. There is exactly one administrator, the only privileged
 * actions are flipping two booleans on a row, and the alternative — real accounts —
 * is the thing this rebuild deliberately deleted. The token is never in the repo;
 * it lives in a Vercel environment variable and in your browser's localStorage.
 *
 * If ADMIN_TOKEN is unset the admin API doesn't exist at all: every request 404s,
 * so a deployment that forgot to set it fails closed rather than open.
 */
export function requireAdmin(req) {
	const expected = process.env.ADMIN_TOKEN;

	if (!expected || expected.length < 16) {
		// Indistinguishable from "no such route", which is the point.
		throw new HttpError(404, 'Not found');
	}

	if (!isAdmin(req)) throw new HttpError(401, 'Not authorised.');
}

/**
 * Non-throwing variant, for routes that are public but behave differently for the
 * administrator — the browse listing includes NSFW rows when it's you, so anything
 * you've moderated can still be found and un-flagged.
 */
export function isAdmin(req) {
	const expected = process.env.ADMIN_TOKEN;
	if (!expected || expected.length < 16) return false;

	const header = req.headers.authorization || '';
	const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';

	return constantTimeEquals(supplied, expected);
}

function constantTimeEquals(a, b) {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');

	// timingSafeEqual throws on length mismatch, which would itself leak the
	// length. Hash-free way around it: compare against a padded copy and fold the
	// length check into the result.
	if (bufA.length !== bufB.length) {
		timingSafeEqual(bufB, bufB); // keep the work constant
		return false;
	}

	return timingSafeEqual(bufA, bufB);
}

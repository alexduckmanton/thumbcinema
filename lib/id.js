import { randomBytes } from 'node:crypto';

// Flipbook IDs show up in URLs (/f/xxxxxxxx) so they want to be short, opaque and
// unambiguous when read aloud or copied. The 2013 site used sequential WordPress
// post IDs, which meant every flipbook's neighbours were guessable.
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'; // no 0/1/l/o
const LENGTH = 10;

export function newId() {
	const bytes = randomBytes(LENGTH);
	let id = '';
	for (let i = 0; i < LENGTH; i++) {
		id += ALPHABET[bytes[i] % ALPHABET.length];
	}
	return id;
}

// Deliberately looser than ALPHABET. Archive IDs are `a{wordpress_post_id}` and so
// contain the 0s and 1s that ALPHABET leaves out — the restricted alphabet is about
// generating IDs that are unambiguous to read, not about what a valid ID looks like.
// This only needs to reject anything that isn't a plausible lookup key.
export function isValidId(value) {
	return typeof value === 'string' && /^[a-z0-9]{1,32}$/.test(value);
}

#!/usr/bin/env node
//
// Imports the surviving 2012-2015 flipbooks out of the old WordPress uploads
// directories and into Postgres.
//
// The database backup that came off the server is a zero-byte file, so every piece
// of metadata WordPress held — titles, authors, descriptions, likes, view counts —
// is gone. What survived is the uploads directory: the artwork files themselves and
// their generated thumbnails. Filenames follow
//
//     {post_id}_u{user_id}_flipbook.{xml,txt}
//     {post_id}_u{user_id}_thumbnail.png
//
// so the post ID is the one identifier we can still recover, and it's what makes
// this import idempotent (ON CONFLICT on legacy_id).
//
// The `featured` flag is reconstructed here rather than recovered. WordPress
// category 6 ("featured", and the only thing the 2013 homepage listed) was assigned
// automatically to any save that wasn't NSFW, wasn't a draft, and had a logged-in
// author — so in practice it meant "not anonymous". The categories lived in the
// database, but the author ID survives in every filename, and anonymous saves were
// all reassigned to the `lostandfound` account. Identify that account and you
// recover most of the flag. See ANON_USER_IDS below and docs/archive.md.
//
// Usage:
//   npm run db:import-archive                    # reads ./_original
//   npm run db:import-archive -- --dry-run
//   npm run db:import-archive -- --source /path/to/backup
//   npm run db:import-archive -- --reset-featured  # re-derive, discarding curation

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, sep } from 'node:path';
import { gzip as gzipCb } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './lib/env.js';

loadEnv();

const gzip = promisify(gzipCb);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESET_FEATURED = args.includes('--reset-featured');
const SOURCE = argValue('--source') ??
	fileURLToPath(new URL('../_original', import.meta.url));

// The two WordPress author IDs that mean "nobody was logged in".
//
//   84 — the `lostandfound` account. 258 of 588 flipbooks, running continuously
//        from Feb 2013 to Jan 2019, no custom avatar. Real users appear in bursts.
//    0 — the same thing before that account existed: get_current_user_id() returned
//        0 and the fallback had nothing to reassign to. All 16 are Jan 2013, and
//        they stop the exact month u84 starts. Clean handover, no overlap.
//
// Neither was a person, so neither was ever featured.
const ANON_USER_IDS = new Set([84, 0]);

// Anything smaller than this is a save that failed halfway; there are a handful.
const MIN_BYTES = 500;

const FLIPBOOK_RE = /^(\d+)_u(\d+)_flipbook\.(xml|txt)$/;
const THUMBNAIL_RE = /^(\d+)_u(\d+)_thumbnail\.png$/;


// --- collect ---------------------------------------------------------------

console.log(`Scanning ${SOURCE} ...`);

const files = await walk(SOURCE);

/** legacy post id -> { path, format, size, date } */
const flipbooks = new Map();
/** legacy post id -> path */
const thumbnails = new Map();

for (const path of files) {
	const name = basename(path);

	const flip = FLIPBOOK_RE.exec(name);
	if (flip) {
		const legacyId = Number(flip[1]);
		const format = flip[3] === 'xml' ? 'svg' : 'legacy-json';
		const size = (await stat(path)).size;
		if (size < MIN_BYTES) continue;

		const existing = flipbooks.get(legacyId);
		// The two backups overlap. Prefer the converted SVG over the legacy JSON,
		// then simply the larger file — a truncated copy is the only way two
		// copies of the same post ID differ.
		if (!existing ||
			(existing.format === 'legacy-json' && format === 'svg') ||
			(existing.format === format && size > existing.size)) {
			flipbooks.set(legacyId, {
				path,
				format,
				size,
				userId: Number(flip[2]),
				date: dateFromPath(path)
			});
		}
		continue;
	}

	const thumb = THUMBNAIL_RE.exec(name);
	if (thumb) {
		const legacyId = Number(thumb[1]);
		const size = (await stat(path)).size;
		const existing = thumbnails.get(legacyId);
		if (!existing || size > existing.size) thumbnails.set(legacyId, { path, size });
	}
}

console.log(`Found ${flipbooks.size} flipbooks, ${thumbnails.size} thumbnails.\n`);

if (!flipbooks.size) {
	console.error('Nothing to import. Is --source pointing at the WordPress backup?');
	process.exit(1);
}


// --- import ----------------------------------------------------------------

const { query, closePool } = await import('../lib/db.js');

let imported = 0, skipped = 0, rawBytes = 0, storedBytes = 0, featuredCount = 0;
const ids = [...flipbooks.keys()].sort((a, b) => a - b);

// Re-running must not undo curation. `featured` is set on first insert from the
// author-ID inference and then left alone, because by the second run it reflects
// decisions made in admin mode. --reset-featured opts back into the inference.
const featuredOnConflict = RESET_FEATURED
	? ',\n\t\t\t\t     featured   = EXCLUDED.featured'
	: '';

try {
	for (const legacyId of ids) {
		const entry = flipbooks.get(legacyId);

		let data;
		try {
			data = await readFile(entry.path);
		} catch (err) {
			console.warn(`  ! ${legacyId}: unreadable (${err.code})`);
			skipped++;
			continue;
		}

		if (!isValid(data, entry.format)) {
			console.warn(`  ! ${legacyId}: not valid ${entry.format}, skipping`);
			skipped++;
			continue;
		}

		const dataGz = await gzip(data, { level: 9 });
		const thumbEntry = thumbnails.get(legacyId);
		const thumbnail = thumbEntry ? await readFile(thumbEntry.path) : null;

		rawBytes += data.length;
		storedBytes += dataGz.length + (thumbnail?.length ?? 0);

		const featured = !ANON_USER_IDS.has(entry.userId);
		if (featured) featuredCount++;

		if (!DRY_RUN) {
			await query(
				`INSERT INTO flipbooks
				     (id, title, description, format, source, data_gz, thumbnail,
				      legacy_id, legacy_user_id, featured, created_at)
				 VALUES ($1, $2, '', $3, 'archive', $4, $5, $6, $7, $8, $9)
				 ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL
				 DO UPDATE SET
				     data_gz        = EXCLUDED.data_gz,
				     thumbnail      = EXCLUDED.thumbnail,
				     format         = EXCLUDED.format,
				     legacy_user_id = EXCLUDED.legacy_user_id,
				     created_at     = EXCLUDED.created_at${featuredOnConflict}`,
				[
					`a${legacyId}`,
					`Flipbook #${legacyId}`,
					entry.format,
					dataGz,
					thumbnail,
					legacyId,
					entry.userId,
					featured,
					entry.date
				]
			);
		}

		imported++;
		if (imported % 50 === 0) console.log(`  ... ${imported}/${ids.length}`);
	}

	console.log(`\n${DRY_RUN ? '[dry run] ' : ''}Imported ${imported}, skipped ${skipped}.`);
	console.log(`Artwork ${mb(rawBytes)} raw → ${mb(storedBytes)} stored ` +
		`(${Math.round((storedBytes / rawBytes) * 100)}%).`);
	console.log(`Featured (inferred): ${featuredCount}, anonymous: ${imported - featuredCount}.`);

	if (!RESET_FEATURED && !DRY_RUN) {
		console.log('Existing rows kept their `featured` value; pass --reset-featured to re-derive.');
	}

} finally {
	await closePool();
}


// --- helpers ---------------------------------------------------------------

async function walk(dir) {
	const found = [];
	let entries;

	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (err) {
		if (err.code === 'ENOENT') {
			console.error(`\n${dir} does not exist.`);
			console.error('The archive lives in _original/, which is gitignored — see docs/archive.md.\n');
			process.exit(1);
		}
		throw err;
	}

	for (const entry of entries) {
		const path = join(dir, entry.name);
		// Skip the WordPress core and theme trees; only uploads hold flipbook data.
		if (entry.isDirectory()) {
			if (entry.name === 'wp-admin' || entry.name === 'wp-includes' ||
				entry.name === '.git' || entry.name === 'node_modules') continue;
			found.push(...await walk(path));
		} else if (entry.isFile()) {
			found.push(path);
		}
	}

	return found;
}

function isValid(buffer, format) {
	if (format === 'svg') {
		return buffer.subarray(0, 200).toString('utf8').trimStart().startsWith('<svg');
	}
	try {
		const parsed = JSON.parse(buffer.toString('utf8'));
		return Array.isArray(parsed?.layers) && parsed.layers.length > 0;
	} catch {
		return false;
	}
}

// WordPress filed uploads under uploads/YYYY/MM/. That directory is the only date
// information left, and it's accurate to the month the flipbook was made.
function dateFromPath(path) {
	const parts = path.split(sep);
	for (let i = 0; i < parts.length - 1; i++) {
		if (/^(19|20)\d{2}$/.test(parts[i]) && /^(0[1-9]|1[0-2])$/.test(parts[i + 1])) {
			return new Date(Date.UTC(Number(parts[i]), Number(parts[i + 1]) - 1, 1));
		}
	}
	return new Date(Date.UTC(2013, 0, 1));
}

function argValue(flag) {
	const i = args.indexOf(flag);
	return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

function mb(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

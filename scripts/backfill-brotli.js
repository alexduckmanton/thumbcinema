#!/usr/bin/env node
//
// Fills in data_br for every row that hasn't got one.
//
// Rerunnable and interruptible: it only ever looks at rows where data_br IS NULL, so
// stopping it halfway and starting again picks up where it left off, and running it
// after a `time-capsule` save fills in the one row that branch left behind.
//
//   npm run db:backfill-brotli              # everything outstanding
//   npm run db:backfill-brotli -- --limit 50
//   npm run db:backfill-brotli -- --dry-run # compress and report, write nothing
//
// It is slow on purpose. Brotli at quality 11 over a nine-megabyte archive file takes
// the best part of a minute, and it is paid once for bytes that are then immutable and
// cached forever — so the whole archive is a coffee's worth of CPU, and every reader
// of every one of those flipbooks downloads a sixth of what they did.

import { gunzip as gunzipCb } from 'node:zlib';
import { promisify } from 'node:util';

import { loadEnv } from './lib/env.js';

loadEnv();

const { query, closePool } = await import('../lib/db.js');
const { brotli } = await import('../lib/flipbooks.js');

const gunzip = promisify(gunzipCb);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = Number(argValue('--limit')) || null;

// One row at a time, and only its id up front. The bodies run to megabytes and the
// point of this script is that it never has more than one of them in memory.
const { rows: pending } = await query(
	`SELECT id FROM flipbooks WHERE data_br IS NULL ORDER BY length(data_gz) ASC${LIMIT ? ` LIMIT ${LIMIT}` : ''}`
);

if (!pending.length) {
	console.log('Nothing to do — every flipbook already has a brotli copy.');
	await closePool();
	process.exit(0);
}

console.log(`${pending.length} flipbook(s) to compress${DRY_RUN ? ' (dry run)' : ''}.\n`);

let done = 0;
let gzTotal = 0;
let brTotal = 0;

for (const { id } of pending) {
	const { rows } = await query('SELECT data_gz FROM flipbooks WHERE id = $1', [id]);
	const gz = rows[0]?.data_gz;
	if (!gz) continue;

	const started = Date.now();
	const raw = await gunzip(gz);
	const br = await brotli(raw);

	// Never write a copy that is bigger than what we already serve — it would only
	// mean handing a reader more bytes for the privilege of asking for brotli. It
	// happens on the very smallest rows, where brotli's dictionary costs more than
	// the file saves. Those keep data_br null and go on being served as gzip.
	if (br.length >= gz.length) {
		console.log(`  ${id}  ${fmt(gz.length)} → ${fmt(br.length)}  skipped, no smaller`);
		continue;
	}

	if (!DRY_RUN) await query('UPDATE flipbooks SET data_br = $2 WHERE id = $1', [id, br]);

	gzTotal += gz.length;
	brTotal += br.length;
	done++;

	console.log(
		`  ${id}  ${fmt(gz.length)} → ${fmt(br.length)}  ` +
		`(${((br.length / gz.length) * 100).toFixed(0)}%, ${((Date.now() - started) / 1000).toFixed(1)}s)  ` +
		`[${done}/${pending.length}]`
	);
}

console.log(
	`\n${done} written. ${fmt(gzTotal)} of gzip → ${fmt(brTotal)} of brotli` +
	(gzTotal ? ` (${((brTotal / gzTotal) * 100).toFixed(1)}%).` : '.')
);

await closePool();

function fmt(bytes) {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${bytes} B`;
}

function argValue(name) {
	const index = args.indexOf(name);
	return index === -1 ? null : args[index + 1];
}

#!/usr/bin/env node
//
// Fills in thumbnail_svg for every SVG-format row that hasn't got one.
//
// The gallery shows a card's cover page as an SVG cut out of the artwork rather than
// as a 640x360 PNG of it — a couple of kilobytes against tens, and sharp at whatever
// size the card is. New saves write one; this is how the 438 SVG-format archive rows
// and anything saved from `time-capsule` get theirs.
//
//   npm run db:backfill-thumbnails               # everything outstanding
//   npm run db:backfill-thumbnails -- --limit 50
//   npm run db:backfill-thumbnails -- --dry-run  # extract and report, write nothing
//
// Rerunnable and interruptible: it only ever looks at rows where thumbnail_svg IS
// NULL. The 147 legacy-json rows are skipped and always will be — that format is
// point lists with no paths in it, so there is no page to lift out. Those cards go on
// showing the PNG, which is what the fallback is for.

import { gunzip as gunzipCb, brotliDecompress as brotliDecompressCb } from 'node:zlib';
import { promisify } from 'node:util';

import { loadEnv } from './lib/env.js';

loadEnv();

const { query, closePool } = await import('../lib/db.js');
const { brotli } = await import('../lib/flipbooks.js');
const { coverSvg } = await import('../lib/thumbnail.js');

const gunzip = promisify(gunzipCb);
const brotliDecompress = promisify(brotliDecompressCb);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = Number(argValue('--limit')) || null;

// Ids first and bodies one at a time, as the brotli backfill does: the artwork runs
// to megabytes and there is no reason for two of them to be in memory at once.
const { rows: pending } = await query(
	`SELECT id FROM flipbooks
	  WHERE thumbnail_svg IS NULL AND format = 'svg'
	  ORDER BY created_at DESC, id DESC${LIMIT ? ` LIMIT ${LIMIT}` : ''}`
);

const { rows: [skipped] } = await query(
	`SELECT count(*)::int AS n FROM flipbooks WHERE thumbnail_svg IS NULL AND format <> 'svg'`
);

if (!pending.length) {
	console.log('Nothing to do — every SVG flipbook already has an SVG thumbnail.');
	if (skipped?.n) console.log(`(${skipped.n} legacy-json row(s) skipped, as always.)`);
	await closePool();
	process.exit(0);
}

console.log(`${pending.length} flipbook(s) to cut a cover from${DRY_RUN ? ' (dry run)' : ''}.`);
if (skipped?.n) console.log(`${skipped.n} legacy-json row(s) skipped — no SVG to take a page out of.`);
console.log('');

let done = 0;
let failed = 0;
let pngTotal = 0;
let svgTotal = 0;

for (const { id } of pending) {
	const { rows } = await query(
		'SELECT data_gz, data_br, length(thumbnail) AS png FROM flipbooks WHERE id = $1',
		[id]
	);
	const row = rows[0];
	if (!row) continue;

	// One unreadable row must not take the other four hundred with it. This is a
	// batch over the whole archive, and the useful behaviour on a row whose artwork
	// won't decompress is to say which one and carry on — it keeps its null and goes
	// on showing the PNG, which is exactly what the fallback is for.
	let cover;
	try {
		const artwork = row.data_br
			? await brotliDecompress(row.data_br)
			: await gunzip(row.data_gz);
		cover = coverSvg(artwork.toString('utf8'), {});
	} catch (err) {
		console.log(`  ${id}  could not be read (${err.message}) — skipped`);
		failed++;
		continue;
	}

	if (!cover) {
		console.log(`  ${id}  no page to take — skipped`);
		continue;
	}

	const compressed = await brotli(Buffer.from(cover.svg, 'utf8'));
	const png = row.png ?? 0;

	// The same rule the save path applies, and the same one data_br follows against
	// the gzip: never store a thumbnail that is worse than the one already there. A
	// row that fails it keeps its null and goes on showing the PNG.
	if (png && compressed.length >= png) {
		console.log(`  ${id}  page ${cover.page}  ${fmt(compressed.length)} vs ${fmt(png)} of PNG — skipped, no smaller`);
		continue;
	}

	if (!DRY_RUN) {
		await query('UPDATE flipbooks SET thumbnail_svg = $2 WHERE id = $1', [id, compressed]);
	}

	pngTotal += png;
	svgTotal += compressed.length;
	done++;

	console.log(
		`  ${id}  page ${cover.page}  ${fmt(png)} of PNG → ${fmt(compressed.length)} of SVG  ` +
		`(${png ? `${((compressed.length / png) * 100).toFixed(0)}%` : 'no PNG'})  [${done}/${pending.length}]`
	);
}

console.log(
	`\n${done} written. ${fmt(pngTotal)} of PNG → ${fmt(svgTotal)} of SVG` +
	(pngTotal ? ` (${((svgTotal / pngTotal) * 100).toFixed(1)}%).` : '.')
);
if (failed) console.log(`${failed} row(s) could not be read and were left alone.`);
console.log('The PNGs stay where they are: `time-capsule` serves them, and they are the fallback.');

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

#!/usr/bin/env node
//
// What's in the database, and how much room is it taking. Handy after an import
// and for keeping an eye on the Neon free tier's storage allowance.

import { loadEnv } from './lib/env.js';

loadEnv();

const { query, closePool } = await import('../lib/db.js');

try {
	const { rows: [totals] } = await query(`
		SELECT
			count(*)                                        AS flipbooks,
			count(*) FILTER (WHERE source = 'archive')      AS archive,
			count(*) FILTER (WHERE source = 'user')         AS user_made,
			count(*) FILTER (WHERE format = 'legacy-json')  AS legacy,
			count(*) FILTER (WHERE featured AND NOT nsfw)   AS featured,
			count(*) FILTER (WHERE nsfw)                    AS nsfw,
			count(*) FILTER (WHERE thumbnail IS NULL)       AS missing_thumbnails,
			count(*) FILTER (WHERE thumbnail_svg IS NULL AND format = 'svg')
			                                                AS missing_svg_thumbnails,
			coalesce(sum(views), 0)                         AS views,
			pg_size_pretty(coalesce(sum(length(data_gz)), 0))  AS artwork_size,
			pg_size_pretty(coalesce(sum(length(thumbnail)), 0)) AS thumbnail_size,
			pg_size_pretty(coalesce(sum(length(thumbnail_svg)), 0)) AS thumbnail_svg_size,
			pg_size_pretty(pg_total_relation_size('flipbooks')) AS table_size
		FROM flipbooks
	`);

	console.log(`
  flipbooks           ${totals.flipbooks}
    from the archive   ${totals.archive}
    made since         ${totals.user_made}
    legacy json format ${totals.legacy}
    no thumbnail       ${totals.missing_thumbnails}
    no svg thumbnail   ${totals.missing_svg_thumbnails}  (npm run db:backfill-thumbnails)

  on the Featured tab ${totals.featured}
  hidden as nsfw      ${totals.nsfw}

  total views         ${totals.views}

  artwork             ${totals.artwork_size}
  thumbnails, png     ${totals.thumbnail_size}
  thumbnails, svg     ${totals.thumbnail_svg_size}
  table on disk       ${totals.table_size}
`);

} catch (err) {
	console.error('✗', err.message);
	process.exitCode = 1;
} finally {
	await closePool();
}

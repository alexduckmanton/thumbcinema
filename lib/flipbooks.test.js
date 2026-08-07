/**
 * What happens when the code is newer than the table.
 *
 * A push deploys on its own and `npm run db:migrate` is a thing a person runs, so
 * there is a window in which the two disagree — and the column in question is read by
 * the query behind the home page. These are the tests for the window.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));

const { query } = await import('./db.js');
const { listFlipbooks, getFlipbook, getFlipbookThumbnailSvg, createFlipbook } =
	await import('./flipbooks.js');

/** What Postgres answers with when a column isn't there. */
function undefinedColumn() {
	const error = new Error('column "thumbnail_svg" does not exist');
	error.code = '42703';
	return error;
}

/**
 * Does this statement need the column to exist?
 *
 * The aliases have to come off first, or every fallback looks like a reference: the
 * one the gallery falls back to is `false AS has_thumbnail_svg`, and the thumbnail
 * route's is `NULL AS thumbnail_svg`. Both name the column and neither reads it.
 */
function readsColumn(sql) {
	return sql
		.replace(/AS\s+has_thumbnail_svg/g, '')
		.replace(/AS\s+thumbnail_svg/g, '')
		.includes('thumbnail_svg');
}

const mentionsColumn = (call) => readsColumn(call[0]);

/** A database that hasn't been migrated: anything reading the column is rejected. */
function unmigrated(rows = []) {
	query.mockImplementation((sql) => {
		if (readsColumn(sql)) throw undefinedColumn();
		return Promise.resolve({ rows });
	});
}

beforeEach(() => {
	query.mockReset();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('with the column there', () => {
	it('asks for it and offers the SVG a row has', async () => {
		query.mockResolvedValue({ rows: [{ id: 'abc', has_thumbnail_svg: true }] });

		const { items } = await listFlipbooks({ view: 'all' });

		expect(query.mock.calls.some(mentionsColumn)).toBe(true);
		expect(items[0].thumbnail_svg_url).toBe('/api/flipbooks/abc/thumbnail.svg');
	});

	it('offers nothing for a row that has not got one', async () => {
		query.mockResolvedValue({ rows: [{ id: 'abc', has_thumbnail_svg: false }] });

		const { items } = await listFlipbooks({ view: 'all' });

		expect(items[0].thumbnail_svg_url).toBe(null);
		expect(items[0].thumbnail_url).toBe('/api/flipbooks/abc/thumbnail');
	});
});

describe('with the column missing', () => {
	it('still lists the flipbooks, with every card on its PNG', async () => {
		unmigrated([{ id: 'abc', has_thumbnail_svg: false }]);

		const { items } = await listFlipbooks({ view: 'featured' });

		expect(items[0].thumbnail_svg_url).toBe(null);
		expect(items[0].thumbnail_url).toBe('/api/flipbooks/abc/thumbnail');
		// Asked once with it and once without, rather than giving up.
		expect(query.mock.calls.filter(mentionsColumn)).toHaveLength(1);
	});

	it('says so once rather than on every request', async () => {
		unmigrated([{ id: 'abc' }]);

		await listFlipbooks({ view: 'all' });
		await listFlipbooks({ view: 'all' });
		await listFlipbooks({ view: 'all' });

		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.warn.mock.calls[0][0]).toContain('db:migrate');
	});

	it('still serves a flipbook its metadata', async () => {
		unmigrated([{ id: 'abc', title: 't', source: 'user', format: 'svg' }]);

		const flipbook = await getFlipbook('abc', { countView: true });

		expect(flipbook.id).toBe('abc');
		expect(flipbook.thumbnail_svg_url).toBe(null);
	});

	it('has no SVG thumbnail to give out', async () => {
		unmigrated([{ thumbnail_svg: null }]);

		// Null is a 404 in the router, which is what a row without one already gets.
		expect(await getFlipbookThumbnailSvg('abc')).toBe(null);
	});

	it('still saves a flipbook, which is the one that really matters', async () => {
		unmigrated();

		const id = await createFlipbook({
			title: 'A drawing',
			description: '',
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,640,360">' +
				'<g/><g/><g/><g stroke="#444"><path d="M1,1l2,2"/></g></svg>',
			thumbnailDataUrl: '',
			cover: 0,
		});

		expect(id).toBeTruthy();

		// The last one: the first is the attempt that named the column and was refused.
		const insert = query.mock.calls.findLast((call) => call[0].includes('INSERT'));
		expect(insert[0]).not.toContain('thumbnail_svg');
		// The artwork and the PNG still go in; only the derived column is dropped.
		expect(insert[0]).toContain('data_br');
		expect(insert[0]).toContain('thumbnail');
	});
});

describe('once the migration lands', () => {
	it('picks the column up without a restart', async () => {
		unmigrated([{ id: 'old', has_thumbnail_svg: false }]);
		await listFlipbooks({ view: 'all' });

		// The same process, after somebody has run the migration.
		query.mockReset();
		query.mockResolvedValue({ rows: [{ id: 'new', has_thumbnail_svg: true }] });

		const { items } = await listFlipbooks({ view: 'all' });

		expect(query.mock.calls.some(mentionsColumn)).toBe(true);
		expect(items[0].thumbnail_svg_url).toBe('/api/flipbooks/new/thumbnail.svg');
	});
});

describe('any other database error', () => {
	it('is raised rather than retried', async () => {
		const boom = new Error('connection terminated');
		boom.code = '57P01';
		query.mockRejectedValue(boom);

		await expect(listFlipbooks({ view: 'all' })).rejects.toThrow('connection terminated');
		expect(query).toHaveBeenCalledTimes(1);
	});
});

/**
 * Remixes: the two columns, and what happens around them.
 *
 * The lineage is flat and both columns are written at insert from the parent row, so
 * everything worth testing is either "what did the INSERT say" or "what did the SELECT
 * filter on". Neither needs a database to answer.
 */
describe('remixes', () => {
	/** The smallest thing `createFlipbook` will accept as artwork. */
	const ARTWORK =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,640,360">' +
		'<g/><g/><g/><g stroke="#444"><path d="M1,1l2,2"/></g></svg>';

	function save(remixOf) {
		return createFlipbook({
			title: 'A drawing',
			description: '',
			svg: ARTWORK,
			thumbnailDataUrl: '',
			cover: 0,
			remixOf
		});
	}

	/** The INSERT, as `[sql, params]`. There is exactly one per save. */
	function insertOf() {
		return query.mock.calls.findLast((call) => call[0].includes('INSERT'));
	}

	/**
	 * A migrated database in which `id` is the only flipbook that exists.
	 *
	 * The parent lookup is the only SELECT `createFlipbook` makes, so answering every
	 * SELECT with this row is enough to stand in for one.
	 */
	function withParent(row) {
		query.mockImplementation((sql) =>
			Promise.resolve({ rows: sql.includes('SELECT') && row ? [row] : [] })
		);
	}

	it('records the parent and takes the root from it', async () => {
		withParent({ id: 'original1', format: 'svg', remix_root: null });

		await save('original1');

		const [sql, params] = insertOf();
		expect(sql).toContain('remix_of');
		expect(sql).toContain('remix_root');
		// An original is its own root, so the first remix of it carries its id twice.
		expect(params).toContain('original1');
		expect(params.filter((value) => value === 'original1')).toHaveLength(2);
	});

	it('keeps a remix of a remix under the same original', async () => {
		// The parent is itself a remix, so it already carries the root.
		withParent({ id: 'remix1', format: 'svg', remix_root: 'original1' });

		await save('remix1');

		const [, params] = insertOf();
		// Parent is what it was made from; root is the head of the chain. This is the
		// whole of what makes the list flat, and the whole of why both are stored.
		expect(params).toContain('remix1');
		expect(params).toContain('original1');
	});

	it('drops the link when the parent does not exist', async () => {
		withParent(null);

		await save('ghost12345');

		const [sql, params] = insertOf();
		expect(sql).not.toContain('remix_of');
		expect(params).not.toContain('ghost12345');
	});

	it('drops the link when the parent is a 2012 flipbook', async () => {
		// Point lists, which only come back through the pencil — so what the drawing
		// tool could open is a resampled copy rather than the artwork.
		withParent({ id: 'legacy1', format: 'legacy-json', remix_root: null });

		await save('legacy1');

		expect(insertOf()[0]).not.toContain('remix_of');
	});

	it('saves as an original when nothing was asked for', async () => {
		withParent(null);

		await save(null);

		const [sql] = insertOf();
		expect(sql).not.toContain('remix_of');
		// And it didn't go looking for a parent it was never given.
		expect(query.mock.calls.some((call) => call[0].includes('remix_root'))).toBe(false);
	});

	it('lists a flipbook by its root rather than by its parent', async () => {
		query.mockResolvedValue({ rows: [] });

		await listFlipbooks({ remixOf: 'original1' });

		const [sql, params] = query.mock.calls[0];
		expect(params).toContain('original1');

		// The WHERE alone: `featured` is also a column in the select list, so asking
		// the whole statement about it would pass whatever the filter said.
		const where = /WHERE ([\s\S]*?)\n\s*ORDER BY/.exec(sql)[1];
		expect(where).toContain('remix_root = $');
		// Not the gallery: `featured` says nothing about a remix, and a list that hid
		// the un-promoted ones would be most of the answer missing.
		expect(where).not.toContain('featured');
		// Moderation still applies, because that is not curation.
		expect(where).toContain('NOT nsfw');
	});

	it('says a flipbook what it was made from, and what that is called', async () => {
		query.mockResolvedValue({
			rows: [{
				id: 'remix1', title: 'Mine', source: 'user', format: 'svg',
				remix_of: 'original1', remix_of_title: 'Theirs', remix_root: 'original1'
			}]
		});

		const flipbook = await getFlipbook('remix1');

		expect(flipbook.remix_of).toEqual({ id: 'original1', title: 'Theirs' });
		expect(flipbook.remix_root).toBe('original1');
	});

	it('gives an original its own id as the root, so its page can list its remixes', async () => {
		query.mockResolvedValue({
			rows: [{ id: 'original1', title: 'Theirs', source: 'user', format: 'svg', remix_root: null }]
		});

		const flipbook = await getFlipbook('original1');

		expect(flipbook.remix_of).toBe(null);
		expect(flipbook.remix_root).toBe('original1');
	});
});

/**
 * The window between a deploy and its migration, for the columns that arrived after
 * `thumbnail_svg` did.
 *
 * The rule that matters here is the one that inverts: every other caller degrades to
 * "no row has one", and a *filter* degrades the other way. A remix listing that lost
 * its WHERE clause would answer "what was made from this flipbook" with the gallery.
 */
describe('with the remix columns missing', () => {
	function undefinedRemixColumn() {
		const error = new Error('column "remix_root" does not exist');
		error.code = '42703';
		return error;
	}

	beforeEach(() => {
		query.mockImplementation((sql) => {
			if (/remix_of|remix_root/.test(sql.replace(/(?:NULL|false) AS remix\w+/g, ''))) {
				throw undefinedRemixColumn();
			}
			return Promise.resolve({ rows: [] });
		});
	});

	it('answers a remix listing with nothing at all, never with the gallery', async () => {
		const { items } = await listFlipbooks({ remixOf: 'original1' });

		expect(items).toEqual([]);

		// The fallback filters everything out rather than filtering on nothing.
		const last = query.mock.calls.at(-1);
		expect(last[0]).toContain('false');
		expect(last[1]).not.toContain('original1');
	});

	it('drops only the column that is missing, not every optional column', async () => {
		await listFlipbooks({ view: 'all' });

		// thumbnail_svg is a different migration and this database has it. Standing the
		// whole set down on one failure would take the SVG thumbnails off every card in
		// the gallery for the length of the deploy window.
		const last = query.mock.calls.at(-1);
		expect(last[0]).toContain('thumbnail_svg IS NOT NULL');
	});

	it('keeps the SVG thumbnail on a save, which phrases the error differently', async () => {
		// Postgres says `column "x" does not exist` for a SELECT and `column "x" of
		// relation "flipbooks" does not exist` for an INSERT. Reading only the first
		// leaves the second unparsed, which stands every optional column down and takes
		// the SVG thumbnail off a save that had nothing wrong with it. Found by running
		// a save against a database with the columns genuinely missing, not here.
		query.mockImplementation((sql) => {
			const named = /remix_of|remix_root/.exec(sql.replace(/(?:NULL|false) AS remix\w+/g, ''));
			if (named) {
				// Postgres names the column the statement actually mentioned, and an INSERT
				// says "of relation" where a SELECT doesn't. Both halves matter: the wrong
				// name would stand down a column the statement never used and make no
				// progress, which is the loop's own bail-out rather than this bug.
				const error = new Error(
					`column "${named[0]}" of relation "flipbooks" does not exist`
				);
				error.code = '42703';
				throw error;
			}
			return Promise.resolve({ rows: [] });
		});

		await createFlipbook({
			title: 'A drawing',
			description: '',
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,640,360">' +
				'<g/><g/><g/><g stroke="#444"><path d="M1,1l2,2"/></g></svg>',
			thumbnailDataUrl: '',
			cover: 0,
			remixOf: 'original1'
		});

		const insert = query.mock.calls.findLast((call) => call[0].includes('INSERT'));
		expect(insert[0]).not.toContain('remix_of');
		expect(insert[0]).toContain('thumbnail_svg');
	});

	it('still saves, as an original', async () => {
		const id = await createFlipbook({
			title: 'A drawing',
			description: '',
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,640,360">' +
				'<g/><g/><g/><g stroke="#444"><path d="M1,1l2,2"/></g></svg>',
			thumbnailDataUrl: '',
			cover: 0,
			remixOf: 'original1'
		});

		expect(id).toBeTruthy();
		const insert = query.mock.calls.findLast((call) => call[0].includes('INSERT'));
		expect(insert[0]).not.toContain('remix_of');
	});
});

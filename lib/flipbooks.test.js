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

import { describe, expect, it } from 'vitest'

import { settledPageCount, type PageState } from './pages'

const page = (id: number, leaving = false): PageState => ({ id, segments: 0, leaving })

describe('settledPageCount', () => {
	it('counts the pages that are staying', () => {
		expect(settledPageCount([page(1), page(2), page(3)])).toBe(3)
	})

	/*
	 * The case this exists for. Deleting the only page inserts its replacement before
	 * the old one has finished falling, so for those 750ms the list holds two — and
	 * the raw length would flick the play buttons on and fade the save button in and
	 * out again for a flipbook that still has one page.
	 */
	it('does not count a page that is on its way off the screen', () => {
		expect(settledPageCount([page(1, true), page(2)])).toBe(1)
	})

	it('is unbothered by a list that is entirely leaving, or empty', () => {
		expect(settledPageCount([page(1, true)])).toBe(0)
		expect(settledPageCount([])).toBe(0)
	})
})

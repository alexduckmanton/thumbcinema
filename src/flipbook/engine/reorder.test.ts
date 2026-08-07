import { describe, expect, it } from 'vitest'

import { clampDrag, pageShift, targetIndex } from './reorder'

/** A round number, so a failure reads as "one page out" rather than as arithmetic. */
const STEP = 100

describe('clampDrag', () => {
	it('leaves a drag inside the flipbook alone', () => {
		expect(clampDrag(150, 1, 4, STEP)).toBe(150)
		expect(clampDrag(-40, 1, 4, STEP)).toBe(-40)
	})

	it('stops at the two ends', () => {
		// Page 1 of 4 can go one step back and two forward, and no further.
		expect(clampDrag(-500, 1, 4, STEP)).toBe(-100)
		expect(clampDrag(500, 1, 4, STEP)).toBe(200)
	})

	it('holds the only page still', () => {
		expect(clampDrag(80, 0, 1, STEP)).toBe(0)
	})
})

describe('targetIndex', () => {
	it('swaps as the page passes the halfway line', () => {
		expect(targetIndex(49, 1, 4, STEP)).toBe(1)
		expect(targetIndex(51, 1, 4, STEP)).toBe(2)
		expect(targetIndex(-51, 1, 4, STEP)).toBe(0)
	})

	it('counts whole pages, not just the next one', () => {
		expect(targetIndex(210, 0, 5, STEP)).toBe(2)
	})

	it('never leaves the flipbook', () => {
		expect(targetIndex(9999, 0, 3, STEP)).toBe(2)
		expect(targetIndex(-9999, 2, 3, STEP)).toBe(0)
	})

	/* The strip is measured, and for the frame before it has been laid out the pitch is
	   zero. Dividing by it would hand `NaN` to the scene as a page number. */
	it('stands still when the strip has no pitch yet', () => {
		expect(targetIndex(500, 1, 4, 0)).toBe(1)
		expect(targetIndex(500, 0, 1, STEP)).toBe(0)
	})
})

describe('pageShift', () => {
	/*
	 * Page 1 of five, carried forward to slot 3. Pages 2 and 3 are passed through and
	 * step back one each; page 4 is beyond the gap being closed and doesn't move.
	 */
	it('steps the pages the carried one passes through out of its way', () => {
		const shift = (index: number) => pageShift(index, 1, 3, STEP)

		expect(shift(0)).toBe(0)
		expect(shift(2)).toBe(-STEP)
		expect(shift(3)).toBe(-STEP)
		expect(shift(4)).toBe(0)
	})

	it('steps them the other way when the page is carried back', () => {
		const shift = (index: number) => pageShift(index, 3, 1, STEP)

		expect(shift(0)).toBe(0)
		expect(shift(1)).toBe(STEP)
		expect(shift(2)).toBe(STEP)
		expect(shift(4)).toBe(0)
	})

	it('displaces a page by one step however far the drag went', () => {
		expect(pageShift(1, 0, 9, STEP)).toBe(-STEP)
		expect(pageShift(8, 0, 9, STEP)).toBe(-STEP)
	})

	/* The carried page's own slot. Invisible — the canvas stands in front of it — but
	   it is where the strip takes the flipbook back at the end of the gesture. */
	it('carries the dragged page the whole way', () => {
		expect(pageShift(1, 1, 3, STEP)).toBe(2 * STEP)
		expect(pageShift(3, 3, 1, STEP)).toBe(-2 * STEP)
	})

	it('moves nothing at all while the page is over its own slot', () => {
		for (const index of [0, 1, 2, 3]) expect(pageShift(index, 1, 1, STEP)).toBe(0)
	})
})

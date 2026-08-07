import { describe, expect, it } from 'vitest'

import {
	clampDrag,
	pageShift,
	SLIDE_FAST_MS,
	SLIDE_SLOW_MS,
	slideDirection,
	slideInterval,
	slideReach,
	targetIndex,
} from './reorder'

/** A round number, so a failure reads as "one page out" rather than as arithmetic. */
const STEP = 100

describe('clampDrag', () => {
	it('leaves a drag inside the flipbook alone', () => {
		expect(clampDrag(150, 1, 4, STEP)).toBe(150)
		expect(clampDrag(-40, 1, 4, STEP)).toBe(-40)
	})

	/*
	 * Anchored on slot 1 of 4, the page can go one step back and two forward — plus the
	 * half a page of overhang at each end, which is what stops the end of a run tightening
	 * the clamp under a finger that hasn't moved.
	 */
	it('stops half a page past the two ends', () => {
		expect(clampDrag(-500, 1, 4, STEP)).toBe(-150)
		expect(clampDrag(500, 1, 4, STEP)).toBe(250)
	})

	// The window moves with the anchor: once the book has run four pages under the page,
	// four pages' worth of travel has opened up behind it.
	it('measures from the anchor, so a run opens travel up behind the page', () => {
		expect(clampDrag(80, 4, 6, STEP)).toBe(80)
		expect(clampDrag(-1000, 4, 6, STEP)).toBe(-450)
	})

	/*
	 * The property the overhang exists for, checked where it bites: a run ends with the
	 * anchor as far along as it can go, and `Math.round` leaves the page up to half a step
	 * out. Whatever the page was held at has to still be legal when the run stops, or the
	 * drawing is snatched sideways under a finger that never moved.
	 */
	it('never tightens under a page held where a run leaves it', () => {
		for (let out = 0; out <= 3; out++) {
			for (const side of [-1, 1]) {
				// The furthest a page held `out` slots away can be from its anchor.
				const drag = side * (out + 0.5) * STEP
				// Where `slideDirection` leaves the anchor, running that way in a 10-page book.
				const anchor = side > 0 ? 10 - 2 - out : 1 + out
				expect(clampDrag(drag, anchor, 10, STEP)).toBe(drag)
			}
		}
	})

	it('holds the only page all but still', () => {
		expect(clampDrag(800, 0, 1, STEP)).toBe(50)
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

describe('slideDirection', () => {
	it('does nothing while the page is near enough its own slot', () => {
		expect(slideDirection(0, 2, 6, STEP)).toBe(0)
		expect(slideDirection(30, 2, 6, STEP)).toBe(0)
	})

	/*
	 * A third of a page, which is short of the half it takes to claim the next slot — so
	 * a hold can start from a drag that hasn't moved anything yet, which on a phone is
	 * the difference between a comfortable swipe and one that ends off the glass.
	 */
	it('starts a third of a page out, before anything has swapped', () => {
		expect(slideDirection(34, 2, 6, STEP)).toBe(1)
		expect(slideDirection(-34, 2, 6, STEP)).toBe(-1)
	})

	/*
	 * The run ends with the page over the first or last slot rather than past it. Beyond
	 * that the flipbook would be sliding out from under a page with nowhere left to land.
	 */
	it('stops when the page is over the last slot there is', () => {
		expect(slideDirection(80, 5, 6, STEP)).toBe(0)
		expect(slideDirection(80, 4, 6, STEP)).toBe(1)
		expect(slideDirection(-80, 0, 6, STEP)).toBe(0)
		expect(slideDirection(-80, 1, 6, STEP)).toBe(-1)
	})

	it('stands still when the strip has no pitch yet', () => {
		expect(slideDirection(500, 2, 6, 0)).toBe(0)
	})
})

describe('slideInterval', () => {
	it('is a page at a time where the run starts, and quicker further out', () => {
		expect(slideInterval(0)).toBe(SLIDE_SLOW_MS)
		expect(slideInterval(0.5)).toBeLessThan(SLIDE_SLOW_MS)
		expect(slideInterval(1)).toBe(SLIDE_FAST_MS)
	})

	it('has a top speed, and cannot be pushed past it', () => {
		expect(slideInterval(4)).toBe(SLIDE_FAST_MS)
		expect(slideInterval(-4)).toBe(SLIDE_SLOW_MS)
	})

	/*
	 * The whole point of squaring it. Half a page out is where a hand rests once it has
	 * moved the page one slot, and on a straight line that is already a third of the
	 * throttle — so the rate you actually held was never the slow one, and the control was
	 * indistinguishable from not having one. Most of the travel has to stay slow.
	 */
	it('is still nearly the slow rate half way out', () => {
		const halfWay = slideInterval(0.5)
		expect(halfWay).toBeGreaterThan(slideInterval(0) - (SLIDE_SLOW_MS - SLIDE_FAST_MS) * 0.3)
		expect(1000 / halfWay).toBeLessThan(1.5)
	})

	it('spends most of its range in the last quarter, next to the edge', () => {
		const perSecond = (reach: number) => 1000 / slideInterval(reach)
		const middle = perSecond(0.75) - perSecond(0)
		const edge = perSecond(1) - perSecond(0.75)
		expect(edge).toBeGreaterThan(middle * 2)
	})

	// The floor is about being able to read the flipbook going past, so it is worth
	// stating in the units that matters in rather than only in milliseconds.
	it('never runs faster than six pages a second', () => {
		expect(1000 / slideInterval(1)).toBeLessThanOrEqual(6)
	})
})

describe('slideReach', () => {
	/*
	 * A phone: the handle starts in the middle of a 390pt window with 190 either side of
	 * it, and the pitch is nearly the whole window. So the throttle opens over the last
	 * 70pt of travel a finger actually has — which is not much, and is all there is.
	 */
	const PHONE = { room: 190, step: 366 }
	/** A laptop: 600 either side of the handle, and a 660 pitch. */
	const DESK = { room: 600, step: 660 }

	it('is shut where the run starts, on both layouts', () => {
		expect(slideReach(PHONE.step / 3, PHONE.room, PHONE.step)).toBe(0)
		expect(slideReach(-DESK.step / 3, DESK.room, DESK.step)).toBe(0)
	})

	it('is wide open at the edge of the window, on both layouts', () => {
		expect(slideReach(PHONE.room, PHONE.room, PHONE.step)).toBe(1)
		expect(slideReach(-DESK.room, DESK.room, DESK.step)).toBe(1)
	})

	it('opens the same either way the page is held', () => {
		expect(slideReach(300, DESK.room, DESK.step)).toBe(slideReach(-300, DESK.room, DESK.step))
	})

	it('goes back down when the page is brought back towards the middle', () => {
		expect(slideReach(500, DESK.room, DESK.step)).toBeGreaterThan(
			slideReach(350, DESK.room, DESK.step),
		)
	})

	/*
	 * The cap. On an ultrawide the window edge is nearly two thousand pixels from the
	 * handle, and a throttle that only opens fully out there is one nobody finds the top
	 * of. It does nothing at all on an ordinary window, which is the point of it.
	 */
	it('stops needing more travel once the window is wider than the gesture', () => {
		expect(slideReach(990, 1700, 660)).toBe(1)
		expect(slideReach(990, DESK.room, DESK.step)).toBe(1)
	})

	it('is shut when there is no room to open it in', () => {
		expect(slideReach(500, 10, 660)).toBe(0)
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

import { describe, expect, it } from 'vitest'

import { LEGACY_PAGE_SIZE, SQUARE_PAGE_SIZE } from './engine/constants'
import {
	centreViewport,
	clampViewport,
	defaultViewport,
	MAX_ZOOM,
	maxWidth,
	minWidth,
	paperPoint,
	panViewport,
	stagePlace,
	stagePoint,
	type Viewport,
	zoomViewport,
} from './zoomStage'

/**
 * The page these all run against unless they say otherwise.
 *
 * The legacy one, because that is the shape every number below was chosen against —
 * "wider than 16:9" means nothing about a square page. The square page gets its own
 * block at the foot of the file rather than being mixed in here.
 */
const PAGE = LEGACY_PAGE_SIZE

/** A phone's leftover band: the column's width, and what is left under the tools. */
const WIDE = 358 / 150
/** And a stage taller than the page's own shape, which is what binds the other way. */
const TALL = 300 / 240

const inside = (view: Viewport) =>
	view.x >= -0.001 &&
	view.y >= -0.001 &&
	view.x + view.w <= PAGE.width + 0.001 &&
	view.y + view.h <= PAGE.height + 0.001

describe('the window the stage shows', () => {
	it('is the stage’s own shape, whatever the page’s is', () => {
		for (const aspect of [WIDE, TALL, 16 / 9, 3, 1]) {
			const view = defaultViewport(PAGE, aspect)
			expect(view.w / view.h).toBeCloseTo(aspect, 6)
		}
	})

	it('starts in the middle of the page', () => {
		const view = defaultViewport(PAGE, WIDE)
		expect(view.x + view.w / 2).toBeCloseTo(PAGE.width / 2, 6)
		expect(view.y + view.h / 2).toBeCloseTo(PAGE.height / 2, 6)
	})

	it('never hangs off the page, at any size or position', () => {
		for (const aspect of [WIDE, TALL, 16 / 9]) {
			for (const w of [10, 160, 320, 640, 2000]) {
				for (const x of [-500, -1, 0, 320, 640, 1200]) {
					for (const y of [-500, 0, 180, 360, 900]) {
						expect(inside(clampViewport({ x, y, w, h: w / aspect }, PAGE, aspect))).toBe(true)
					}
				}
			}
		}
	})

	it('is the full width of the page when the stage is wider than 16:9', () => {
		expect(maxWidth(PAGE, WIDE)).toBe(PAGE.width)
		// And only part of its height, which is what the paper above is for.
		expect(PAGE.width / WIDE).toBeLessThan(PAGE.height)
	})

	it('is bound by the page’s height when the stage is taller than 16:9', () => {
		expect(maxWidth(PAGE, TALL)).toBeCloseTo(PAGE.height * TALL, 6)
		expect(maxWidth(PAGE, TALL)).toBeLessThan(PAGE.width)
	})

	it('goes in as far as MAX_ZOOM and no further', () => {
		const view = clampViewport({ x: 0, y: 0, w: 1, h: 1 / WIDE }, PAGE, WIDE)
		expect(view.w).toBeCloseTo(PAGE.width / MAX_ZOOM, 6)
		expect(minWidth(PAGE, WIDE)).toBeCloseTo(PAGE.width / MAX_ZOOM, 6)
	})

	/*
	 * A stage so short that the biggest window it can hold is already past MAX_ZOOM.
	 * The limits then cross over, and the size has to come out as *something* rather
	 * than as a low bound above a high one.
	 */
	it('survives a stage whose largest window is already past the zoom limit', () => {
		const sliver = 358 / 70
		expect(minWidth(PAGE, sliver)).toBeLessThanOrEqual(maxWidth(PAGE, sliver))
		expect(inside(clampViewport({ x: 0, y: 0, w: 9999, h: 9999 }, PAGE, sliver))).toBe(true)
	})
})

describe('pinching', () => {
	it('keeps whatever is under the fingers under the fingers', () => {
		const view = defaultViewport(PAGE, WIDE)
		const at = { x: view.x + view.w * 0.25, y: view.y + view.h * 0.75 }

		const zoomed = zoomViewport(view, PAGE, WIDE, 0.5, at)

		expect((at.x - zoomed.x) / zoomed.w).toBeCloseTo(0.25, 6)
		expect((at.y - zoomed.y) / zoomed.h).toBeCloseTo(0.75, 6)
	})

	it('holds the stage’s shape and stays on the page', () => {
		let view = defaultViewport(PAGE, WIDE)
		for (const scale of [0.5, 0.5, 0.5, 2, 2, 2, 2, 0.8, 1.4]) {
			view = zoomViewport(view, PAGE, WIDE, scale, { x: view.x, y: view.y })
			expect(view.w / view.h).toBeCloseTo(WIDE, 6)
			expect(inside(view)).toBe(true)
		}
	})

	/*
	 * The anchor is the pinch's midpoint and a pinch can wander off the stage, so this
	 * has to be answered for a point that isn't in the window at all. Clamping the
	 * result rather than the anchor is what makes it an answer instead of a throw.
	 */
	it('answers for an anchor outside the window', () => {
		const view = defaultViewport(PAGE, WIDE)
		const zoomed = zoomViewport(view, PAGE, WIDE, 0.5, { x: -400, y: 900 })
		expect(inside(zoomed)).toBe(true)
		expect(zoomed.w / zoomed.h).toBeCloseTo(WIDE, 6)
	})

	it('cannot be wound past the limits by repeating it', () => {
		let view = defaultViewport(PAGE, WIDE)
		for (let i = 0; i < 40; i++) view = zoomViewport(view, PAGE, WIDE, 0.5, { x: 320, y: 180 })
		expect(view.w).toBeCloseTo(minWidth(PAGE, WIDE), 6)

		for (let i = 0; i < 40; i++) view = zoomViewport(view, PAGE, WIDE, 2, { x: 320, y: 180 })
		expect(view.w).toBeCloseTo(maxWidth(PAGE, WIDE), 6)
	})
})

describe('panning', () => {
	it('moves by the delta while there is page left', () => {
		const view = defaultViewport(PAGE, WIDE)
		const moved = panViewport(view, 20, -10, PAGE, WIDE)
		expect(moved.x).toBeCloseTo(view.x + 20, 6)
		expect(moved.y).toBeCloseTo(view.y - 10, 6)
	})

	it('stops at the edge rather than following the finger off it', () => {
		const view = defaultViewport(PAGE, WIDE)
		const moved = panViewport(view, 9999, 9999, PAGE, WIDE)
		expect(moved.x).toBeCloseTo(PAGE.width - view.w, 6)
		expect(moved.y).toBeCloseTo(PAGE.height - view.h, 6)
	})

	it('centres on a point when the outline is dragged to it', () => {
		const view = defaultViewport(PAGE, WIDE)
		const moved = centreViewport(view, { x: 200, y: 120 }, PAGE, WIDE)
		expect(moved.x + moved.w / 2).toBeCloseTo(200, 6)
		expect(moved.y + moved.h / 2).toBeCloseTo(120, 6)
	})
})

describe('a point on the stage, in the artwork', () => {
	const box = { width: 358, height: 150 }

	it('reads the corners as the window’s corners', () => {
		const view = defaultViewport(PAGE, WIDE)
		expect(stagePoint(view, 0, 0, box)).toEqual({ x: view.x, y: view.y })

		const far = stagePoint(view, box.width, box.height, box)
		expect(far.x).toBeCloseTo(view.x + view.w, 6)
		expect(far.y).toBeCloseTo(view.y + view.h, 6)
	})

	it('follows the finger off the edge rather than clamping', () => {
		const view = defaultViewport(PAGE, WIDE)
		const off = stagePoint(view, -box.width, 0, box)
		expect(off.x).toBeCloseTo(view.x - view.w, 6)
	})

	it('reads the paper as the whole page', () => {
		const paper = { width: 358, height: 201 }
		expect(paperPoint(0, 0, paper, PAGE)).toEqual({ x: 0, y: 0 })

		const far = paperPoint(paper.width, paper.height, paper, PAGE)
		expect(far.x).toBeCloseTo(PAGE.width, 6)
		expect(far.y).toBeCloseTo(PAGE.height, 6)
	})

	it('says something rather than dividing by a stage with no width', () => {
		const view = defaultViewport(PAGE, WIDE)
		expect(stagePoint(view, 10, 10, { width: 0, height: 0 })).toEqual({ x: view.x, y: view.y })
		expect(paperPoint(10, 10, { width: 0, height: 0 }, PAGE)).toEqual({ x: 0, y: 0 })
	})
})

describe('a point in the artwork, on the stage', () => {
	const box = { width: 358, height: 150 }

	it('is the other half of the same mapping, at every zoom', () => {
		for (const zoom of [1, 1.5, 2, MAX_ZOOM]) {
			const view = defaultViewport(PAGE, WIDE, zoom)

			for (const at of [
				{ x: 0, y: 0 },
				{ x: 17, y: 350 },
				{ x: PAGE.width, y: PAGE.height },
				{ x: view.x + view.w / 3, y: view.y + view.h / 4 },
			]) {
				const back = stagePoint(view, at.x, at.y, box)
				const there = stagePlace(view, at, box)
				const round = stagePoint(view, there.x, there.y, box)

				expect(round.x).toBeCloseTo(at.x, 6)
				expect(round.y).toBeCloseTo(at.y, 6)
				// And not accidentally the identity: the two directions genuinely differ
				// wherever the window is not the whole page.
				if (view.w !== PAGE.width) expect(back.x).not.toBeCloseTo(there.x, 3)
			}
		}
	})

	it('puts the window’s corners at the stage’s corners', () => {
		const view = defaultViewport(PAGE, WIDE)
		expect(stagePlace(view, { x: view.x, y: view.y }, box)).toEqual({ x: 0, y: 0 })

		const far = stagePlace(view, { x: view.x + view.w, y: view.y + view.h }, box)
		expect(far.x).toBeCloseTo(box.width, 6)
		expect(far.y).toBeCloseTo(box.height, 6)
	})

	it('answers off the edge rather than clamping, as its inverse does', () => {
		const view = defaultViewport(PAGE, WIDE, MAX_ZOOM)
		const off = stagePlace(view, { x: view.x - view.w, y: view.y }, box)
		expect(off.x).toBeCloseTo(-box.width, 6)
	})

	it('says something rather than dividing by a window with no width', () => {
		const flat = { x: 10, y: 10, w: 0, h: 0 }
		expect(stagePlace(flat, { x: 20, y: 20 }, box)).toEqual({ x: 0, y: 0 })
	})
})

/*
 * The same arithmetic against the other page shape.
 *
 * Not a duplicate of everything above — what is worth checking is the handful of places
 * the page's own dimensions actually enter, which before this change were a pair of
 * constants and are now an argument. A square page is taller than the legacy one at the
 * same width, so every bound that used to be the height's is now somewhere else.
 */
describe('a square page', () => {
	const SQUARE = SQUARE_PAGE_SIZE

	it('lets a wide stage take the full width, as the legacy page does', () => {
		expect(maxWidth(SQUARE, WIDE)).toBe(SQUARE.width)
	})

	it('is bound by its own height, which is a different bound from the legacy page’s', () => {
		// `TALL` is 300/240 — taller than the legacy page and *wider* than a square one —
		// so the same stage is bound by two different things on the two pages: by the
		// legacy page's 360 of height, and by the square page's 640 of width. Which is
		// the whole reason this is an argument rather than a pair of constants.
		expect(maxWidth(SQUARE, TALL)).toBe(SQUARE.width)
		expect(maxWidth(LEGACY_PAGE_SIZE, TALL)).toBeCloseTo(LEGACY_PAGE_SIZE.height * TALL, 6)
		expect(maxWidth(SQUARE, TALL)).toBeGreaterThan(maxWidth(LEGACY_PAGE_SIZE, TALL))
	})

	it('shows more of a tall stage than the legacy page can', () => {
		// The point of the change, stated as the thing somebody would notice: a square
		// page has more height to give a stage that wants it.
		expect(maxWidth(SQUARE, 1) / 1).toBeGreaterThan(maxWidth(LEGACY_PAGE_SIZE, 1) / 1)
	})

	it('starts in the middle of itself', () => {
		const view = defaultViewport(SQUARE, WIDE)
		expect(view.x + view.w / 2).toBeCloseTo(SQUARE.width / 2, 6)
		expect(view.y + view.h / 2).toBeCloseTo(SQUARE.height / 2, 6)
	})

	it('never hangs off the page, at any size or position', () => {
		const on = (view: Viewport) =>
			view.x >= -0.001 &&
			view.y >= -0.001 &&
			view.x + view.w <= SQUARE.width + 0.001 &&
			view.y + view.h <= SQUARE.height + 0.001

		for (const aspect of [WIDE, TALL, 1]) {
			for (const w of [10, 320, 640, 2000]) {
				for (const x of [-500, 0, 320, 1200]) {
					for (const y of [-500, 0, 320, 900]) {
						expect(on(clampViewport({ x, y, w, h: w / aspect }, SQUARE, aspect))).toBe(true)
					}
				}
			}
		}
	})

	it('reads the paper as the whole page, in its own units', () => {
		const paper = { width: 200, height: 200 }
		expect(paperPoint(paper.width, paper.height, paper, SQUARE)).toEqual({
			x: SQUARE.width,
			y: SQUARE.height,
		})
	})
})

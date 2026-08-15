import { describe, expect, it } from 'vitest'

import { CANVAS_HEIGHT, CANVAS_WIDTH } from './engine/constants'
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

/** A phone's leftover band: the column's width, and what is left under the tools. */
const WIDE = 358 / 150
/** And a stage taller than the page's own shape, which is what binds the other way. */
const TALL = 300 / 240

const inside = (view: Viewport) =>
	view.x >= -0.001 &&
	view.y >= -0.001 &&
	view.x + view.w <= CANVAS_WIDTH + 0.001 &&
	view.y + view.h <= CANVAS_HEIGHT + 0.001

describe('the window the stage shows', () => {
	it('is the stage’s own shape, whatever the page’s is', () => {
		for (const aspect of [WIDE, TALL, 16 / 9, 3, 1]) {
			const view = defaultViewport(aspect)
			expect(view.w / view.h).toBeCloseTo(aspect, 6)
		}
	})

	it('starts in the middle of the page', () => {
		const view = defaultViewport(WIDE)
		expect(view.x + view.w / 2).toBeCloseTo(CANVAS_WIDTH / 2, 6)
		expect(view.y + view.h / 2).toBeCloseTo(CANVAS_HEIGHT / 2, 6)
	})

	it('never hangs off the page, at any size or position', () => {
		for (const aspect of [WIDE, TALL, 16 / 9]) {
			for (const w of [10, 160, 320, 640, 2000]) {
				for (const x of [-500, -1, 0, 320, 640, 1200]) {
					for (const y of [-500, 0, 180, 360, 900]) {
						expect(inside(clampViewport({ x, y, w, h: w / aspect }, aspect))).toBe(true)
					}
				}
			}
		}
	})

	it('is the full width of the page when the stage is wider than 16:9', () => {
		expect(maxWidth(WIDE)).toBe(CANVAS_WIDTH)
		// And only part of its height, which is what the paper above is for.
		expect(CANVAS_WIDTH / WIDE).toBeLessThan(CANVAS_HEIGHT)
	})

	it('is bound by the page’s height when the stage is taller than 16:9', () => {
		expect(maxWidth(TALL)).toBeCloseTo(CANVAS_HEIGHT * TALL, 6)
		expect(maxWidth(TALL)).toBeLessThan(CANVAS_WIDTH)
	})

	it('goes in as far as MAX_ZOOM and no further', () => {
		const view = clampViewport({ x: 0, y: 0, w: 1, h: 1 / WIDE }, WIDE)
		expect(view.w).toBeCloseTo(CANVAS_WIDTH / MAX_ZOOM, 6)
		expect(minWidth(WIDE)).toBeCloseTo(CANVAS_WIDTH / MAX_ZOOM, 6)
	})

	/*
	 * A stage so short that the biggest window it can hold is already past MAX_ZOOM.
	 * The limits then cross over, and the size has to come out as *something* rather
	 * than as a low bound above a high one.
	 */
	it('survives a stage whose largest window is already past the zoom limit', () => {
		const sliver = 358 / 70
		expect(minWidth(sliver)).toBeLessThanOrEqual(maxWidth(sliver))
		expect(inside(clampViewport({ x: 0, y: 0, w: 9999, h: 9999 }, sliver))).toBe(true)
	})
})

describe('pinching', () => {
	it('keeps whatever is under the fingers under the fingers', () => {
		const view = defaultViewport(WIDE)
		const at = { x: view.x + view.w * 0.25, y: view.y + view.h * 0.75 }

		const zoomed = zoomViewport(view, WIDE, 0.5, at)

		expect((at.x - zoomed.x) / zoomed.w).toBeCloseTo(0.25, 6)
		expect((at.y - zoomed.y) / zoomed.h).toBeCloseTo(0.75, 6)
	})

	it('holds the stage’s shape and stays on the page', () => {
		let view = defaultViewport(WIDE)
		for (const scale of [0.5, 0.5, 0.5, 2, 2, 2, 2, 0.8, 1.4]) {
			view = zoomViewport(view, WIDE, scale, { x: view.x, y: view.y })
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
		const view = defaultViewport(WIDE)
		const zoomed = zoomViewport(view, WIDE, 0.5, { x: -400, y: 900 })
		expect(inside(zoomed)).toBe(true)
		expect(zoomed.w / zoomed.h).toBeCloseTo(WIDE, 6)
	})

	it('cannot be wound past the limits by repeating it', () => {
		let view = defaultViewport(WIDE)
		for (let i = 0; i < 40; i++) view = zoomViewport(view, WIDE, 0.5, { x: 320, y: 180 })
		expect(view.w).toBeCloseTo(minWidth(WIDE), 6)

		for (let i = 0; i < 40; i++) view = zoomViewport(view, WIDE, 2, { x: 320, y: 180 })
		expect(view.w).toBeCloseTo(maxWidth(WIDE), 6)
	})
})

describe('panning', () => {
	it('moves by the delta while there is page left', () => {
		const view = defaultViewport(WIDE)
		const moved = panViewport(view, 20, -10, WIDE)
		expect(moved.x).toBeCloseTo(view.x + 20, 6)
		expect(moved.y).toBeCloseTo(view.y - 10, 6)
	})

	it('stops at the edge rather than following the finger off it', () => {
		const view = defaultViewport(WIDE)
		const moved = panViewport(view, 9999, 9999, WIDE)
		expect(moved.x).toBeCloseTo(CANVAS_WIDTH - view.w, 6)
		expect(moved.y).toBeCloseTo(CANVAS_HEIGHT - view.h, 6)
	})

	it('centres on a point when the outline is dragged to it', () => {
		const view = defaultViewport(WIDE)
		const moved = centreViewport(view, { x: 200, y: 120 }, WIDE)
		expect(moved.x + moved.w / 2).toBeCloseTo(200, 6)
		expect(moved.y + moved.h / 2).toBeCloseTo(120, 6)
	})
})

describe('a point on the stage, in the artwork', () => {
	const box = { width: 358, height: 150 }

	it('reads the corners as the window’s corners', () => {
		const view = defaultViewport(WIDE)
		expect(stagePoint(view, 0, 0, box)).toEqual({ x: view.x, y: view.y })

		const far = stagePoint(view, box.width, box.height, box)
		expect(far.x).toBeCloseTo(view.x + view.w, 6)
		expect(far.y).toBeCloseTo(view.y + view.h, 6)
	})

	it('follows the finger off the edge rather than clamping', () => {
		const view = defaultViewport(WIDE)
		const off = stagePoint(view, -box.width, 0, box)
		expect(off.x).toBeCloseTo(view.x - view.w, 6)
	})

	it('reads the paper as the whole page', () => {
		const paper = { width: 358, height: 201 }
		expect(paperPoint(0, 0, paper)).toEqual({ x: 0, y: 0 })

		const far = paperPoint(paper.width, paper.height, paper)
		expect(far.x).toBeCloseTo(CANVAS_WIDTH, 6)
		expect(far.y).toBeCloseTo(CANVAS_HEIGHT, 6)
	})

	it('says something rather than dividing by a stage with no width', () => {
		const view = defaultViewport(WIDE)
		expect(stagePoint(view, 10, 10, { width: 0, height: 0 })).toEqual({ x: view.x, y: view.y })
		expect(paperPoint(10, 10, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
	})
})

describe('a point in the artwork, on the stage', () => {
	const box = { width: 358, height: 150 }

	it('is the other half of the same mapping, at every zoom', () => {
		for (const zoom of [1, 1.5, 2, MAX_ZOOM]) {
			const view = defaultViewport(WIDE, zoom)

			for (const at of [
				{ x: 0, y: 0 },
				{ x: 17, y: 350 },
				{ x: CANVAS_WIDTH, y: CANVAS_HEIGHT },
				{ x: view.x + view.w / 3, y: view.y + view.h / 4 },
			]) {
				const back = stagePoint(view, at.x, at.y, box)
				const there = stagePlace(view, at, box)
				const round = stagePoint(view, there.x, there.y, box)

				expect(round.x).toBeCloseTo(at.x, 6)
				expect(round.y).toBeCloseTo(at.y, 6)
				// And not accidentally the identity: the two directions genuinely differ
				// wherever the window is not the whole page.
				if (view.w !== CANVAS_WIDTH) expect(back.x).not.toBeCloseTo(there.x, 3)
			}
		}
	})

	it('puts the window’s corners at the stage’s corners', () => {
		const view = defaultViewport(WIDE)
		expect(stagePlace(view, { x: view.x, y: view.y }, box)).toEqual({ x: 0, y: 0 })

		const far = stagePlace(view, { x: view.x + view.w, y: view.y + view.h }, box)
		expect(far.x).toBeCloseTo(box.width, 6)
		expect(far.y).toBeCloseTo(box.height, 6)
	})

	it('answers off the edge rather than clamping, as its inverse does', () => {
		const view = defaultViewport(WIDE, MAX_ZOOM)
		const off = stagePlace(view, { x: view.x - view.w, y: view.y }, box)
		expect(off.x).toBeCloseTo(-box.width, 6)
	})

	it('says something rather than dividing by a window with no width', () => {
		const flat = { x: 10, y: 10, w: 0, h: 0 }
		expect(stagePlace(flat, { x: 20, y: 20 }, box)).toEqual({ x: 0, y: 0 })
	})
})

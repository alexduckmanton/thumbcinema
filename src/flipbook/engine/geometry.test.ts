import { describe, expect, it } from 'vitest'

import {
	advanceCircleplay,
	circleplayInitial,
	circleplayPage,
	cornerIndex,
	distance,
	edgeIndex,
	oppositeIndex,
	resamplePolyline,
	sweepAngle,
	type Vec2,
} from './geometry'

const line = (length: number, step = 1): Vec2[] =>
	Array.from({ length }, (_, i) => ({ x: i * step, y: 0 }))

describe('resamplePolyline', () => {
	it('leaves a stroke too short to resample alone', () => {
		expect(resamplePolyline([], 5)).toEqual([])
		expect(resamplePolyline([{ x: 3, y: 4 }], 5)).toEqual([{ x: 3, y: 4 }])
	})

	it('spaces points evenly along the path', () => {
		// 100px of dense input at 1px spacing, resampled to 5px.
		const out = resamplePolyline(line(101), 5)

		expect(out).toHaveLength(21)
		expect(out[0]).toEqual({ x: 0, y: 0 })
		expect(out.at(-1)).toEqual({ x: 100, y: 0 })

		for (let i = 1; i < out.length; i++) {
			expect(distance(out[i - 1]!, out[i]!)).toBeCloseTo(5, 6)
		}
	})

	it('always lands the last sample on the final point', () => {
		// 7px of path at 5px spacing: two whole steps don't fit, so the spacing
		// shrinks rather than the stroke ending short. This is the behaviour
		// paper.js 0.8's flatten() had, and the reason it is reimplemented.
		const out = resamplePolyline(
			[
				{ x: 0, y: 0 },
				{ x: 7, y: 0 },
			],
			5,
		)

		expect(out.at(-1)).toEqual({ x: 7, y: 0 })
		expect(out).toHaveLength(3)
	})

	it('interpolates across corners rather than snapping to them', () => {
		const out = resamplePolyline(
			[
				{ x: 0, y: 0 },
				{ x: 4, y: 0 },
				{ x: 4, y: 4 },
			],
			4,
		)

		expect(out).toEqual([
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 4 },
		])
	})

	it('survives a stroke that never moved', () => {
		const out = resamplePolyline(
			[
				{ x: 5, y: 5 },
				{ x: 5, y: 5 },
				{ x: 5, y: 5 },
			],
			5,
		)

		expect(out).toEqual([
			{ x: 5, y: 5 },
			{ x: 5, y: 5 },
		])
		expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
	})

	it('reduces a dense stroke, which is what keeps saved files small', () => {
		const dense = line(600, 0.5) // 300px drawn at half-pixel resolution
		expect(resamplePolyline(dense, 5).length).toBeLessThan(dense.length / 5)
	})
})

describe('sweepAngle', () => {
	const centre = { x: 0, y: 0 }

	it('is zero when the pointer has not moved', () => {
		expect(sweepAngle({ x: 10, y: 0 }, { x: 10, y: 0 }, centre)).toBe(0)
	})

	it('measures a quarter turn', () => {
		expect(Math.abs(sweepAngle({ x: 10, y: 0 }, { x: 0, y: 10 }, centre))).toBeCloseTo(90, 6)
	})

	it('signs the two directions oppositely', () => {
		const clockwise = sweepAngle({ x: 10, y: 0 }, { x: 0, y: 10 }, centre)
		const anticlockwise = sweepAngle({ x: 0, y: 10 }, { x: 10, y: 0 }, centre)

		expect(Math.sign(clockwise)).toBe(-Math.sign(anticlockwise))
	})

	it('does not produce NaN when the pointer sits on the centre', () => {
		expect(sweepAngle({ x: 0, y: 0 }, { x: 5, y: 5 }, centre)).toBe(0)
	})

	it('stays finite for a hair-thin triangle, where acos would drift out of domain', () => {
		const angle = sweepAngle({ x: 100, y: 0 }, { x: 100, y: 1e-12 }, centre)
		expect(Number.isNaN(angle)).toBe(false)
	})
})

describe('circleplay', () => {
	const pages = 10

	it('needs three points before it moves at all', () => {
		let state = circleplayInitial(0)
		state = advanceCircleplay(state, { x: 0, y: 0 }, pages)
		state = advanceCircleplay(state, { x: 10, y: 0 }, pages)

		expect(state.timeline).toBe(0)
	})

	it('ignores a repeated position — Safari fires mousemove twice', () => {
		let state = circleplayInitial(0)
		state = advanceCircleplay(state, { x: 0, y: 0 }, pages)
		const before = advanceCircleplay(state, { x: 10, y: 0 }, pages)
		const after = advanceCircleplay(before, { x: 10, y: 0 }, pages)

		expect(after).toBe(before)
	})

	it('advances one way for a clockwise arc and the other way for its mirror', () => {
		const clockwise = [
			{ x: 0, y: -100 },
			{ x: 100, y: 0 },
			{ x: 0, y: 100 },
		]

		let forward = circleplayInitial(5)
		for (const point of clockwise) forward = advanceCircleplay(forward, point, pages)

		let backward = circleplayInitial(5)
		for (const point of [...clockwise].reverse()) {
			backward = advanceCircleplay(backward, point, pages)
		}

		expect(Math.sign(forward.timeline - 5)).toBe(-Math.sign(backward.timeline - 5))
	})

	it('wraps at both ends rather than running off', () => {
		let state = circleplayInitial(pages + 1)
		state = advanceCircleplay(state, { x: 0, y: -100 }, pages)
		state = advanceCircleplay(state, { x: 100, y: 0 }, pages)
		state = advanceCircleplay(state, { x: 0, y: 100 }, pages)

		expect(state.timeline).toBeGreaterThanOrEqual(0)
		expect(state.timeline).toBeLessThanOrEqual(pages)
	})

	it('has a dead zone either side of a page boundary', () => {
		// Without it the playhead flickers between two pages on the join.
		expect(circleplayPage(3.5)).toBe(3)
		expect(circleplayPage(3.01)).toBeNull()
		expect(circleplayPage(3.99)).toBeNull()
	})
})

describe('handle indices', () => {
	it('maps paper.js handle names to rectangle segment indices', () => {
		expect(cornerIndex('bottom-left')).toBe(0)
		expect(cornerIndex('top-left')).toBe(1)
		expect(cornerIndex('top-right')).toBe(2)
		expect(cornerIndex('bottom-right')).toBe(3)

		expect(edgeIndex('left-center')).toBe(0)
		expect(edgeIndex('bottom-center')).toBe(3)
	})

	it('returns null for anything that is not a handle', () => {
		expect(cornerIndex(undefined)).toBeNull()
		expect(cornerIndex('centre-of-nowhere')).toBeNull()
		expect(edgeIndex('top-left')).toBeNull()
	})

	it('pairs each handle with the one across the box', () => {
		expect(oppositeIndex(0)).toBe(2)
		expect(oppositeIndex(3)).toBe(1)
	})
})

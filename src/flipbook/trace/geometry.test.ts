import { describe, expect, it } from 'vitest'

import {
	CENTRED,
	MAX_SCALE,
	MIN_SCALE,
	type Placement,
	type Point,
	dragged,
	pinched,
} from './geometry'

const BOX = { width: 640, height: 360 }

/** Where the transform actually draws a point of the photo, given a placement. */
function drawn(at: Placement, point: Point): Point {
	const cx = BOX.width / 2
	const cy = BOX.height / 2
	const radians = (at.rotation * Math.PI) / 180
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)

	const px = (point.x - cx) * at.scale
	const py = (point.y - cy) * at.scale

	return {
		x: cx + at.x * BOX.width + px * cos - py * sin,
		y: cy + at.y * BOX.height + px * sin + py * cos,
	}
}

/** The photo-local point currently drawn at `screen`. The inverse of `drawn`. */
function under(at: Placement, screen: Point): Point {
	const cx = BOX.width / 2
	const cy = BOX.height / 2
	const radians = (-at.rotation * Math.PI) / 180
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)

	const vx = screen.x - cx - at.x * BOX.width
	const vy = screen.y - cy - at.y * BOX.height

	return {
		x: cx + (vx * cos - vy * sin) / at.scale,
		y: cy + (vx * sin + vy * cos) / at.scale,
	}
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

describe('dragged', () => {
	it('moves by the distance travelled, as a fraction of the frame', () => {
		expect(dragged(CENTRED, 64, 36, BOX)).toEqual({ x: 0.1, y: 0.1, scale: 1, rotation: 0 })
	})

	it('is measured from the start of the gesture, not from the last event', () => {
		const start = { x: 0.25, y: -0.5, scale: 2, rotation: 30 }
		expect(dragged(start, 0, 0, BOX)).toEqual(start)
	})

	it('leaves the scale and the rotation alone', () => {
		const moved = dragged({ x: 0, y: 0, scale: 3, rotation: 45 }, -32, 18, BOX)
		expect(moved.scale).toBe(3)
		expect(moved.rotation).toBe(45)
	})
})

describe('pinched', () => {
	it('scales by how far the fingers spread', () => {
		const from: [Point, Point] = [
			{ x: 220, y: 180 },
			{ x: 420, y: 180 },
		]
		const to: [Point, Point] = [
			{ x: 120, y: 180 },
			{ x: 520, y: 180 },
		]

		expect(pinched(CENTRED, from, to, BOX).scale).toBeCloseTo(2)
	})

	it('turns by how far the fingers turn about each other', () => {
		const from: [Point, Point] = [
			{ x: 220, y: 180 },
			{ x: 420, y: 180 },
		]
		// The same pair, stood on end: a quarter turn clockwise.
		const to: [Point, Point] = [
			{ x: 320, y: 80 },
			{ x: 320, y: 280 },
		]

		const at = pinched(CENTRED, from, to, BOX)
		expect(at.rotation).toBeCloseTo(90)
		expect(at.scale).toBeCloseTo(1)
	})

	it('carries the photo along when both fingers move together', () => {
		const from: [Point, Point] = [
			{ x: 200, y: 100 },
			{ x: 300, y: 100 },
		]
		const to: [Point, Point] = [
			{ x: 264, y: 136 },
			{ x: 364, y: 136 },
		]

		const at = pinched(CENTRED, from, to, BOX)
		expect(at.x).toBeCloseTo(0.1)
		expect(at.y).toBeCloseTo(0.1)
		expect(at.scale).toBeCloseTo(1)
		expect(at.rotation).toBeCloseTo(0)
	})

	/**
	 * The one property the whole thing exists to have: whatever was under the middle of
	 * the two fingers when they landed is under the middle of the two fingers now.
	 *
	 * Checked from an already-transformed starting placement, and against a gesture that
	 * moves, spreads and turns at once — the three separately are the easy cases.
	 */
	it('keeps the pinned point under the fingers', () => {
		const start: Placement = { x: -0.2, y: 0.15, scale: 1.7, rotation: -25 }

		const from: [Point, Point] = [
			{ x: 180, y: 120 },
			{ x: 400, y: 260 },
		]
		const to: [Point, Point] = [
			{ x: 260, y: 90 },
			{ x: 560, y: 300 },
		]

		const pinned = under(start, mid(from[0], from[1]))
		const after = pinched(start, from, to, BOX)
		const landed = drawn(after, pinned)
		const wanted = mid(to[0], to[1])

		expect(landed.x).toBeCloseTo(wanted.x, 6)
		expect(landed.y).toBeCloseTo(wanted.y, 6)
	})

	it('holds the pin at the ceiling as well, where the ratio is clamped', () => {
		const start: Placement = { x: 0.1, y: -0.1, scale: 8, rotation: 10 }

		const from: [Point, Point] = [
			{ x: 300, y: 170 },
			{ x: 340, y: 190 },
		]
		// Far enough apart to ask for 20×, which is twice what it may have.
		const to: [Point, Point] = [
			{ x: 100, y: 60 },
			{ x: 500, y: 260 },
		]

		const pinned = under(start, mid(from[0], from[1]))
		const after = pinched(start, from, to, BOX)

		expect(after.scale).toBe(MAX_SCALE)

		const landed = drawn(after, pinned)
		const wanted = mid(to[0], to[1])
		expect(landed.x).toBeCloseTo(wanted.x, 6)
		expect(landed.y).toBeCloseTo(wanted.y, 6)
	})

	it('clamps at the floor too, and does not ratchet on the way back', () => {
		const start: Placement = { x: 0, y: 0, scale: 1, rotation: 0 }

		const from: [Point, Point] = [
			{ x: 20, y: 180 },
			{ x: 620, y: 180 },
		]
		const squashed: [Point, Point] = [
			{ x: 318, y: 180 },
			{ x: 322, y: 180 },
		]

		expect(pinched(start, from, squashed, BOX).scale).toBe(MIN_SCALE)
		// The same gesture opened again: every event is measured from the press, so the
		// clamp is a wall rather than a notch.
		expect(pinched(start, from, from, BOX).scale).toBeCloseTo(1)
	})

	it('survives two fingers landing in the same place', () => {
		const together: [Point, Point] = [
			{ x: 320, y: 180 },
			{ x: 320, y: 180 },
		]
		const apart: [Point, Point] = [
			{ x: 220, y: 180 },
			{ x: 420, y: 180 },
		]

		const at = pinched(CENTRED, together, apart, BOX)
		expect(at.scale).toBe(1)
		expect(Number.isFinite(at.x)).toBe(true)
		expect(Number.isFinite(at.y)).toBe(true)
	})
})

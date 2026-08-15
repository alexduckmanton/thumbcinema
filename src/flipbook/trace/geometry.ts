/**
 * What a drag and a pinch do to a trace photo's placement.
 *
 * Pure arithmetic over a placement and a pair of contacts — no DOM, no React, no
 * paper.js — for the same reason `engine/reorder.ts` is: the fiddly half of a gesture
 * is the maths, and maths can be tested without a phone in your hand.
 *
 * The placement itself lives in `engine/trace.ts`, because the engine is what holds one
 * per page and puts it on the undo stack.
 */

import { MAX_SCALE, MIN_SCALE, type Placement } from '../engine/trace'

export interface Point {
	x: number
	y: number
}

export interface Box {
	width: number
	height: number
}

/**
 * One finger, moved by (dx, dy) pixels since the press.
 *
 * Measured from where the placement was when the gesture opened rather than from the
 * last event, so a drag is the sum of one subtraction instead of a hundred — which is
 * what keeps a slow drag from accumulating a pixel of drift per frame.
 */
export function dragged(start: Placement, dx: number, dy: number, box: Box): Placement {
	return {
		...start,
		x: start.x + dx / box.width,
		y: start.y + dy / box.height,
	}
}

/**
 * Two fingers, from where they landed to where they are now.
 *
 * The photo is pinned to the pair: whatever was under the midpoint of the two contacts
 * when they landed is under the midpoint of the two contacts now, turned by however much
 * they have turned about each other and scaled by however much they have spread. That is
 * the whole of what a pinch means, and stating it that way is what makes it feel like a
 * photograph on a table rather than three sliders being driven at once.
 *
 * The arithmetic: the rendered transform is `translate(t) rotate(θ) scale(s)` about the
 * frame's centre `c`, so a point `p` in the photo's own coordinates is drawn at
 * `c + t + R(θ)·s·(p − c)`. Read `p` back from where the midpoint started, then solve for
 * the `t` that puts it under where the midpoint is now. Everything is measured from the
 * *start* of the gesture, so clamping the scale can't ratchet: the finger can open a
 * pinch past the ceiling, close it again, and the photo comes back down with it.
 *
 * `k` is the ratio that actually survived the clamp, and using it rather than the raw one
 * is what keeps the pinned point pinned once the scale has stopped moving.
 */
export function pinched(
	start: Placement,
	from: readonly [Point, Point],
	to: readonly [Point, Point],
	box: Box,
): Placement {
	const spread = distance(from[0], from[1])
	// Two fingers landing in exactly the same place is not a pinch anybody meant; it is
	// also a division by zero. Leave the scale where it is and let the drag half work.
	const ratio = spread > 0 ? distance(to[0], to[1]) / spread : 1

	const scale = clamp(start.scale * ratio, MIN_SCALE, MAX_SCALE)
	const k = scale / start.scale

	const turn = bearing(to[0], to[1]) - bearing(from[0], from[1])

	const centreX = box.width / 2
	const centreY = box.height / 2
	const tx = start.x * box.width
	const ty = start.y * box.height

	const was = midpoint(from[0], from[1])
	const now = midpoint(to[0], to[1])

	// Where the pinned point sits relative to the frame's centre, as the transform
	// currently draws it — and where the same point has to sit for the new one.
	const vx = was.x - centreX - tx
	const vy = was.y - centreY - ty

	const cos = Math.cos(turn)
	const sin = Math.sin(turn)

	return {
		x: (now.x - centreX - k * (vx * cos - vy * sin)) / box.width,
		y: (now.y - centreY - k * (vx * sin + vy * cos)) / box.height,
		scale,
		rotation: start.rotation + (turn * 180) / Math.PI,
	}
}

function distance(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y)
}

function bearing(a: Point, b: Point): number {
	return Math.atan2(b.y - a.y, b.x - a.x)
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high)
}

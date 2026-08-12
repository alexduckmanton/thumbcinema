/**
 * Where a trace photo is standing, and what a finger does to it.
 *
 * Pure arithmetic over a placement and a pair of contacts — no DOM, no React, no
 * paper.js — for the same reason `engine/reorder.ts` is: the fiddly half of a gesture
 * is the maths, and maths can be tested without a phone in your hand.
 */

/**
 * The photo's transform, in terms the stylesheet can use directly.
 *
 * `x` and `y` are **fractions of the frame**, not pixels: the drawing is shown at
 * whatever the window can spare and a placement stated in pixels would slide across the
 * picture the moment the phone was turned over. The frame is 16:9 at every width, so
 * dividing x by the width and y by the height scales the pair by the same factor and
 * the photo stays where it was put.
 *
 * They become `translate(x%, y%)` on a box that is exactly the frame — which is why
 * that box exists and the picture is centred inside it rather than being the box. See
 * `TraceLayer`.
 */
export interface Placement {
	x: number
	y: number
	scale: number
	/** Degrees clockwise. */
	rotation: number
}

export interface Point {
	x: number
	y: number
}

export interface Box {
	width: number
	height: number
}

/** Centred, unrotated, and as large as the frame will take it. Where a photo lands. */
export const CENTRED: Placement = { x: 0, y: 0, scale: 1, rotation: 0 }

/**
 * How far a photo may be pinched, and it is deliberately generous at both ends.
 *
 * The floor is not "still visible" — a photo shrunk to a tenth is a thumbnail in the
 * corner of the frame, which is a fair thing to want to trace. The ceiling is what makes
 * tracing one eye out of a portrait possible. What both are actually for is the pinch
 * that gets away: a ratio is unbounded, and a photo scaled by 400 is one that cannot be
 * found again.
 */
export const MIN_SCALE = 0.1
export const MAX_SCALE = 10

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

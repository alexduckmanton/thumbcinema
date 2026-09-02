/**
 * The drawing tool's geometry, with no paper.js and no DOM in it.
 *
 * Everything here is a pure function of numbers, which is the point: these are the
 * parts of the tool that are easy to get subtly wrong and impossible to eyeball, so
 * they're the parts that get unit tests.
 */

export interface Vec2 {
	x: number
	y: number
}

export function distance(a: Vec2, b: Vec2): number {
	return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * The most points a resampled stroke may hold.
 *
 * A stroke that crosses a 640-unit page a hundred times is 12,800 samples at the
 * pencil's spacing; a million is not a stroke, it is a coordinate that went wrong
 * somewhere upstream, and the loop in `resamplePolyline` must not be the place that
 * finds out.
 */
const MAX_SAMPLES = 1_000_000

/**
 * Resamples a polyline to evenly spaced points.
 *
 * This is what `path.flatten(5)` did in paper.js 0.8, and it is *not* what
 * `flatten()` does in 0.12. The argument changed meaning: 0.8 took a maximum
 * distance and laid points down at that spacing along the path; 0.12 takes a
 * maximum *error* and subdivides curves until they're within it — which on a
 * hand-drawn polyline, whose segments are already straight, is a no-op.
 *
 * Two things depended on the old behaviour, so it's reimplemented rather than
 * dropped:
 *
 *  - Saved files. A stroke arrives as one point per mouse event, which at a modern
 *    polling rate is several hundred points across a canvas 640px wide. Resampling
 *    to 5px is most of why paper.js SVG compresses to ~25%.
 *  - The push tool, which walks `segments` two at a time and weights them by
 *    distance. It assumes roughly even spacing; without it, dense parts of a stroke
 *    get pushed harder than sparse ones.
 *
 * Follows 0.8's arithmetic exactly: the spacing is the path length divided by the
 * number of whole steps that fit, so the last sample lands on the final point
 * rather than short of it.
 */
export function resamplePolyline(input: readonly Vec2[], spacing: number): Vec2[] {
	// A point that isn't a number is not on the stroke. It cannot be placed, and one
	// non-finite coordinate makes the length below NaN or infinite — and an infinite
	// length is a loop that never ends, on the main thread, with nothing logged.
	const points = input.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))

	if (points.length < 2 || spacing <= 0) return points.map((p) => ({ x: p.x, y: p.y }))

	// Cumulative arc length at each input point.
	const lengths: number[] = [0]
	let total = 0
	for (let i = 1; i < points.length; i++) {
		total += distance(points[i - 1]!, points[i]!)
		lengths.push(total)
	}

	// A stroke that never moved (every point identical) has nowhere to sample along.
	if (total === 0) return [{ ...points[0]! }, { ...points[points.length - 1]! }]

	// Every input is finite, so this can only be reached by a stroke longer than the
	// number of steps it would take can hold — which is not a stroke anybody drew.
	if (!Number.isFinite(total) || total / spacing > MAX_SAMPLES) {
		return [{ ...points[0]! }, { ...points[points.length - 1]! }]
	}

	const steps = Math.max(1, Math.ceil(total / spacing))
	const step = total / steps

	const out: Vec2[] = []
	let segment = 1

	for (let i = 0; i <= steps; i++) {
		const target = Math.min(i * step, total)

		while (segment < lengths.length - 1 && lengths[segment]! < target) segment++

		const startLength = lengths[segment - 1]!
		const endLength = lengths[segment]!
		const span = endLength - startLength

		const t = span === 0 ? 0 : (target - startLength) / span
		const a = points[segment - 1]!
		const b = points[segment]!

		out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
	}

	return out
}

/**
 * The signed angle, in degrees, that `centre` sees the pointer sweep through as it
 * moves from `from` to `to`. Used by the rotate handle.
 *
 * Law of cosines for the magnitude, then the sign of the cross product for which
 * way round. Returns 0 rather than NaN for degenerate triangles — a pointer that
 * hasn't moved, or is sitting exactly on the centre.
 */
export function sweepAngle(from: Vec2, to: Vec2, centre: Vec2): number {
	const a = distance(from, to)
	const b = distance(from, centre)
	const c = distance(to, centre)

	if (a === 0 || b === 0 || c === 0) return 0

	// Clamped because floating point drifts outside acos's domain at tiny angles.
	const cosine = Math.min(1, Math.max(-1, (b * b + c * c - a * a) / (2 * b * c)))
	const degrees = (Math.acos(cosine) / (2 * Math.PI)) * 360

	const cross = (from.x - centre.x) * (to.y - centre.y) - (from.y - centre.y) * (to.x - centre.x)

	return cross < 0 ? -degrees : degrees
}

/**
 * Which corner of a selection box is being dragged, and which one stays put.
 *
 * paper.js names the hit handles; the numbers are the segment indices of a
 * `Path.Rectangle`, which is what the scale maths indexes into. The opposite corner
 * is two around the loop.
 */
const CORNERS: Record<string, number> = {
	'bottom-left': 0,
	'top-left': 1,
	'top-right': 2,
	'bottom-right': 3,
}

const EDGES: Record<string, number> = {
	'left-center': 0,
	'top-center': 1,
	'right-center': 2,
	'bottom-center': 3,
}

export function cornerIndex(handleName: string | undefined): number | null {
	if (!handleName) return null
	const index = CORNERS[handleName]
	return index === undefined ? null : index
}

export function edgeIndex(handleName: string | undefined): number | null {
	if (!handleName) return null
	const index = EDGES[handleName]
	return index === undefined ? null : index
}

export function oppositeIndex(index: number): number {
	return (index + 2) % 4
}

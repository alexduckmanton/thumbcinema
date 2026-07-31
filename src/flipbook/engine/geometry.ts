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
export function resamplePolyline(points: readonly Vec2[], spacing: number): Vec2[] {
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
 * Circleplay: scrub the flipbook by drawing circles with the pointer.
 *
 * Three consecutive pointer positions make a triangle; its winding gives the
 * direction and the two side lengths give the speed, and the two together advance a
 * fractional playhead. Ported from the 2013 implementation with its constants
 * intact — it's a feel thing, and the feel is the feature.
 */
export interface CircleplayState {
	/** The last three pointer positions, oldest first. */
	readonly trail: readonly Vec2[]
	/** Fractional page position. Wraps at both ends. */
	readonly timeline: number
}

export const CIRCLEPLAY_FRICTION = 400

export function circleplayInitial(timeline: number): CircleplayState {
	return { trail: [], timeline }
}

export function advanceCircleplay(
	state: CircleplayState,
	point: Vec2,
	pageCount: number,
): CircleplayState {
	const last = state.trail[state.trail.length - 1]

	// Safari sometimes fires mousemove twice for one movement.
	if (last && last.x === point.x && last.y === point.y) return state

	const trail = [...state.trail, point].slice(-3)
	if (trail.length < 3) return { trail, timeline: state.timeline }

	const [p1, p2, p3] = trail as [Vec2, Vec2, Vec2]

	const side1 = distance(p1, p2)
	const side2 = distance(p2, p3)

	// Cross product of the two legs: which way the pointer is curling.
	const cross = (p1.x - p2.x) * (p3.y - p2.y) - (p1.y - p2.y) * (p3.x - p2.x)
	const direction = cross > 0 ? -1 : cross < 0 ? 1 : 0

	const speed = side1 > 0 && side2 > 0 ? Math.floor(side1 + side2) : 0
	const velocity = (speed * direction) / CIRCLEPLAY_FRICTION

	let timeline = state.timeline + velocity
	if (timeline > pageCount) timeline = 0
	if (timeline < 0) timeline = pageCount

	return { trail, timeline }
}

/**
 * The dead zone either side of a page boundary. Without it the playhead flickers
 * between two pages while the pointer hovers on the join.
 */
export const CIRCLEPLAY_MARGIN = 0.05

export function circleplayPage(timeline: number): number | null {
	const fraction = timeline % 1
	if (fraction < CIRCLEPLAY_MARGIN || fraction > 1 - CIRCLEPLAY_MARGIN) return null
	return Math.floor(timeline)
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

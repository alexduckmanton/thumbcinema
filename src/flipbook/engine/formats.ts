/**
 * Reading and writing the two artwork formats.
 *
 * Both are still live and both are still in the database, so this is a compatibility
 * layer as much as a serialiser — see `docs/data-formats.md`. Everything here is a
 * pure function of a string, which is what makes the awkward parts testable.
 */

import { LEGACY_PAGE_SIZE, type PageSize } from './constants'
import type { Vec2 } from './geometry'

/**
 * paper.js exports one `<g>` per layer, in layer order, and the first three layers
 * are always the selection, guide and undo scaffolding. Real pages start at index 3.
 *
 * That's a wire format, not an implementation detail: every one of the 585 archive
 * flipbooks was written by a paper project laid out this way, and the loader has to
 * skip the same three. Changing `SYSTEM_LAYERS` without changing this — or the other
 * way round — silently shifts every page in the archive by one.
 */
export const LEADING_SYSTEM_GROUPS = 3

/** Default when neither the stroke nor its group says how thick it is. 2013's number. */
export const DEFAULT_STROKE_WIDTH = 2

export interface ParsedPage {
	/** The `<g>` the strokes came from; carries the fallback stroke-width. */
	group: Element
	/** One element per stroke, still un-imported. */
	strokes: Element[]
	/** `stroke-width` from the group, when it has one. */
	groupStrokeWidth: number | null
}

export class ArtworkError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ArtworkError'
	}
}

/**
 * Splits a saved SVG into pages.
 *
 * Uses `DOMParser` with `image/svg+xml` rather than dropping the markup into a div,
 * which is what the 2013 loader did. An HTML parser is forgiving about SVG in ways
 * that quietly mangle it; the XML parser either produces a tree or says why not.
 */
export function parseSvgPages(text: string): ParsedPage[] {
	const document = new DOMParser().parseFromString(text, 'image/svg+xml')

	const error = document.querySelector('parsererror')
	if (error) throw new ArtworkError('The artwork file could not be parsed.')

	const root = document.documentElement
	if (root?.tagName.toLowerCase() !== 'svg') {
		throw new ArtworkError('The artwork file is not an SVG.')
	}

	const groups = [...root.children].filter((el) => el.tagName.toLowerCase() === 'g')

	return groups.slice(LEADING_SYSTEM_GROUPS).map((group) => ({
		group,
		strokes: [...group.children],
		groupStrokeWidth: readStrokeWidth(group),
	}))
}

/** A stroke's own width, its group's, or 2 — in that order, as in 2013. */
export function strokeWidthFor(stroke: Element, groupStrokeWidth: number | null): number {
	return readStrokeWidth(stroke) ?? groupStrokeWidth ?? DEFAULT_STROKE_WIDTH
}

/**
 * The shape of one stroke, in whichever of the two ways it was written down.
 *
 * There are two, and both are live in the same way the two file formats are:
 * paper 0.8 exported `<polyline points>` and `<line>`, which is all 585 archive
 * flipbooks; paper 0.12 exports `<path d>`, which is everything saved since the
 * rewrite. A loader that knows only the archive renders nothing at all for a
 * flipbook made this year, and only finds out when someone plays one back.
 *
 * Null for anything else — there has never been anything else, but a stroke that
 * loads slowly is a bug where a stroke that silently vanishes is a lost drawing,
 * so the caller falls back to `importSVG` rather than dropping it.
 */
export type StrokeGeometry =
	| { readonly kind: 'points'; readonly points: Vec2[] }
	| { readonly kind: 'data'; readonly data: string }

/**
 * The same numbers paper's own SVG importer would read.
 *
 * Deliberately its regular expression, from `importPoly` — the point of going round
 * `importSVG` is to skip the style, attribute and matrix resolution it does for
 * every element, not to parse the geometry differently. Anything that changed how
 * these coordinates are read would change the artwork.
 */
const SVG_NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g

export function strokeGeometry(stroke: Element): StrokeGeometry | null {
	switch (stroke.tagName.toLowerCase()) {
		case 'path': {
			const data = stroke.getAttribute('d')
			return data ? { kind: 'data', data } : null
		}
		case 'polyline':
			return { kind: 'points', points: parsePoints(stroke.getAttribute('points')) }
		case 'line':
			return {
				kind: 'points',
				points: [
					{ x: readNumber(stroke, 'x1'), y: readNumber(stroke, 'y1') },
					{ x: readNumber(stroke, 'x2'), y: readNumber(stroke, 'y2') },
				],
			}
		default:
			return null
	}
}

/** Trailing odd number dropped: a coordinate needs both halves to mean anything. */
function parsePoints(raw: string | null): Vec2[] {
	const coordinates = raw?.match(SVG_NUMBER)
	if (!coordinates) return []

	const points: Vec2[] = []
	for (let i = 0; i + 1 < coordinates.length; i += 2) {
		points.push({
			x: Number.parseFloat(coordinates[i] as string),
			y: Number.parseFloat(coordinates[i + 1] as string),
		})
	}
	return points
}

/** Zero when absent or unreadable, which is what SVG says an omitted x1 means. */
function readNumber(element: Element, name: string): number {
	const value = Number.parseFloat(element.getAttribute(name) ?? '')
	return Number.isFinite(value) ? value : 0
}

function readStrokeWidth(element: Element): number | null {
	const raw = element.getAttribute('stroke-width')
	if (raw === null) return null

	const width = Number.parseFloat(raw)
	return Number.isFinite(width) ? width : null
}

/**
 * The 2012 format: paper.js's own layer/segment JSON, with no paths in it at all —
 * only lists of points. There's nothing to import, so these get replayed through the
 * pencil, one stroke at a time, which is why a 2012 flipbook visibly draws itself.
 *
 * Coordinates were serialised as strings ("466.0"), so everything goes through
 * Number() rather than being trusted.
 */
export function parseLegacyPages(text: string): Vec2[][][] {
	let data: unknown
	try {
		data = JSON.parse(text)
	} catch {
		throw new ArtworkError('The artwork file could not be parsed.')
	}

	const layers = (data as { layers?: unknown })?.layers
	if (!Array.isArray(layers)) throw new ArtworkError('The artwork file has no layers.')

	return layers.slice(LEADING_SYSTEM_GROUPS).map((layer: unknown) => {
		const children = (layer as { children?: unknown })?.children
		if (!Array.isArray(children)) return []

		return children
			.map((child: unknown) => {
				const segments = (child as { segments?: unknown })?.segments
				if (!Array.isArray(segments)) return []

				return segments
					.map((segment: unknown) => {
						const point = segment as { x?: unknown; y?: unknown }
						// The pencil rounded these to whole pixels in 2013 and the
						// archive was drawn expecting it.
						return { x: Math.round(Number(point?.x)), y: Math.round(Number(point?.y)) }
					})
					.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
			})
			.filter((stroke) => stroke.length > 1)
	})
}

/**
 * Guarantees the leading-three-groups contract on the way out.
 *
 * paper.js emits one `<g>` per layer including empty ones, so in practice this finds
 * exactly what it expects. It's here because the alternative — the contract holding
 * by coincidence — breaks archive compatibility silently, in a way nothing would
 * notice until a flipbook saved today is opened and every page is off by one.
 */
export function assertLeadingGroups(svg: SVGElement, pageCount: number): void {
	const groups = [...svg.children].filter((el) => el.tagName.toLowerCase() === 'g')
	const expected = pageCount + LEADING_SYSTEM_GROUPS

	if (groups.length !== expected) {
		throw new ArtworkError(
			`Expected ${expected} groups in the exported SVG (${LEADING_SYSTEM_GROUPS} system + ` +
				`${pageCount} pages) but found ${groups.length}.`,
		)
	}
}

/**
 * What shape a saved flipbook is, read off the file itself.
 *
 * The artwork is the authority on this, and deliberately so: it is the one copy of
 * the answer that travels with the drawing. A `width`/`height` column can be absent
 * (the migration hasn't run), stale, or written by a deployment that didn't know
 * about it; the `viewBox` was written by the project that exported the coordinates
 * and cannot disagree with them.
 *
 * **No viewBox means 640×360**, and that is not a guess. paper 0.8 exported
 * `<svg xmlns="http://www.w3.org/2000/svg">` with no viewBox, no width and no height,
 * so every one of the 585 archive flipbooks is silent — and every one of them was
 * drawn on a 640×360 project. paper 0.12 writes all three, so anything saved since
 * the rewrite says so itself. `lib/thumbnail.js` makes the same assumption in the
 * same words for the same reason.
 *
 * The `width`/`height` attributes are ignored when a viewBox is present: they are the
 * *display* size, and it is the viewBox that states the coordinate space the numbers
 * in the file are in.
 */
export function pageSizeFromSvg(text: string): PageSize {
	const match = /<svg\b[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i.exec(text)
	if (!match?.[1]) return LEGACY_PAGE_SIZE

	// "0,0,640,360" and "0 0 640 360" are both written by paper depending on version,
	// and the SVG grammar allows either separator with any amount of space around it.
	const parts = match[1]
		.trim()
		.split(/[\s,]+/)
		.map(Number)
	if (parts.length !== 4) return LEGACY_PAGE_SIZE

	const [, , width, height] = parts as [number, number, number, number]
	if (!(width > 0) || !(height > 0)) return LEGACY_PAGE_SIZE

	return { width, height }
}

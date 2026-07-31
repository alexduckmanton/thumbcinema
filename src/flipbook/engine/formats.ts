/**
 * Reading and writing the two artwork formats.
 *
 * Both are still live and both are still in the database, so this is a compatibility
 * layer as much as a serialiser — see `docs/data-formats.md`. Everything here is a
 * pure function of a string, which is what makes the awkward parts testable.
 */

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
	if (!root || root.tagName.toLowerCase() !== 'svg') {
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

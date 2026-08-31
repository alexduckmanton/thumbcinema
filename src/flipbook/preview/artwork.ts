/**
 * A saved flipbook, as things a 2D canvas context can stroke.
 *
 * This is the whole of what the gallery needs to play a flipbook, and what it
 * deliberately isn't is the drawing tool. `FlipbookEngine` builds a paper.js project
 * — a scene graph, a layer per page, hit testing, an undo history, four tools — all
 * of which exists so a drawing can be *changed*. A card in the grid only ever shows
 * one, so none of it is earning its place there, and paper is 71 kB gzipped that the
 * gallery would otherwise be downloading before it could show anything at all.
 *
 * What the two do share is the part that is actually hard: `engine/formats.ts`, which
 * knows the two artwork formats, the three stroke vocabularies and the leading-three-
 * groups contract. That file has never imported paper and every function in it is a
 * pure function of a string, which is exactly why it can be read twice.
 *
 * The output holds `Path2D` and nothing else. It is a native object with the geometry
 * already parsed, so a frame costs one `stroke()` per stroke and no arithmetic at all
 * — and it is far smaller in memory than the arrays of point objects it replaces,
 * which matters when a hover can land on a forty-page archive flipbook.
 *
 * **It draws the same pixels paper does, and that is measured rather than assumed.**
 * The same page rendered both ways, at the same size, composited over the same white:
 * on an archive flipbook (`a2681`, polylines) and on one saved by this tool
 * (`d7c3u4inrz`, path data) the ink pixel counts are *equal* and no channel differs by
 * more than 1 — which is to say identical, because paper.js strokes to a 2D canvas
 * too, with the same cap, join, colour and width restated the same way. The one
 * difference is the 2012 format, where 152 pixels of 921,600 differ on a dense page:
 * the engine replays those through the pencil, which resamples them, and this doesn't.
 * See `legacyPageStrokes`.
 */

import type { FlipbookFormat } from '../../lib/api'
import { LEGACY_PAGE_SIZE, type PageSize } from '../engine/constants'
import {
	DEFAULT_STROKE_WIDTH,
	type ParsedPage,
	type StrokeGeometry,
	pageSizeFromSvg,
	parseLegacyPages,
	parseSvgPages,
	strokeGeometry,
	strokeWidthFor,
} from '../engine/formats'
import type { Vec2 } from '../engine/geometry'

/**
 * What the 2012 format is drawn at.
 *
 * There are no widths in that format at all — it is point lists — so the engine's
 * playback pencil is constructed with 2 and every stroke in a 2012 flipbook comes
 * out that thick. The same number here, for the same artwork.
 */
export const LEGACY_STROKE_WIDTH = 2

/** One stroke, before it has been handed to a canvas. Pure data; see `toPath2D`. */
export interface StrokeSpec {
	readonly geometry: StrokeGeometry
	readonly width: number
}

export interface PreviewStroke {
	readonly path: Path2D
	readonly width: number
}

export interface PreviewPage {
	readonly strokes: PreviewStroke[]
}

/**
 * The strokes on one page of a saved SVG.
 *
 * Anything `strokeGeometry` doesn't recognise is dropped. The engine falls back to
 * paper's `importSVG` there, and can — it has paper; the whole point of this file is
 * that the gallery hasn't. So the trade is explicit and it is the right way round: a
 * preview missing a stroke is a preview, and the card still opens onto a playback
 * page that renders the flipbook properly. Across 594 flipbooks and three stroke
 * vocabularies there has never been a fourth, and `path`, `polyline` and `line` are
 * all any version of this tool has ever written.
 */
export function svgPageStrokes(page: ParsedPage): StrokeSpec[] {
	const strokes: StrokeSpec[] = []

	for (const stroke of page.strokes) {
		const geometry = strokeGeometry(stroke)
		if (!geometry) continue

		strokes.push({ geometry, width: strokeWidthFor(stroke, page.groupStrokeWidth) })
	}

	return strokes
}

/**
 * The strokes on one page of a 2012 flipbook.
 *
 * The engine replays these through the pencil, which resamples them to even spacing
 * on the way in. Not done here, and it costs nothing to skip: resampling puts its
 * points *on* the polyline it was given, so the line through them is the same line.
 * What it exists for is the push tool, which needs evenly spaced points to bend
 * something, and nothing here bends anything.
 *
 * It is not quite nothing, and the difference is the right way round. Measured against
 * the engine on a dense page of `a337`, 152 pixels in 921,600 differ — a corner where
 * five-pixel spacing chords across the turn, and where this draws the corner the file
 * actually holds. The preview is the more faithful of the two; it is a sixth of a
 * percent either way.
 */
export function legacyPageStrokes(page: Vec2[][]): StrokeSpec[] {
	return page.map((points) => ({
		geometry: { kind: 'points', points },
		width: LEGACY_STROKE_WIDTH,
	}))
}

/** The geometry, as a path the canvas can stroke. */
export function toPath2D(geometry: StrokeGeometry): Path2D {
	if (geometry.kind === 'data') return new Path2D(geometry.data)

	const path = new Path2D()
	const [first, ...rest] = geometry.points
	if (!first) return path

	path.moveTo(first.x, first.y)
	for (const point of rest) path.lineTo(point.x, point.y)
	return path
}

export interface ArtworkReader {
	/** How many pages there are, known before any of them has been built. */
	readonly total: number
	/**
	 * The shape of a page, off the file's own `viewBox`.
	 *
	 * Read here as well as stored on the row because this is the copy that cannot be
	 * wrong: the card knows the shape from the gallery listing before the artwork
	 * arrives, which is what sizes the tile, but what is actually drawn is scaled
	 * against the space these coordinates are in. See `pageSizeFromSvg`.
	 */
	readonly page: PageSize
	/** Yields one page per call, in order, until there are none left. */
	readonly pages: Generator<PreviewPage>
}

/**
 * A whole saved flipbook, page by page, on demand.
 *
 * A generator rather than an array because the caller drives it in frame-sized
 * slices — the same bargain `FlipbookEngine.replay` makes, and for the same reason:
 * the largest flipbook in the archive is nine megabytes of polyline text, and
 * building all of it before showing any of it is a locked-up tab. The page count is
 * separate and immediate, so a scrub can map the pointer across the whole flipbook
 * from the first frame rather than across however much of it has arrived.
 *
 * Splitting the file is not deferred: `DOMParser` and `JSON.parse` are one call into
 * native code each, and there is nothing to gain by slicing what is already the fast
 * part. The per-page work — reading coordinates, building paths — is what's sliced.
 */
export function readArtwork(text: string, format: FlipbookFormat): ArtworkReader {
	if (format === 'legacy-json') {
		const pages = parseLegacyPages(text)
		// The 2012 format has no root element to carry a viewBox and predates any other
		// shape, so it is the legacy page by construction rather than by fallback.
		return { total: pages.length, page: LEGACY_PAGE_SIZE, pages: buildLegacy(pages) }
	}

	const pages = parseSvgPages(text)
	return { total: pages.length, page: pageSizeFromSvg(text), pages: buildSvg(pages) }
}

function* buildSvg(pages: ParsedPage[]): Generator<PreviewPage> {
	for (const page of pages) {
		yield { strokes: svgPageStrokes(page).map(build) }
	}
}

function* buildLegacy(pages: Vec2[][][]): Generator<PreviewPage> {
	for (const page of pages) {
		yield { strokes: legacyPageStrokes(page).map(build) }
	}
}

function build(spec: StrokeSpec): PreviewStroke {
	return { path: toPath2D(spec.geometry), width: spec.width || DEFAULT_STROKE_WIDTH }
}

/**
 * Which frame the pointer is over: the left-hand edge of a card is page one and the
 * right-hand edge is the last page, whatever is in between spread evenly.
 *
 * The same rule as `pageAt` in `PageNav`, and rounding rather than flooring for the
 * same reason it does — the two ends are what you aim at, so they get the half-width
 * bands rather than the last page getting a sliver at the very edge and the one
 * before it getting a full share.
 */
export function frameAt(fraction: number, pages: number): number {
	if (pages < 2) return 0
	return Math.round(Math.min(1, Math.max(0, fraction)) * (pages - 1))
}

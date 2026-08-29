/**
 * One page of a flipbook, on a 2D canvas.
 *
 * All of it, and there is deliberately not much: a flipbook is dark grey ink on white
 * paper with round caps and round joins, and every page of every one of the 594 in
 * the database is exactly that. The engine restates the same three properties per
 * page on the way in (see `FlipbookEngine.loadSvg`), because the saved file carries
 * them on the `<g>` and the strokes lose them when they are imported one by one —
 * so what is stated here is not an approximation of the artwork, it is the same
 * statement made in the same place for the same reason.
 */

import { type PageSize, PENCIL_COLOR } from '../engine/constants'
import type { PreviewPage } from './artwork'

/** The paper. PNG has none unless you paint it, and neither does a canvas. */
const PAPER = '#fff'

/**
 * Sizes a canvas's backing store for the box it is being shown in.
 *
 * Returns whether anything changed, because assigning `width` or `height` clears the
 * bitmap even when the value is the same — which on a resize observer that fires on
 * every scroll-induced reflow would be a card that flickers white. Callers redraw
 * when it says true.
 *
 * The device pixel ratio is capped at 2. Above that the third ratio's worth of pixels
 * is past what anyone can see on a drawing this size, and the backing store grows
 * with the square of it.
 */
export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): boolean {
	const ratio = Math.min(2, window.devicePixelRatio || 1)
	const target = { width: Math.round(width * ratio), height: Math.round(height * ratio) }

	if (canvas.width === target.width && canvas.height === target.height) return false

	canvas.width = target.width
	canvas.height = target.height
	return true
}

/**
 * Draws `page` across the whole of `canvas`.
 *
 * The transform is the one thing here worth reading twice. A flipbook's coordinates
 * are in the space it was drawn in whatever it is being shown at —
 * `Scene.pinCoordinates` is what guarantees that — so `size` is the file's own space
 * and the canvas is scaled to fit it. Scaling the context rather than the geometry is
 * also what
 * makes the ink come out right: `lineWidth` is in the space it is set in, so a
 * 3-unit stroke on a card drawn at half size renders 1.5px across, exactly as the
 * same drawing does on the playback page.
 */
export function drawPage(canvas: HTMLCanvasElement, page: PreviewPage, size: PageSize): void {
	const context = canvas.getContext('2d')
	if (!context) return

	context.setTransform(canvas.width / size.width, 0, 0, canvas.height / size.height, 0, 0)

	context.fillStyle = PAPER
	context.fillRect(0, 0, size.width, size.height)

	context.strokeStyle = PENCIL_COLOR
	context.lineCap = 'round'
	context.lineJoin = 'round'

	// `lineWidth` is only written when it actually changes. A flipbook is nearly
	// always one width from end to end — the pencil has had one setting since the
	// width control was removed — so this is one assignment for the whole page, and
	// the archive's per-stroke widths still cost nothing they don't have to.
	let width = Number.NaN
	for (const stroke of page.strokes) {
		if (stroke.width !== width) {
			width = stroke.width
			context.lineWidth = width
		}
		context.stroke(stroke.path)
	}
}

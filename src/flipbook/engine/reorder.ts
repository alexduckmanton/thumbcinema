/**
 * Dragging a page to a different place in the flipbook, as arithmetic.
 *
 * Three pure functions, and between them they are the whole of what the reorder
 * gesture knows: how far the page is allowed to travel, which slot it would land in if
 * it were let go now, and where every *other* page has to stand to leave room for it.
 *
 * Separate from the component that calls them for the reason `pages.ts` is separate
 * from the engine — this is where being wrong by one page would look like a subtle
 * animation bug rather than an error, so it is tested on its own. Nothing here knows
 * about the DOM, and every distance is in the same units: pixels, at the pitch the
 * strip is currently laid out at. See `PageStrip`, which measures it.
 */

/**
 * Where the page is being carried, while it is being carried.
 *
 * `from` is the slot it was picked up from and does not change; `to` is the slot it
 * would land in if it were let go now, and is what the strip opens a gap at. Both are
 * indices into the flipbook, not pixels — the pixels are written straight onto the DOM
 * and never come back through React. See `usePageReorder`.
 */
export interface Reorder {
	from: number
	to: number
	/** True once the pointer has gone and the flipbook is closing up round the page. */
	settling: boolean
}

/**
 * How long the flipbook takes to close up round a page that has been dropped.
 *
 * Stated once, here, and handed to the stylesheets as `--settle`: the settle is three
 * transitions on three different elements — the strip's `left`, each thumbnail's
 * `transform` and the drawing's own — and they compose into one movement only for
 * exactly as long as they agree about the duration. A number in a stylesheet and a
 * `setTimeout` next to it is the classic way for that to stop being true.
 */
export const SETTLE_MS = 300

/**
 * How far the page can be dragged, which is as far as there is flipbook to drag it
 * through and no further.
 *
 * Hard, rather than an elastic overshoot: what is past either end is not a slot, so a
 * page that could be dragged out there would be a page saying it might land somewhere
 * it can't.
 */
export function clampDrag(drag: number, from: number, pages: number, step: number): number {
	return Math.max(-from * step, Math.min(drag, (pages - 1 - from) * step))
}

/**
 * Which slot the page would take if it were let go now: the nearest one, so the swap
 * happens as the page passes the halfway line rather than when it fully clears its
 * neighbour.
 *
 * Guarded on `step`, which is measured off a laid-out strip and is zero for the frame
 * before there is one — a division by it would hand `NaN` to the scene.
 */
export function targetIndex(drag: number, from: number, pages: number, step: number): number {
	if (step <= 0 || pages < 2) return from

	const slot = from + Math.round(drag / step)
	return Math.max(0, Math.min(slot, pages - 1))
}

/**
 * Where page `index` has to stand while the page from slot `from` is being carried to
 * slot `to`: one step aside if the carried page has to pass through it, and nowhere at
 * all otherwise.
 *
 * Only ever one step, whatever the distance dragged — a page three slots along is
 * displaced by exactly one, because the two pages either side of it are moving too and
 * what they are all doing is closing up a gap and opening another one.
 *
 * The carried page gets an answer as well, and it is the whole of the way. Nothing can
 * see it — the live canvas is standing in front of the page being dragged, and the
 * canvas is what actually follows the pointer — but it has to be *left* in the slot it
 * is being dropped into, or handing the flipbook back to the strip at the end of the
 * gesture would move it.
 */
export function pageShift(index: number, from: number, to: number, step: number): number {
	if (index === from) return (to - from) * step
	if (index > from && index <= to) return -step
	if (index >= to && index < from) return step
	return 0
}

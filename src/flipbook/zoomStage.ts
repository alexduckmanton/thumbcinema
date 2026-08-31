import { Store, useStore } from '../lib/store'
import type { PageSize } from './engine/constants'

/**
 * The window on the page that the zoom stage is showing, in project units.
 *
 * v11's whole state, and deliberately all of it: a rectangle on a 640×360 page. What is
 * drawn from it — the outline on the paper, the magnified canvas under the tools, and
 * where a finger on that canvas lands in the artwork — is three readings of these four
 * numbers, so there is one thing to be right about rather than three.
 */
export interface Viewport {
	x: number
	y: number
	w: number
	h: number
}

/**
 * How short the band under the tools may get before v11 gives up and behaves as v2.
 *
 * The stage is whatever is left of the column once the strip, the paper, the page bar
 * and the tray have taken theirs, and on a phone held sideways that is nothing at all —
 * as it is on a desktop, where the stylesheet hides the stage outright and this is what
 * reads the consequence. A drawing surface an inch tall is worse than no second canvas,
 * and falling back to v2 is exactly what "no second canvas" means.
 */
export const MIN_STAGE_HEIGHT = 64

/**
 * How far in the stage will go: a quarter of the page across.
 *
 * Four times is where a 3-unit pencil stroke is 12 units wide on screen — a line you can
 * place deliberately with a fingertip, which is the whole point of the mode. Past that
 * the window holds so little of the drawing that it stops being obvious which part of it
 * you are looking at, which is the complaint the loupe modes collected.
 */
export const MAX_ZOOM = 4

/**
 * Where a fresh stage starts, which is not the same question for the two modes that have
 * one — so it is the caller's answer rather than a constant. See `startingZoom`.
 *
 * v11 opens at twice life size, because the paper above it is showing the whole page and
 * a stage that opened at 1× would be a second copy of the same view. v12 opens at the
 * whole page, because it *is* the page: there is nothing else to find your bearings in,
 * and a drawing tool that starts somewhere you didn't ask to be is a drawing tool you
 * have to un-zoom before you can start.
 */
export const DEFAULT_ZOOM = 2

/**
 * The largest window of this shape that fits on the page.
 *
 * The stage's aspect is *measured* rather than stated — it is whatever the surface comes
 * out as — so the biggest window is whichever of the page's two dimensions binds first.
 *
 * **This is where a stage on the paper opens and it is as far out as it goes.** You cannot
 * zoom out past the whole page: the resting view is the widest there is, so pinching only
 * ever goes in and comes back to exactly the size the layout chose.
 */
export function maxWidth(page: PageSize, aspect: number): number {
	return Math.min(page.width, page.height * aspect)
}

/** And the smallest, which is where `MAX_ZOOM` bites — or the largest, on a tall stage. */
export function minWidth(page: PageSize, aspect: number): number {
	return Math.min(maxWidth(page, aspect), page.width / MAX_ZOOM)
}

/**
 * Puts a window back inside the rules: the stage's shape, the zoom limits, and the page.
 *
 * The order matters and is the whole function. The width is clamped first because the
 * height is derived from it, then the height follows from the aspect, and only then is
 * the position clamped — against a size that is already final, so a window that has just
 * been shrunk can't be left hanging off an edge it used to reach.
 */
export function clampViewport(view: Viewport, page: PageSize, aspect: number): Viewport {
	const w = clamp(view.w, minWidth(page, aspect), maxWidth(page, aspect))
	const h = w / aspect

	return {
		w,
		h,
		x: clamp(view.x, 0, page.width - w),
		y: clamp(view.y, 0, page.height - h),
	}
}

/**
 * The middle of the page at `zoom`, or as near to it as the limits allow.
 *
 * `zoom` 1 is the whole page, which is where a stage standing on the paper opens and is
 * also as far out as it goes — see `maxWidth`. So the flipbook at rest is at exactly the
 * size the layout gave it, and pinching only takes you in.
 */
export function defaultViewport(page: PageSize, aspect: number, zoom = DEFAULT_ZOOM): Viewport {
	const w = page.width / zoom
	const h = w / aspect

	return clampViewport({ w, h, x: (page.width - w) / 2, y: (page.height - h) / 2 }, page, aspect)
}

/**
 * Scales the window about a point, keeping whatever is under that point under it.
 *
 * `scale` is what the window's width is multiplied by, so it is the caller that decides
 * which way a pinch reads — and the two surfaces genuinely disagree. On the stage you
 * are handling the *drawing*: fingers apart means a closer look, which is a smaller
 * window. On the paper you are handling the *rectangle*: fingers apart means a bigger
 * rectangle, and a wider view underneath. Both are what the thing under your fingers
 * would do if you could pick it up, which is the only test either of them has to pass.
 */
export function zoomViewport(
	view: Viewport,
	page: PageSize,
	aspect: number,
	scale: number,
	at: Point,
): Viewport {
	const w = clamp(view.w * scale, minWidth(page, aspect), maxWidth(page, aspect))
	const h = w / aspect

	// How far through the window the anchor sits, which is what has to survive: a point a
	// third of the way across before the pinch is a third of the way across after it.
	const fx = view.w === 0 ? 0.5 : (at.x - view.x) / view.w
	const fy = view.h === 0 ? 0.5 : (at.y - view.y) / view.h

	return clampViewport({ w, h, x: at.x - fx * w, y: at.y - fy * h }, page, aspect)
}

/** Moves the window by a delta in project units, and no further than the page. */
export function panViewport(
	view: Viewport,
	dx: number,
	dy: number,
	page: PageSize,
	aspect: number,
): Viewport {
	return clampViewport({ ...view, x: view.x + dx, y: view.y + dy }, page, aspect)
}

/** Puts the window's centre on a project point, which is what dragging the outline does. */
export function centreViewport(
	view: Viewport,
	at: Point,
	page: PageSize,
	aspect: number,
): Viewport {
	return clampViewport({ ...view, x: at.x - view.w / 2, y: at.y - view.h / 2 }, page, aspect)
}

/**
 * A point on the stage, in its own CSS pixels, as a point in the artwork.
 *
 * The one direction that matters — every tool the stage drives is handed a project point
 * — and it is deliberately not clamped. A finger that slides off the edge of the stage
 * mid-stroke is still drawing, exactly as a mouse dragged off the canvas is, and the
 * stroke goes where the finger went.
 */
export function stagePoint(view: Viewport, x: number, y: number, box: Box): Point {
	return {
		x: view.x + (box.width === 0 ? 0 : (x / box.width) * view.w),
		y: view.y + (box.height === 0 ? 0 : (y / box.height) * view.h),
	}
}

/**
 * And the other way: a point in the artwork, as a point on the stage.
 *
 * The inverse of `stagePoint`, and it exists for one thing — v13's standing cursor, which
 * is kept in the page's own units so that panning and zooming carry it about with the
 * drawing it is standing on, and has to be drawn somewhere on the glass. Not clamped, for
 * the same reason its inverse isn't: a cursor pushed off the edge of the window is a
 * position, and it is the caller's business what to do about it.
 */
export function stagePlace(view: Viewport, at: Point, box: Box): Point {
	return {
		x: view.w === 0 ? 0 : ((at.x - view.x) / view.w) * box.width,
		y: view.h === 0 ? 0 : ((at.y - view.y) / view.h) * box.height,
	}
}

/** And a point on the paper, in its CSS pixels, the same way. The paper is the page. */
export function paperPoint(x: number, y: number, box: Box, page: PageSize): Point {
	return {
		x: box.width === 0 ? 0 : (x / box.width) * page.width,
		y: box.height === 0 ? 0 : (y / box.height) * page.height,
	}
}

export interface Point {
	x: number
	y: number
}

export interface Box {
	width: number
	height: number
}

/**
 * The stage's state, shared by the four things that need it.
 *
 * `PointerLayer` writes it — a pinch and a drag are pointer gestures and it is the file
 * that owns those — and three components read it: the canvas under the tools, the
 * outline on the paper, and the ring, whose diameter is a fraction of `view.w` rather
 * than of the page. A module-level store rather than props for the reason `pressedTool`
 * is one: the writer is built inside `InkCursor` and two of the readers are in other
 * branches of the tree entirely.
 *
 * `view` is null exactly when there is no stage — no room for one, or a layout that
 * hides it — and that null is the single condition v11 falls back to v2 on.
 */
const store = new Store<{ box: Box; view: Viewport | null }>({
	box: { width: 0, height: 0 },
	view: null,
})

export const subscribeStage = store.subscribe

export function stage(): { box: Box; view: Viewport | null } {
	return store.snapshot
}

/** The stage, for React: the canvas that draws it, and the outline on the paper. */
export function useStage(): { box: Box; view: Viewport | null } {
	return useStore(store)
}

export function stageView(): Viewport | null {
	return store.snapshot.view
}

/**
 * The element the stage's canvas lives in, for the one question that needs it: did this
 * touch start down there, or up on the paper?
 *
 * Not in the store, because nothing re-renders when it changes and a DOM node in a
 * snapshot invites somebody to render off it.
 */
let element: HTMLElement | null = null

export function setStageElement(next: HTMLElement | null): void {
	element = next
}

export function stageElement(): HTMLElement | null {
	return element
}

/**
 * Says how big the stage is now, and keeps the window it is showing.
 *
 * Called on every resize, and a resize is nearly always a rotation or a keyboard — so
 * the window is *carried over* rather than reset, clamped into the new shape. Losing
 * your place because the address bar collapsed would be the same bug the page strip
 * avoids by measuring rather than stating its pitch.
 */
export function measureStage(box: Box, page: PageSize, zoom = DEFAULT_ZOOM): void {
	const current = store.snapshot
	// Nothing has changed, so nothing is written. Not an optimisation: this is called from
	// a `ResizeObserver`, and a write here is a React render, which is a layout, which is
	// another notification — a loop the browser reports as an error event, and which this
	// page reads as a crash. See `ZoomStage`, which defers the call for the same reason.
	if (current.box.width === box.width && current.box.height === box.height) return

	const usable = box.width > 0 && box.height >= MIN_STAGE_HEIGHT

	if (!usable) {
		store.set({ box, view: null })
		return
	}

	const aspect = box.width / box.height
	const previous = current.view
	store.set({
		box,
		view: previous ? clampViewport(previous, page, aspect) : defaultViewport(page, aspect, zoom),
	})
}

/** The stage is going away — the mode was switched off, or the page left. */
export function clearStage(): void {
	store.set({ box: { width: 0, height: 0 }, view: null })
}

export function setViewport(view: Viewport): void {
	if (store.snapshot.view === null) return
	store.set({ ...store.snapshot, view })
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high)
}

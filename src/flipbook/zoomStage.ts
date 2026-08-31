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
 * How the paper itself is standing, which is the whole of v12's and v13's zoom.
 *
 * The two on-paper modes do not crop: their window is the whole page and never anything
 * less, and a pinch makes the *sheet* bigger — it grows out of its frame, over the strip
 * and under the page bar, the tray and the footer, which is what the thing under your
 * fingers would do if you could pick it up. So what a pinch changes is where the paper is
 * and how big, in the frame's own CSS pixels, and the window it is showing stays exactly
 * as wide as the page.
 *
 * `x` and `y` are the paper's top-left corner measured from the frame's, which is what a
 * `transform-origin: 0 0` translate wants; at rest both are zero and the scale is 1, which
 * is the paper sitting in its frame and every mode that isn't one of these two.
 *
 * v11 is the odd one out and keeps `Viewport` to itself: its stage is a second canvas of
 * its own shape in the band under the tools, so a window on the page is the only thing it
 * could be showing. Nothing there ever moves this.
 */
export interface PageZoom {
	scale: number
	x: number
	y: number
}

/** The paper in its frame, life size: what every mode but a pinched one is showing. */
export const RESTING_PAGE: PageZoom = { scale: 1, x: 0, y: 0 }

/**
 * Puts the paper back inside the rules: no smaller than its frame, no bigger than
 * `MAX_ZOOM`, and never dragged off the frame it belongs to.
 *
 * The offsets are clamped so the frame stays *covered*. A sheet bigger than its frame can
 * be moved about behind it, and the part of it that hangs outside is the part that flows
 * under the page bar and the tray — but the frame itself always has drawing in it, so
 * there is no arrangement of a pinch and a drag that shows a strip of nothing where the
 * page used to be, and letting go of the zoom drops the paper exactly home.
 */
export function clampPage(zoom: PageZoom, box: Box): PageZoom {
	const scale = clamp(zoom.scale, 1, MAX_ZOOM)

	return {
		scale,
		x: clamp(zoom.x, box.width - box.width * scale, 0),
		y: clamp(zoom.y, box.height - box.height * scale, 0),
	}
}

/**
 * Scales the paper about a point on the frame, keeping whatever is under that point
 * under it — the same promise `zoomViewport` makes, stated the other way up.
 *
 * `ratio` is what the scale is multiplied by, so fingers apart is a bigger sheet: the
 * paper is the thing being handled here, where in v11's band the *window* is.
 */
export function zoomPage(zoom: PageZoom, box: Box, ratio: number, at: Point): PageZoom {
	const scale = clamp(zoom.scale * ratio, 1, MAX_ZOOM)
	// Against the scale that was actually reached rather than the ratio asked for, or the
	// paper would slide sideways under a pinch that the clamp had already stopped.
	const growth = zoom.scale === 0 ? 1 : scale / zoom.scale

	return clampPage(
		{ scale, x: at.x - (at.x - zoom.x) * growth, y: at.y - (at.y - zoom.y) * growth },
		box,
	)
}

/** Moves the paper by a delta in the frame's pixels, and no further than the rules allow. */
export function panPage(zoom: PageZoom, dx: number, dy: number, box: Box): PageZoom {
	return clampPage({ ...zoom, x: zoom.x + dx, y: zoom.y + dy }, box)
}

/**
 * A point on the frame, as a point on the paper standing behind it.
 *
 * The pinch moves the sheet rather than the window, so a finger's distance from the
 * frame's top left is not a distance on the drawing until the sheet's own offset and
 * scale are taken back out. Everything that asks where a finger is on the page goes
 * through here first and then through `stagePoint`, which is still the one place a
 * position on the glass becomes a position in the artwork.
 */
export function onPage(zoom: PageZoom, x: number, y: number): Point {
	return { x: (x - zoom.x) / zoom.scale, y: (y - zoom.y) / zoom.scale }
}

/**
 * How much of the page is on screen, in project units — which is what v13's cursor is
 * kept inside.
 *
 * A pinched page runs off the frame in every direction and mostly off the *window* with
 * it, and a cursor standing on the part that is off the screen is a cursor you have to go
 * and find. So the window is the bound rather than the frame: `paper` is where the sheet
 * is on screen, `screen` is what there is to see it in, and what comes back is the
 * overlap, expressed on the page.
 */
export function visiblePage(paper: Rect, screen: Rect, page: PageSize): Viewport {
	const left = Math.max(paper.left, screen.left)
	const top = Math.max(paper.top, screen.top)
	const right = Math.min(paper.left + paper.width, screen.left + screen.width)
	const bottom = Math.min(paper.top + paper.height, screen.top + screen.height)

	// Nothing of it is showing, which a page dragged clean off a very short window can
	// manage. The whole page then, rather than an empty rectangle a cursor can't be in.
	if (right <= left || bottom <= top || paper.width === 0 || paper.height === 0) {
		return { x: 0, y: 0, w: page.width, h: page.height }
	}

	const perX = page.width / paper.width
	const perY = page.height / paper.height

	return {
		x: (left - paper.left) * perX,
		y: (top - paper.top) * perY,
		w: (right - left) * perX,
		h: (bottom - top) * perY,
	}
}

export interface Rect {
	left: number
	top: number
	width: number
	height: number
}

/**
 * The largest window of this shape that fits on the page.
 *
 * The stage's aspect is *measured* rather than stated — it is whatever the leftover band
 * comes out as — so it is nearly always wider than the page itself, and the biggest
 * window is therefore the full width of the page and only part of its height. That is
 * not a limitation to work around: the paper above is the view that shows everything,
 * and this one is the view you draw in.
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

/** The middle of the page at `zoom`, or as near to it as the limits allow. */
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
interface Stage {
	box: Box
	view: Viewport | null
	/** How the paper is standing. Resting in every mode but a pinched v12 or v13. */
	zoom: PageZoom
}

const store = new Store<Stage>({
	box: { width: 0, height: 0 },
	view: null,
	zoom: RESTING_PAGE,
})

export const subscribeStage = store.subscribe

export function stage(): Stage {
	return store.snapshot
}

/** The stage, for React: the canvas that draws it, and the outline on the paper. */
export function useStage(): Stage {
	return useStore(store)
}

export function stageView(): Viewport | null {
	return store.snapshot.view
}

export function pageZoom(): PageZoom {
	return store.snapshot.zoom
}

/** Where the pinch leaves the paper. Ignored where there is no stage to pinch. */
export function setPageZoom(zoom: PageZoom): void {
	if (store.snapshot.view === null) return
	store.set({ ...store.snapshot, zoom })
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
		store.set({ box, view: null, zoom: RESTING_PAGE })
		return
	}

	const aspect = box.width / box.height
	const previous = current.view
	store.set({
		box,
		view: previous ? clampViewport(previous, page, aspect) : defaultViewport(page, aspect, zoom),
		// Carried over rather than reset, exactly as the window is — a resize here is
		// nearly always a rotation or the address bar sliding, and losing your place is
		// the same loss either way — but clamped, because the frame it is measured
		// against has just changed size under it.
		zoom: clampPage(current.zoom, box),
	})
}

/** The stage is going away — the mode was switched off, or the page left. */
export function clearStage(): void {
	store.set({ box: { width: 0, height: 0 }, view: null, zoom: RESTING_PAGE })
}

export function setViewport(view: Viewport): void {
	if (store.snapshot.view === null) return
	store.set({ ...store.snapshot, view })
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high)
}

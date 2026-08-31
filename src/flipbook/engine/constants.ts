/**
 * How big a page is, in project units.
 *
 * There are two of these and there will only ever be two. Everything drawn between
 * 2012 and 2026 is `LEGACY_PAGE_SIZE`; everything drawn since is `SQUARE_PAGE_SIZE`.
 * A flipbook keeps the shape it was drawn at for ever — a remix of a 16:9 flipbook is
 * still 16:9 — so this is a property of the artwork rather than a setting, and there
 * is deliberately no way for anyone to pick one.
 */
export interface PageSize {
	readonly width: number
	readonly height: number
}

/**
 * 2012–2026, and the whole of the archive.
 *
 * Also the answer for any artwork that doesn't say what shape it is. paper 0.8 wrote
 * no `viewBox`, no width and no height, so every one of the 585 archive flipbooks is
 * silent about its own size — and all of them are this. See `pageSizeFromSvg`.
 */
export const LEGACY_PAGE_SIZE: PageSize = { width: 640, height: 360 }

/**
 * What gets drawn now.
 *
 * 640 across rather than 360, so the horizontal resolution is unchanged from the
 * legacy page and every number tuned against it still means what it meant:
 * `DEFAULT_STROKE_WIDTH`, `FLATTEN_DISTANCE`, the ink cursor's radii and the push
 * tool's reach are all in project units, and halving the page would have made every
 * one of them twice as coarse without anybody changing a line.
 */
export const SQUARE_PAGE_SIZE: PageSize = { width: 640, height: 640 }

/** What a blank page in the drawing tool is. */
export const DEFAULT_PAGE_SIZE = SQUARE_PAGE_SIZE

/**
 * How much bigger than the page you can actually draw, in each direction.
 *
 * The create page is an infinite canvas with a crop frame on it: the sheet extends past
 * the page on all four sides, you pinch out to reach the surround, and what is inside the
 * frame at save time is the flipbook. 2 means the drawable area is twice the page's width
 * and twice its height, with the page centred in it — so a square page gets 1280×1280 and a
 * legacy 16:9 remix gets 1280×720, and neither shape needs a special case.
 *
 * **Stated in project units rather than derived from the window**, which is the whole
 * point: how much room there is to draw in is a property of the flipbook, exactly as its
 * shape is. A surround measured against the screen would give a phone and a desktop
 * different drawings from the same gestures.
 *
 * It costs backing store. The live canvas renders the whole extent, so at 2 it is four
 * times the pixels it was — 2560×2560 on a retina screen against 1280×1280 — which is one
 * canvas rather than one per page and is why the page strip going was worth having first.
 */
export const CANVAS_SCALE = 2

/**
 * The drawable area for a page of this shape, in project units.
 *
 * The page keeps its own origin at (0,0): the surround is *negative* on both axes, running
 * from `-(width / 2)` to `width * 1.5`. That is what lets the export stay byte-identical to
 * what it has always been — see `Scene.exportRoot`, which pins the exported root to the
 * page rectangle while the view covers all of this.
 */
export function canvasExtent(page: PageSize): PageSize {
	return { width: page.width * CANVAS_SCALE, height: page.height * CANVAS_SCALE }
}

/** Where the page's top-left corner sits inside the extent, in project units. */
export function canvasOrigin(page: PageSize): { x: number; y: number } {
	return { x: -(page.width * (CANVAS_SCALE - 1)) / 2, y: -(page.height * (CANVAS_SCALE - 1)) / 2 }
}

/*
 * The gap either side of a page thumbnail used to be here, as PAGE_MARGIN. It is in
 * PageStrip's stylesheet now and nowhere else: it differs by layout, and the strip
 * reads its own padding back off the page rather than agreeing a number with the CSS.
 */

/** Ink. */
export const PENCIL_COLOR = '#444'
/** Selected strokes and the push tool's dots. */
export const HIGHLIGHT_COLOR = '#29f'
/** The selection box while alt is held, i.e. while a drag would duplicate. */
export const DUPLICATE_COLOR = '#3c2'

/** How far apart a drawn stroke's points end up. See `resamplePolyline`. */
export const FLATTEN_DISTANCE = 5

/** Playback speed, in both directions. 2013's number. */
export const FPS = 12

/** Strokes underneath the selection fade to this while something is selected. */
export const FADED_OPACITY = 0.2
/** The onion skin of the previous page. */
export const ONION_OPACITY = 0.1

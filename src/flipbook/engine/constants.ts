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

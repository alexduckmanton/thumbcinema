/** The one canvas size the whole site is built around. Every flipbook ever saved is this shape. */
export const CANVAS_WIDTH = 640
export const CANVAS_HEIGHT = 360

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

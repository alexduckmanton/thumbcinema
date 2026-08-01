/**
 * The one thing the site still asks about the device it's on: is this a touch screen.
 *
 * It used to ask two. The 2013 server ran Mobile_Detect.php and set
 * `$GLOBALS['isMobile']`, and phones were turned away from /create outright — the
 * canvas was a fixed 640px and there was nowhere to put the tools. Both of those are
 * fixed rather than detected now: the canvas is scaled to whatever it's given (see
 * `Scene.pinCoordinates`) and the tools sit along the bottom of the window, so there
 * is no longer a class of device the drawing tool is kept away from.
 *
 * What's left is genuinely about input rather than size — the push tool's hover dots,
 * and printing — and even that is a hint. A tablet with a keyboard is both.
 *
 * Read once at module load. It doesn't change during a page view, and reading
 * `navigator` on every render would be a lot of ceremony for a constant.
 */

const maxTouchPoints = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0)

export const isTouch: boolean =
	(typeof window !== 'undefined' && 'ontouchstart' in window) || maxTouchPoints > 0

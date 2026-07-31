/**
 * Replaces the server-side Mobile_Detect.php that used to set $GLOBALS['isMobile']
 * and $GLOBALS['isTablet'] before the page rendered. Same two questions, asked
 * client side: is this a touch device, and is it a phone — too small to draw on.
 *
 * Read once at module load. None of these change during a page view, and reading
 * `navigator` on every render would be a lot of ceremony for a constant.
 */

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
const maxTouchPoints = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0)

export const isTouch: boolean =
	(typeof window !== 'undefined' && 'ontouchstart' in window) || maxTouchPoints > 0

export const isTablet: boolean =
	/iPad/i.test(ua) ||
	(/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
	// iPadOS masquerades as desktop Safari, and is only given away by the touch points.
	(/Macintosh/i.test(ua) && maxTouchPoints > 1)

export const isPhone: boolean = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua)

/** Phones were always turned away from /create — the canvas needs a real pointer and some room. */
export const canDraw: boolean = !isPhone || isTablet

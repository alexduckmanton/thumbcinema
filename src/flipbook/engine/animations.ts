/**
 * What is left of the page animations, which is two constants and a media query.
 *
 * There used to be a table of keyframes in here — the 2013 ones, turned on their side when
 * the flipbook became a column — and a `play()` that ran them through the Web Animations
 * API, and a `freeze()` that pinned a thumbnail with `position: fixed` so a reflow could
 * happen around it. Adding a page threw the old one up the column and flew the new one in;
 * deleting one tumbled it off the side while its neighbour slid into the gap.
 *
 * **All of it is gone, and the reason is that it was choreography for a layout that no
 * longer exists.** Every one of those movements was written against a strip *positioned by
 * arithmetic*: the row stood still, the engine knew where every page was, and `freeze()`
 * could pin one to the viewport because the viewport was not going anywhere. The strip is
 * a scroll container now — the document itself — and pinning a page to the viewport while
 * the scroll moves the page under it is two things fighting over the same pixels. The
 * animations did not stop being 2013's; they stopped being *about* the thing on screen.
 *
 * What replaces them is the scroll. Adding or deleting a page changes where the page you
 * are on sits in the column, and `PageStrip` eases the scroll position to it rather than
 * cutting — one movement, of the one thing that actually moves, made of the browser's own
 * scrolling. See `scrollToPage`.
 *
 * The keyframes are in this file's history if the tool ever wants paper that moves again.
 * What would have to come with them is an answer to the frozen-page problem above, which
 * is the part that was never written.
 */

/**
 * How long the column takes to travel one page when something other than a scroll moved
 * it: a page added, a page deleted, a carried page settling.
 *
 * It was where a *thrown* page arrived — offset 0.4 of a 750ms animation — and it is kept
 * at that number because it was chosen against a hand rather than against a stopwatch: it
 * is how long a page took to cross a slot for the ten years this tool has existed.
 */
export const PAGE_TRAVEL_MS = 300

/**
 * How far it is from one page to the next: a thumbnail's height plus its gutters.
 *
 * Only the fallback. The real number is measured off `.page` and handed to the engine by
 * the strip, because the drawing is whatever size the window could spare. The reorder
 * gesture is written against it.
 */
export const DEFAULT_PAGE_STEP = 380

export function prefersReducedMotion(): boolean {
	return typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false
}

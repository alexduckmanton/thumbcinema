/**
 * What is left of the page animations, which is one media query.
 *
 * There used to be a table of keyframes in here — the 2013 ones — and a `play()` that ran
 * them through the Web Animations API, and a `freeze()` that pinned a page thumbnail with
 * `position: fixed` so a reflow could happen around it. Adding a page threw the old one out
 * of the frame and flew the new one in; deleting one tumbled it off the side while its
 * neighbour slid into the gap.
 *
 * **All of it is gone, and the reason is that it was choreography for a layout that no
 * longer exists.** Every one of those movements was written against a *strip of
 * thumbnails positioned by arithmetic*: the row stood still, the engine knew where every
 * page was, and `freeze()` could pin one to the viewport because the viewport was not
 * going anywhere. There is no strip at all now — see `docs/create-page.md`, which says
 * what went with it — so there is nothing for a page to be thrown into or slide out of.
 * The animations did not stop being 2013's; they stopped being *about* the thing on
 * screen. Turning a page is a cut, and the page bar's handle is what moves.
 *
 * The keyframes are in this file's history if the tool ever wants paper that moves again.
 * What would have to come with them is somewhere for the paper to move *to*, which is the
 * part the current layout does not have.
 */

/**
 * Whether the reader has asked for less movement.
 *
 * Two things left on this page read it: the page bar's handle, and the drawing sliding
 * home at the end of a reorder.
 */
export function prefersReducedMotion(): boolean {
	return typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false
}

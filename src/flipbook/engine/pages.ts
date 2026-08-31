/**
 * The page list, as data.
 *
 * Separate from `FlipbookEngine` because that module owns a paper.js project and
 * can't be loaded without a canvas.
 */

export interface PageState {
	/** Stable across inserts and deletes, so React keys don't reshuffle canvases. */
	readonly id: number
	/** How much is drawn on this page. The busiest page becomes the saved thumbnail. */
	readonly segments: number
}

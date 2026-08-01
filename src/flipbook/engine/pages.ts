/**
 * The page list, as data.
 *
 * Separate from `FlipbookEngine` because that module owns a paper.js project and
 * can't be loaded without a canvas — while this is arithmetic over a list, and the
 * rule it encodes is subtle enough to be worth a test.
 */

export interface PageState {
	/** Stable across inserts and deletes, so React keys don't reshuffle canvases. */
	readonly id: number
	/** How much is drawn on this page. The busiest page becomes the saved thumbnail. */
	readonly segments: number
	/**
	 * Set on a page that is falling off the screen and will be gone when it lands.
	 * It stays in the list for as long as it takes to leave, because the strip has to
	 * go on rendering it — but it is no longer one of the flipbook's pages.
	 */
	readonly leaving?: boolean
}

/**
 * How many pages the flipbook has, counting only the ones that are staying.
 *
 * Deleting the only page puts its replacement in the list before the old one has
 * finished falling, so for those 750ms `pages.length` is 2 — long enough for the
 * play buttons to flick on and the save button to fade in and out again. Anything
 * asking "is this a flipbook yet" wants this rather than the raw length.
 */
export function settledPageCount(pages: readonly PageState[]): number {
	let count = 0
	for (const page of pages) if (!page.leaving) count++
	return count
}

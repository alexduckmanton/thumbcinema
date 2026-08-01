import type { FlipbookEngine } from '../engine/FlipbookEngine'
import styles from './PageNav.module.css'

export interface PageNavProps {
	engine: FlipbookEngine
	activePage: number
	/** Settled pages — the one falling out of a delete isn't one of them yet. */
	pages: number
	/** True while a page animation is in flight, when a page change would collide. */
	busy: boolean
}

/**
 * Back a page, forward a page, and which page this is.
 *
 * Phones only. Above 730px the strip of thumbnails is showing and does all of this at
 * once — you can see the pages either side and click straight onto one — and the
 * arrow keys have always been the keyboard route. Below it the strip is hidden, and
 * hiding it is what buys the canvas the full width of the window: a filmstrip needs
 * room either side of the page to be a filmstrip, and there isn't any. So the two
 * pages you'd have seen become two buttons, which cost nothing but their own height.
 *
 * The count is the other half of the job. The strip shows you where you are in the
 * flipbook without being asked; a pair of arrows on their own would not.
 */
export function PageNav({ engine, activePage, pages, busy }: PageNavProps) {
	// The active page can briefly be past the end of the settled count — a delete
	// makes the arriving page active from the first frame and spends 750ms getting it
	// there — and "4 of 3" would be a strange thing to read on the way past.
	const current = Math.min(activePage + 1, pages)

	return (
		<div className={styles.nav}>
			<button
				type="button"
				className={styles.arrow}
				title="Previous page"
				disabled={busy || activePage <= 0}
				onClick={() => engine.previousPage()}
			>
				<span className={`${styles.chevron} ${styles.back}`} aria-hidden="true" />
				<span className="visuallyHidden">Previous page</span>
			</button>

			<p className={styles.count}>
				{current} <span className={styles.of}>of</span> {pages}
			</p>

			<button
				type="button"
				className={styles.arrow}
				title="Next page"
				disabled={busy || activePage >= pages - 1}
				onClick={() => engine.nextPage()}
			>
				<span className={`${styles.chevron} ${styles.forward}`} aria-hidden="true" />
				<span className="visuallyHidden">Next page</span>
			</button>
		</div>
	)
}

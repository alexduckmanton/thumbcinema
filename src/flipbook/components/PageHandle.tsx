import styles from './PageHandle.module.css'

export interface PageHandleProps {
	/** The pointer and keyboard handlers the drag is made of. See `usePageReorder`. */
	handleProps: {
		onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
		onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
		onLostPointerCapture: () => void
		onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
	}
	/** Which page is in hand, and how many there are. Both for what it says out loud. */
	page: number
	pages: number
	/** True while it is being carried, which is the one thing it says about itself. */
	carrying: boolean
	/** Nothing to reorder: one page, a flipbook still arriving, a page mid-animation. */
	disabled: boolean
}

/**
 * The tab on the top edge of the page: take hold of it and the drawing can be carried
 * to another place in the flipbook.
 *
 * A grip rather than a pair of arrows, because what it does is a *drag* — a page three
 * slots along is one gesture here and three presses of an arrow, and the strip either
 * side of the drawing is already showing you where the page would land. The keyboard
 * gets the arrows anyway; they are on this control rather than beside it, which is
 * where a keyboard is already standing once it has tabbed to the thing it wants to move.
 *
 * It hangs *above* the paper rather than sitting on it, and that is what keeps it free:
 * the whole of the drawing is somewhere you draw, and a control anywhere on it would be
 * a hole in the page. What it costs is nothing at all — the gap between the header and
 * the top of the sheet is the column's own padding and was empty.
 */
export function PageHandle({ handleProps, page, pages, carrying, disabled }: PageHandleProps) {
	return (
		<button
			type="button"
			className={carrying ? `${styles.handle} ${styles.carrying}` : styles.handle}
			// A press on it is a drag, never a click: there is nothing for a tap to mean,
			// and a `title` is what says so on a desktop.
			title="Drag to move this page"
			disabled={disabled}
			aria-label={`Move page ${page} of ${pages}`}
			{...handleProps}
		>
			{/* Three bars, drawn here rather than taken from the icon sheet. That sheet is
			    hand-drawn pictures of things — a pencil, an eraser, a page — and a grip is
			    not a thing; it is the same call the page bar's chevrons make. */}
			<span className={styles.grip} aria-hidden="true" />
		</button>
	)
}

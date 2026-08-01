import { useCallback, useRef, useState } from 'react'

import type { FlipbookEngine } from '../engine/FlipbookEngine'
import styles from './PageNav.module.css'

export interface PageNavProps {
	engine: FlipbookEngine
	activePage: number
	/** Settled pages — the one falling out of a delete isn't one of them yet. */
	pages: number
	/** True while the flipbook is playing, in either mode. See `.eased`. */
	playing: boolean
}

/**
 * Back a page, forward a page, and a scrubber for everything in between.
 *
 * Phones only. Above the breakpoint the strip of thumbnails is showing and does all
 * of this at once — you can see the pages either side and click straight onto one —
 * and the arrow keys have always been the keyboard route. Below it the strip is
 * hidden, and hiding it is what buys the canvas the full width of the window: a
 * filmstrip needs room either side of the page to be a filmstrip, and there isn't
 * any.
 *
 * So the pages you can't see become a bar you can drag. The handle is on a page, not
 * between pages: it follows the pointer while you're holding it and settles onto the
 * nearest of `pages` positions when you let go, the two ends included, so a two-page
 * flipbook has a handle that is either hard left or hard right and nothing in
 * between. It follows playback as well as leading it — the engine publishes every
 * page change, including the twelve a second that `play` makes and the ones
 * circleplay scrubs to, so the handle runs along on its own while a flipbook plays.
 *
 * The arrows wrap. Playback loops, so the page after the last one is page one
 * wherever else you look at this, and an arrow that greys out at the end of a
 * two-page flipbook is a dead control half the time.
 */
export function PageNav({ engine, activePage, pages, playing }: PageNavProps) {
	const track = useRef<HTMLDivElement | null>(null)
	const handle = useRef<HTMLSpanElement | null>(null)

	/** Where the pointer is holding the handle, 0–1, or null when nothing is. */
	const [held, setHeld] = useState<number | null>(null)

	// The active page can briefly be past the end of the settled count — a delete
	// makes the arriving page active from the first frame and spends 750ms getting it
	// there — and the handle mustn't shoot off the end of the bar on the way past.
	const current = Math.min(activePage, Math.max(0, pages - 1))

	/** Never refused for being at an end: the last page's next is the first. */
	const step = useCallback(
		// Guarded because the wrap is a modulo, and a flipbook with no settled pages —
		// every one of them mid-delete — would make it a NaN and hand that to the scene.
		(delta: number) => {
			if (pages > 0) engine.goToPage((current + delta + pages) % pages)
		},
		[engine, current, pages],
	)

	const scrubTo = useCallback(
		(clientX: number) => {
			const rail = track.current
			if (!rail || pages < 2) return

			const box = rail.getBoundingClientRect()
			// Measured rather than agreed with the stylesheet: the handle is the height
			// of the bar and the bar is shorter in a short window.
			const size = handle.current?.offsetWidth ?? 0

			const fraction = fractionAt(clientX - box.left, box.width, size)
			setHeld(fraction)
			engine.goToPage(pageAt(fraction, pages))
		},
		[engine, pages],
	)

	// Pointer capture rather than document-level listeners: the drag follows the
	// pointer off the end of the bar and releases cleanly wherever it ends up.
	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (pages < 2) return

		event.currentTarget.setPointerCapture(event.pointerId)
		// Taking hold of the handle is taking over from whatever was playing — not
		// least because circleplay is reading the same pointer.
		engine.pause()
		scrubTo(event.clientX)
	}

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
		scrubTo(event.clientX)
	}

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const delta =
			event.key === 'ArrowLeft' || event.key === 'ArrowDown'
				? -1
				: event.key === 'ArrowRight' || event.key === 'ArrowUp'
					? 1
					: 0
		if (!delta) return

		event.preventDefault()
		step(delta)
	}

	// Wherever the pointer is holding the handle, and back on a page as soon as it
	// isn't — which is the whole of the settle: the class below turns the transition
	// on, and the number it animates from is the one the finger left it at.
	const fraction = held ?? (pages > 1 ? current / (pages - 1) : 0)

	return (
		<div className={styles.nav}>
			<button type="button" className={styles.arrow} title="Previous page" onClick={() => step(-1)}>
				<span className={`${styles.chevron} ${styles.back}`} aria-hidden="true" />
				<span className="visuallyHidden">Previous page</span>
			</button>

			<div
				ref={track}
				className={styles.track}
				role="slider"
				tabIndex={0}
				aria-label="Page"
				aria-valuemin={1}
				aria-valuemax={pages}
				aria-valuenow={current + 1}
				// The count that used to be printed between the arrows. It is still worth
				// saying, just not worth a line of type under the drawing.
				aria-valuetext={`Page ${current + 1} of ${pages}`}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				// `lostpointercapture` rather than the pointerup/pointercancel pair: it is
				// the one event that fires however the drag ends, a system interrupt
				// included, and letting go is what has to put the handle back on a page.
				onLostPointerCapture={() => setHeld(null)}
				onKeyDown={handleKeyDown}
			>
				<span
					ref={handle}
					className={held === null && !playing ? `${styles.handle} ${styles.eased}` : styles.handle}
					style={{ '--fraction': fraction } as React.CSSProperties}
				/>
			</div>

			<button type="button" className={styles.arrow} title="Next page" onClick={() => step(1)}>
				<span className={`${styles.chevron} ${styles.forward}`} aria-hidden="true" />
				<span className="visuallyHidden">Next page</span>
			</button>
		</div>
	)
}

/**
 * How far along the bar a pointer is, 0 at the first page and 1 at the last.
 *
 * The handle travels the bar less its own width, so that at either end it sits inside
 * the bar rather than half out of it — which means the pointer is asking about the
 * handle's *centre*, and the arithmetic starts by taking half a handle off.
 */
export function fractionAt(offset: number, width: number, handle: number): number {
	const travel = width - handle
	if (travel <= 0) return 0

	return Math.min(1, Math.max(0, (offset - handle / 2) / travel))
}

/**
 * Which page that is: one of `pages` evenly spaced positions, rounded to the nearest,
 * so the last page is the right-hand end of the bar and not a handle's width short
 * of it.
 *
 * Exported with its neighbour for their test: they're the piece of this that can be
 * wrong by a page without looking wrong.
 */
export function pageAt(fraction: number, pages: number): number {
	return pages < 2 ? 0 : Math.round(fraction * (pages - 1))
}

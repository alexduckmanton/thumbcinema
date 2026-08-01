import { useCallback, useRef, useState } from 'react'

import icons from '../../styles/icons.module.css'
import type { FlipbookEngine, PlaybackMode } from '../engine/FlipbookEngine'
import styles from './PageNav.module.css'

export interface PageNavProps {
	engine: FlipbookEngine
	activePage: number
	/** Settled pages — the one falling out of a delete isn't one of them yet. */
	pages: number
	/** Which way the flipbook is playing, if it is. See `.eased`. */
	playback: PlaybackMode
}

/**
 * Back a page, forward a page, and a scrubber for everything in between.
 *
 * Phones only. The strip of thumbnails is on both layouts, but on a phone the drawing
 * takes nearly the whole window and all that shows of the pages either side is a few
 * millimetres — enough to say the flipbook carries on, nowhere near enough to reach
 * for. Above the breakpoint there is room to see them and click straight onto one, and
 * the arrow keys have always been the keyboard route.
 *
 * So the pages you can't reach become a bar you can drag. The handle is on a page, not
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
 *
 * All three live in the one bar, stacked in the order you'd reach for them: the bar
 * itself takes a press anywhere along it and sends the handle there, the arrows sit
 * over it and take their own presses back off it, and the handle is over both. Near
 * an end it covers the arrow underneath, which is the right way round — the thing
 * you are holding should not be something you can miss.
 *
 * Play and circleplay sit in a second box on the same row. They belong up here rather
 * than in the tray: everything on this row is about where you are in the flipbook and
 * everything in the tray is about what you're drawing with, and it buys the tools an
 * extra quarter of the tray. Their own buttons rather than the tray's, which is two
 * `<button>`s of duplication against reaching into another component's stylesheet to
 * undo the nudges that sit its icons on a baseline this row hasn't got.
 */
export function PageNav({ engine, activePage, pages, playback }: PageNavProps) {
	const track = useRef<HTMLDivElement | null>(null)
	const handle = useRef<HTMLSpanElement | null>(null)

	/** Where the pointer is holding the handle, 0–1, or null when nothing is. */
	const [held, setHeld] = useState<number | null>(null)

	const playing = playback !== 'none'

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

	// `held` rather than `hasPointerCapture`: it is set by the press and cleared by the
	// release, so it says the same thing about our own drag without asking the DOM
	// about a capture that a mouse merely passing over the bar never had.
	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (held === null) return
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
		<div className={styles.row}>
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
				<button
					type="button"
					className={`${styles.arrow} ${styles.back}`}
					title="Previous page"
					// Standing on the bar without being part of it: without this the press
					// would run on up to the bar behind and scrub to wherever the arrow is,
					// which is one end or the other.
					onPointerDown={stopScrub}
					onClick={() => step(-1)}
				>
					<span className={`${styles.chevron} ${styles.pointBack}`} aria-hidden="true" />
					<span className="visuallyHidden">Previous page</span>
				</button>

				<button
					type="button"
					className={`${styles.arrow} ${styles.forward}`}
					title="Next page"
					onPointerDown={stopScrub}
					onClick={() => step(1)}
				>
					<span className={`${styles.chevron} ${styles.pointForward}`} aria-hidden="true" />
					<span className="visuallyHidden">Next page</span>
				</button>

				<span
					ref={handle}
					className={held === null && !playing ? `${styles.handle} ${styles.eased}` : styles.handle}
					style={{ '--fraction': fraction } as React.CSSProperties}
				/>
			</div>

			<div className={styles.keys}>
				<button
					type="button"
					className={styles.key}
					title={playback === 'circleplay' ? 'Stop circleplay' : 'Circleplay'}
					aria-pressed={playback === 'circleplay'}
					disabled={pages < 2}
					onClick={() => engine.toggleCircleplay()}
				>
					<span
						className={playback === 'circleplay' ? icons.pause : icons.circleplay}
						aria-hidden="true"
					/>
					<span className="visuallyHidden">Circleplay</span>
				</button>

				<button
					type="button"
					className={styles.key}
					title={playback === 'play' ? 'Pause' : 'Play'}
					aria-pressed={playback === 'play'}
					disabled={pages < 2}
					onClick={() => engine.togglePlay()}
				>
					<span className={playback === 'play' ? icons.pause : icons.play} aria-hidden="true" />
					<span className="visuallyHidden">{playback === 'play' ? 'Pause' : 'Play'}</span>
				</button>
			</div>
		</div>
	)
}

/** Module scope: it closes over nothing, and the arrows get one each. */
function stopScrub(event: React.PointerEvent<HTMLButtonElement>) {
	event.stopPropagation()
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

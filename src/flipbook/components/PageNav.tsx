import { useCallback, useRef, useState } from 'react'

import type { FlipbookEngine, PlaybackMode } from '../engine/FlipbookEngine'
import styles from './PageNav.module.css'

export interface PageNavProps {
	engine: FlipbookEngine
	activePage: number
	/** Settled pages — the one falling out of a delete isn't one of them yet. */
	pages: number
	/** Which way the flipbook is playing, if it is. See `.eased`. */
	playback: PlaybackMode
	/** True while the bar is being dragged, for whoever else has to stop easing. */
	onScrubbing: (scrubbing: boolean) => void
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
 * And a tap on the handle plays. It is the one control on the phone layout that
 * starts and stops playback — the tray's play and circleplay buttons are hidden down
 * there, because six controls is what a phone's width holds — so the thing you take
 * hold of to move through the flipbook by hand is also the thing you let go of to
 * have it moved for you. A press on the handle therefore waits: it is a tap until it
 * has travelled `TAP_SLOP`, and a drag from then on.
 */
export function PageNav({ engine, activePage, pages, playback, onScrubbing }: PageNavProps) {
	const track = useRef<HTMLDivElement | null>(null)
	const handle = useRef<HTMLSpanElement | null>(null)

	/** Where the pointer is holding the handle, 0–1, or null when nothing is. */
	const [held, setHeld] = useState<number | null>(null)

	/**
	 * The press in progress, if there is one: where it started, and whether it is
	 * still a tap. A ref rather than state — every handler that reads it was called by
	 * the press itself, and a render in between would only be for our own benefit.
	 */
	const press = useRef<Press | null>(null)

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
			if (pages < 1) return

			// Turning a page by hand takes over from playback, exactly as taking hold of
			// the handle does — otherwise the page you asked for is showing for 83ms and
			// then the flipbook carries on from wherever it had got to.
			engine.pause()
			engine.goToPage((current + delta + pages) % pages)
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
		press.current = {
			x: event.clientX,
			// Only a press that lands on the handle is a candidate for a tap. Anywhere
			// else along the bar means "that page", and means it immediately.
			tap: handle.current?.contains(event.target as Node) ?? false,
		}
		if (press.current.tap) return

		// Taking hold of the bar is taking over from whatever was playing — not least
		// because circleplay is reading the same pointer.
		engine.pause()
		onScrubbing(true)
		scrubTo(event.clientX)
	}

	// `press` rather than `hasPointerCapture`: it is set by the press and cleared by the
	// release, so it says the same thing about our own drag without asking the DOM
	// about a capture that a mouse merely passing over the bar never had.
	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const current = press.current
		if (!current) return

		// A tap that has travelled far enough is a drag, and pays the drag's opening
		// price at the moment it becomes one rather than on the way in.
		if (current.tap) {
			if (Math.abs(event.clientX - current.x) < TAP_SLOP) return

			current.tap = false
			engine.pause()
			onScrubbing(true)
		}

		scrubTo(event.clientX)
	}

	// Letting go of a press that never moved: play, or stop playing. Deferred to here
	// rather than done on the way in, because a press that turns out to be a drag has
	// to be able to start from a playing flipbook without having toggled it first.
	const handleRelease = () => {
		const finished = press.current
		press.current = null
		setHeld(null)
		onScrubbing(false)

		if (finished?.tap) engine.togglePlay()
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
	//
	// A flipbook of one page is at its last page as much as its first, and the handle
	// sits at the far end: the bar is the length of the drawing, and one at the near
	// end reads as a flipbook you are at the start of and have the rest of still to
	// come. The first page you add then moves it, rather than the second.
	const fraction = held ?? (pages > 1 ? current / (pages - 1) : 1)

	return (
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
			onLostPointerCapture={handleRelease}
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
	)
}

/** A press on the bar, from the moment it lands to the moment it lets go. */
interface Press {
	/** Where it landed, which is what a drag is measured from. */
	x: number
	/** Still a tap: it started on the handle and hasn't gone anywhere yet. */
	tap: boolean
}

/**
 * How far a press can travel and still count as a tap.
 *
 * Small, because the handle is 48px across and everything either side of it is a
 * page: a finger that has genuinely set off is past this in the first frame, and one
 * that is only rolling on its own contact patch hasn't asked for anything.
 */
const TAP_SLOP = 4

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

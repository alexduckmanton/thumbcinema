import { useCallback, useRef, useState } from 'react'

import { FPS } from '../engine/constants'
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
}

/**
 * Back a page, forward a page, and a scrubber for everything in between.
 *
 * On both layouts now. It was the phone's answer to a strip of thumbnails you can see
 * but not reach — the drawing takes nearly the whole window down there and all that
 * shows of the pages either side is a few millimetres — and it was hidden on a desktop
 * on the grounds that up here you can click straight onto a thumbnail. You can, and it
 * is still the fastest way to a particular page. What the strip cannot do is show a
 * flipbook *playing*: it is a row of pages that happens to change which one is behind
 * the canvas, and the handle running along the bar is the only thing on either page
 * that says how far through you are while it moves.
 *
 * The handle is on a page, not between pages: it follows the pointer while you're
 * holding it and settles onto the nearest of `pages` positions when you let go, the two
 * ends included, so a two-page flipbook has a handle that is either hard left or hard
 * right and nothing in between. It follows playback as well as leading it — the engine
 * publishes every page change, including the twelve a second that `play` makes.
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
 * And a tap on the handle plays. It is the only thing that starts and stops playback on
 * either page — the tray's play and circleplay buttons are gone, one hidden and one
 * deleted — so the thing you take hold of to move through the flipbook by hand is also
 * the thing you let go of to have it moved for you. A press on the handle therefore
 * waits: it is a tap until it has travelled `TAP_SLOP`, and a drag from then on.
 */
export function PageNav({ engine, activePage, pages, playback }: PageNavProps) {
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
			// else along the bar means "that page", and means it immediately. Asked of
			// the element rather than of a ref, because crossing the seam there are two
			// copies on the bar and the one arriving at the near door is as much the
			// handle as the one leaving by the far one.
			tap: (event.target as Element).hasAttribute(HANDLE),
		}
		if (press.current.tap) return

		// Taking hold of the bar is taking over from whatever was playing.
		engine.pause()
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

	/*
	 * Where the handle stands when nothing is driving it: on the page.
	 *
	 * A flipbook of one page is at its last page as much as its first, and the handle
	 * sits at the far end: the bar is the length of the drawing, and one at the near
	 * end reads as a flipbook you are at the start of and have the rest of still to
	 * come. The first page you add then moves it, rather than the second.
	 */
	const rest = pages > 1 ? current / (pages - 1) : 1

	/*
	 * A flipbook playing itself sweeps the handle rather than standing it on each page
	 * in turn, at every length.
	 *
	 * The step is the flipbook's own: a lap of the bar takes as many frames as a lap of
	 * the flipbook, of which `TRANSIT_STEPS` are spent in the tunnel — so the two go
	 * round together and the handle arrives back at the near end as page one comes up.
	 * The floor is what stops a short one flickering; see `MIN_CROSSING_FRAMES`.
	 */
	const sweeping = playback === 'play' && pages > 1
	const { at, transit, lap, snap } = usePlaybackSweep(
		current,
		rest,
		sweeping,
		1 / Math.max(pages - TRANSIT_STEPS, MIN_CROSSING_FRAMES),
	)

	// Wherever the pointer is holding the handle, and back on the page as soon as it
	// isn't — which is the whole of the settle: the class below turns the transition
	// on, and the number it animates from is the one the finger left it at.
	const fraction = held ?? at

	/*
	 * Three ways of getting from one position to the next, and one of them is not
	 * getting there at all. `eased` is the settle onto a page after a drag; `stepped`
	 * is the sweep, which crosses a frame's worth of bar in a frame so that the steps
	 * join up into a slide; and a sweep cut short inside the tunnel is bare, because
	 * the handle is off the end of the bar and has no business sliding back from there.
	 */
	const moving = [
		held === null && !playing && !snap ? styles.eased : '',
		sweeping && !snap ? styles.stepped : '',
	]
		.filter(Boolean)
		.join(' ')

	// One handle at rest; three while a sweep is running — the one on the bar, the one
	// behind it waiting to come in, and the one in front on its way out. Keyed by which
	// lap they belong to, which is what makes the handover free. See `copies`.
	const copies = sweeping ? [lap - 1, lap, lap + 1] : [lap]

	return (
		<div
			ref={track}
			// The arrows go while it plays; see `.playing`.
			className={playing ? `${styles.track} ${styles.playing}` : styles.track}
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
			style={
				{
					'--fraction': fraction,
					'--over': transit / TRANSIT_STEPS,
					// The engine's own frame, so the handle can't fall out of step with the
					// flipbook it is following.
					'--frame': `${1000 / FPS}ms`,
				} as React.CSSProperties
			}
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

			{/*
			 * The handle, and the two of it either side that make the seam free.
			 *
			 * Each copy is one bar-length behind the last, so only the middle one is ever
			 * on the bar except in the tunnel, where the middle one is leaving by the far
			 * door as the one behind arrives at the near one. The third is a lap in front
			 * and never visible at all — it exists so that the copy going out has
			 * somewhere to go on the frame it goes, rather than being taken off the bar
			 * while a sliver of it is still showing.
			 *
			 * Keyed by the lap they belong to, which is the whole trick: when the lap
			 * turns over, every copy simply inherits the job of the one in front of it
			 * and moves a step to do it. Nothing is repositioned, so nothing has to be
			 * hidden while it is — the copy that mounts is a lap behind the near door and
			 * the one that unmounts is a lap past the far one.
			 */}
			{copies.map((copy) => (
				<span
					key={copy}
					// The one on the bar is the one to measure; the others are the same size.
					ref={copy === lap ? handle : undefined}
					className={`${styles.handle} ${moving}`}
					style={{ '--lap': lap - copy } as React.CSSProperties}
					{...{ [HANDLE]: '' }}
				/>
			))}
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

/**
 * What marks a span as one of the handle's copies, for a press to recognise.
 *
 * An attribute rather than the class, because there are three of them and only one is
 * held in a ref — and rather than the stylesheet's name, because that one is scoped and
 * so is only a string as far as the compiler is concerned.
 */
const HANDLE = 'data-handle'

/** Module scope: it closes over nothing, and the arrows get one each. */
function stopScrub(event: React.PointerEvent<HTMLButtonElement>) {
	event.stopPropagation()
}

/**
 * The fewest frames the handle will take to cross the bar, and so the fastest it will
 * ever go: 23 of them at twelve frames a second is a hair under two seconds.
 *
 * A two-page flipbook plays twelve frames a second, and a handle standing on the page
 * went end to end six times a second — not motion at all, a flicker at the two ends of
 * the bar, and the shorter the flipbook the worse it got. So while a flipbook plays,
 * the bar stops being a page indicator and becomes a rate: the handle takes one step
 * per frame the engine turns and goes round at the end, and below this many pages the
 * flipbook simply laps underneath it however many times it likes.
 *
 * Above it the two are locked together — a lap of the bar is `pages` frames, the tunnel
 * included — so the handle arrives back at the near end exactly as page one comes up.
 * That is what makes the floor a floor rather than a threshold: it binds under 26 pages
 * and does nothing at all above, and the sweep either side of that is the same sweep.
 *
 * What it costs is that the handle no longer says which page is showing during playback
 * — of a flipbook whose every page is showing twelve times a second, which is not a
 * thing anybody was reading off it. `aria-valuenow` is still the real page throughout.
 */
const MIN_CROSSING_FRAMES = 23

/**
 * How many frames the handle spends in the tunnel at the end of a lap.
 *
 * The handle's travel is the bar less its own width, so that at either end it sits
 * inside the bar. Past the far end there is exactly one handle-width of bar left, and
 * the tunnel is that: the handle carries on into it and out of sight while the copy a
 * lap behind arrives at the near end at the same rate. What you see is one circle going
 * round rather than a circle being thrown backwards, which is what the flipbook has just
 * done too.
 *
 * Three, because that makes the two speeds very nearly the same one: a handle-width in
 * three frames is 16px on a phone against the 15px a page-step covers, and 12 against
 * 10 in a short window. Exact would mean measuring the bar to find out how many of its
 * steps go into a handle — a ResizeObserver and a number that changes under you — for
 * a difference of one pixel a frame over a quarter of a second.
 *
 * A long flipbook takes smaller steps, so the tunnel is faster than the bar it just
 * came down rather than a fifth quicker — three times at 54 pages. Fixing that would
 * mean spending frames in proportion to the handle's share of the bar, which is the
 * measurement above that isn't worth taking; what it buys is a quarter of a second, at
 * the one moment in the lap when the handle is half eaten by a doorway.
 *
 * It is three frames *of* the lap rather than three on top of it, which is why the step
 * above divides by `pages - TRANSIT_STEPS`: the handle's lap and the flipbook's are the
 * same length, so the two can't drift apart over a minute of playback.
 *
 * The last of the three is the lap turning over, so only the first two are positions the
 * handle stands in. Counted in whole steps rather than accumulated as a fraction: three
 * thirds of a lap add up to a hair under a whole one, and the frame that buys would be a
 * frame the handle didn't move on.
 */
const TRANSIT_STEPS = 3

/**
 * Where the handle stands: `at` along its travel, 0–1, and then `transit` steps into the
 * tunnel past the end of it. `lap` is which time round, and is what the copies are keyed
 * by. `snap` is a sweep cut short, which is the only jump left in this.
 */
interface Sweep {
	page: number
	at: number
	transit: number
	lap: number
	snap: boolean
}

/**
 * Where the page puts the handle, or `step` further along than last frame if a sweep is
 * running.
 *
 * Kept as a fraction rather than as a stop index so that starting a sweep needs no
 * seeding at all — the handle carries on from wherever the page had it, and the two
 * scales never have to be converted between. Off a stop by a fraction of a pixel after
 * a few laps, which is a number nobody is reading.
 *
 * State worked out during render rather than in an effect, the same as the strip's
 * snap-on-removal: the engine publishes a page change and this is a fact about that
 * render, not something to go and do afterwards. `page` is what the last answer was
 * for, so a re-render that isn't a page turn — a resize, a tool change — doesn't
 * advance the sweep.
 */
function usePlaybackSweep(page: number, rest: number, sweeping: boolean, step: number): Sweep {
	const [seen, setSeen] = useState<Sweep>({ page, at: rest, transit: 0, lap: 0, snap: false })

	const next = sweeping
		? seen.page === page
			? seen
			: advance(seen, page, step)
		: settle(seen, page, rest)

	if (next !== seen) setSeen(next)

	return next
}

/**
 * Not sweeping, so the handle is on the page — and that is where the next sweep picks
 * up from, which is the whole of the seeding.
 *
 * Bare if the sweep was cut short inside the tunnel, where the handle is off the end of
 * the bar: easing back onto a page from there is a swoop in from the right, which is not
 * what pausing a flipbook looks like. That has to survive being asked twice — setting
 * state during render re-runs the render before it commits, so an answer that reads its
 * own last answer has to give the same one both times or the DOM never sees the first.
 */
function settle(seen: Sweep, page: number, rest: number): Sweep {
	const landed = { page, at: rest, transit: 0, lap: seen.lap, snap: false }

	if (seen.transit > 0) return { ...landed, snap: true }

	// Landed. Hold still — including whether that landing was a jump — until something
	// actually moves, which is the next page turn.
	return seen.page === page && seen.at === rest ? seen : landed
}

/** One frame along the lap: down the bar, then into the tunnel, then round. */
function advance(seen: Sweep, page: number, step: number): Sweep {
	if (seen.at >= 1) {
		const transit = seen.transit + 1

		// Round. Nothing is repositioned to do it: every copy takes on the job of the one
		// a lap in front of it, which is a step's worth of movement each and no more, so
		// this frame slides exactly like the others. The copy arriving at the near door
		// is the one that carries on down the bar, and it has been sliding towards it for
		// three frames already.
		return transit < TRANSIT_STEPS
			? { page, at: 1, transit, lap: seen.lap, snap: false }
			: { page, at: 0, transit: 0, lap: seen.lap + 1, snap: false }
	}

	const at = seen.at + step

	// Landing on the end rather than stepping past it: whatever is left of a step when
	// the end comes up is spent getting there, and the tunnel starts from the end of the
	// bar. Which also absorbs the float error in adding a twenty-third twenty-three
	// times, and is why a sweep can't stall a step short of the end.
	return { page, at: at < 1 - step / 2 ? at : 1, transit: 0, lap: seen.lap, snap: false }
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

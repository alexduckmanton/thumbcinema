import { useEffect, useRef, useState } from 'react'

import { prefersReducedMotion } from './engine/animations'
import type { FlipbookEngine } from './engine/FlipbookEngine'
import {
	clampDrag,
	pageShift,
	type Reorder,
	SETTLE_MS,
	SLIDE_DWELL_MS,
	slideDirection,
	slideInterval,
	targetIndex,
} from './engine/reorder'

/**
 * Dragging the page you are drawing on to another place in the flipbook.
 *
 * The gesture is a handle above the paper, and what it moves is the *drawing*: the
 * canvas follows the pointer, the thumbnails either side step aside to open a gap, and
 * letting go slides the whole flipbook home around it. Nothing in the scene moves until
 * the very end — see `FlipbookEngine.movePage` — so a drag that wanders across the book
 * and comes back costs nothing at all.
 *
 * **Hold the page out to one side and the flipbook runs underneath it.** A drag is 1:1
 * with the pointer, and on a phone the pitch is nearly the width of the window — so on
 * its own a gesture can reach exactly one slot in either direction. What reaches the
 * rest of the flipbook is holding: after `SLIDE_DWELL_MS` the row starts advancing a
 * page at a time, faster the longer it is held, and the page stays exactly where your
 * hand is while the book goes by. See `anchor` on `Reorder`, which is the whole
 * mechanism — the row's alignment and the destination advance *together*, so the gap
 * stays under the page and being held out to one side goes on being true.
 *
 * **How the handover at the end is invisible**, which is the part worth understanding
 * before touching any of it. Throughout the gesture the strip is anchored on the slot
 * the page is held out *from*, and the carried page is drawn away from it by a
 * transform. At the release the anchor moves to `to` and the drawing's own offset goes
 * back to zero: those two are the same distance in opposite directions, so what you see
 * is the flipbook and the page it now contains sliding home as one thing. By the time
 * `movePage` is called every element is already standing exactly where the reordered
 * flipbook puts it, and the commit is a re-render that moves nothing — which is why the
 * transitions are only switched on while a reorder is in flight, so the frame that swaps
 * a transform for a slot has nothing to animate.
 *
 * **Pixels do not go through React.** A pointer moves a hundred times a second and each
 * move changes one number; the drawing's offset is written straight onto the element as
 * `--drag`, and React is told only when a *slot* changes, which is a handful of times in
 * a drag. That is the same bargain the gallery's scrub makes.
 */
export function usePageReorder(
	engine: FlipbookEngine | null,
	options: { activePage: number; pages: number; enabled: boolean },
) {
	const { activePage, pages, enabled } = options

	/** `.book` — the sheet of paper, which is the canvas and the handle above it. */
	const bookRef = useRef<HTMLDivElement | null>(null)
	const [reorder, setReorder] = useState<Reorder | null>(null)

	/** The drag in flight. A ref: every handler that reads it was called by the drag. */
	const drag = useRef<Drag | null>(null)
	/** The two timers, which are never both running: the run, and the landing. */
	const running = useRef<number | null>(null)
	const settling = useRef<number | null>(null)

	/*
	 * The drawing slides home, and it has to happen *after* the render that turns the
	 * transition on — the class and the offset are set from two different places, and a
	 * `--drag` written before the element knows it is settling is the one instant snap
	 * this whole mechanism exists to avoid.
	 */
	const isSettling = reorder?.settling ?? false
	useEffect(() => {
		if (isSettling) bookRef.current?.style.setProperty('--drag', '0px')
	}, [isSettling])

	// A gesture abandoned by the page going away — a route change, a save — must not
	// leave a timer running against an engine that has been torn down.
	useEffect(() => {
		return () => {
			if (running.current !== null) window.clearTimeout(running.current)
			if (settling.current !== null) window.clearTimeout(settling.current)
		}
	}, [])

	function finish(from: number, to: number): void {
		settling.current = null
		bookRef.current?.style.removeProperty('--drag')

		// Both updates land in one render — React batches inside a timeout — which is
		// what makes the commit a frame in which nothing moves rather than a frame of
		// the reordered flipbook drawn with the drag's transforms still on it.
		engine?.movePage(from, to)
		setReorder(null)
	}

	function settle(from: number, to: number): void {
		// `slide: null` is the run being put away as well as stopped: from this frame the
		// row eases home over `--settle` instead of running linearly, which retargets
		// whatever was in flight rather than cutting it off.
		setReorder({ from, anchor: to, to, settling: true, slide: null })
		settling.current = window.setTimeout(
			() => finish(from, to),
			prefersReducedMotion() ? 0 : SETTLE_MS,
		)
	}

	/**
	 * Everything that follows from where the pointer is: the drawing's offset, the slot
	 * the page would land in, and whether the flipbook should be running underneath it.
	 *
	 * Called by the pointer and by each page of the run, because both change the answer —
	 * one moves the page and the other moves the book, and all of this is measured
	 * between the two.
	 */
	function track(held: Drag, moved = false): void {
		const offset = clampDrag(held.at - held.x, held.anchor, held.pages, held.step)
		bookRef.current?.style.setProperty('--drag', `${offset}px`)

		const to = targetIndex(offset, held.anchor, held.pages, held.step)
		const changed = moved || to !== held.to
		held.to = to
		held.offset = offset

		if (slideDirection(offset, to, held.pages, held.step) === 0) stopRunning(held)
		else if (running.current === null) {
			// The dwell, and only the first one: everything after it is the ramp.
			held.slid = 0
			running.current = window.setTimeout(() => advance(held), SLIDE_DWELL_MS)
		}

		if (changed) {
			setReorder({ from: held.from, anchor: held.anchor, to, settling: false, slide: held.slide })
		}
	}

	/**
	 * One page of the flipbook passing under the page being held.
	 *
	 * All it moves is the anchor. The destination follows it — `to` is measured from the
	 * anchor — so the gap stays under the drawing and the drawing stays under your hand,
	 * and what travels is the book.
	 *
	 * The next page is booked before this one is drawn, and the interval it is booked at
	 * is also the duration the row is given to cover this one: steps that each take
	 * exactly as long as the gap between them join into one continuous glide rather than
	 * reading as a series of hops. Same trick the page bar's sweep uses.
	 */
	function advance(held: Drag): void {
		const direction = slideDirection(held.offset, held.to, held.pages, held.step)
		if (direction === 0) {
			stopRunning(held)
			return
		}

		held.anchor += direction
		held.slide = slideInterval(held.slid)
		held.slid++

		running.current = window.setTimeout(() => advance(held), held.slide)
		track(held, true)
	}

	/**
	 * Stops the run: the page is back over its own slot, or the flipbook has nowhere left
	 * to go.
	 *
	 * `held.slide` is deliberately left where it is, so `.sliding` stays on the strip for
	 * the rest of the gesture once a run has happened. Taking the class off would take
	 * its `transition` with it, and a transition removed mid-flight does not stop — it
	 * finishes instantly, which is the last page of the run snapping into place. Nothing
	 * moves the row while the run is stopped, so a rule with nothing to animate costs
	 * nothing, and the settle clears it in the same render that it wants the other curve.
	 */
	function stopRunning(held: Drag): void {
		if (running.current !== null) window.clearTimeout(running.current)
		running.current = null
		held.slid = 0
	}

	const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
		if (!engine || !enabled) return
		if (drag.current || settling.current !== null) return

		const pitch = engine.pageStep
		if (pitch <= 0 || pages < 2) return
		if (!engine.beginReorder()) return

		// Capture rather than document listeners, as the page bar does: the drag runs off
		// the end of the flipbook in both directions and has to release wherever it ends.
		event.currentTarget.setPointerCapture(event.pointerId)

		const from = activePage
		drag.current = {
			pointer: event.pointerId,
			x: event.clientX,
			at: event.clientX,
			from,
			anchor: from,
			to: from,
			offset: 0,
			pages,
			step: pitch,
			slid: 0,
			slide: null,
		}
		setReorder({ from, anchor: from, to: from, settling: false, slide: null })
	}

	const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
		const held = drag.current
		if (!held || event.pointerId !== held.pointer) return

		held.at = event.clientX
		track(held)
	}

	// `lostpointercapture` rather than the up/cancel pair: it is the one event that
	// fires however the drag ends, a system interrupt included.
	const onLostPointerCapture = () => {
		const held = drag.current
		if (!held) return

		drag.current = null
		stopRunning(held)
		settle(held.from, held.to)
	}

	/**
	 * The keyboard's way in, and the same settle.
	 *
	 * A page moved by a key press has no drag behind it, so the drawing never leaves the
	 * middle of the column — what moves is the page it swaps with, travelling past the
	 * canvas from one side to the other. That is the same movement a released drag makes
	 * and it is made by the same code; only the starting offset differs. Held down, the
	 * key's own repeat carries the page along a page at a time, which is the keyboard's
	 * version of holding it out to one side.
	 *
	 * The arrow keys are also the document's page-turn shortcut. Propagation is stopped
	 * rather than relied on to be harmless: the engine is `busy` from the moment the
	 * handle answers, so the shortcut would be refused anyway, but a control that quietly
	 * depends on being refused elsewhere is one that breaks when the elsewhere changes.
	 */
	const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
		if (!engine || !enabled) return
		if (drag.current || settling.current !== null) return

		const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
		if (!delta) return

		const to = activePage + delta
		if (to < 0 || to >= pages) return

		event.preventDefault()
		event.stopPropagation()

		if (!engine.beginReorder()) return
		settle(activePage, to)
	}

	return {
		reorder,
		bookRef,
		/** What every page in the strip has to be told: where to stand, and for how long. */
		shiftFor: (index: number) =>
			reorder ? pageShift(index, reorder.from, reorder.to, engine?.pageStep ?? 0) : 0,
		handleProps: { onPointerDown, onPointerMove, onLostPointerCapture, onKeyDown },
	}
}

interface Drag {
	/** Which pointer opened it, so a second one landing can't steer it. */
	pointer: number
	/** Where it landed, and where it is now. The offset is the difference. */
	x: number
	at: number
	from: number
	/** See `Reorder`. The run advances this; the pointer never does. */
	anchor: number
	to: number
	/** How far the page is currently held from the anchor, clamped. What the run reads. */
	offset: number
	/** Both read once, at the press: the flipbook can't change shape mid-gesture. */
	pages: number
	step: number
	/** How many pages this hold has already run through. Drives the ramp. */
	slid: number
	slide: number | null
}

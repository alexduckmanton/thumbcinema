import { useCallback, useEffect, useRef, useState } from 'react'

import { prefersReducedMotion } from './engine/animations'
import type { FlipbookEngine } from './engine/FlipbookEngine'
import { clampDrag, pageShift, type Reorder, SETTLE_MS, targetIndex } from './engine/reorder'

/**
 * Dragging the page you are drawing on to another place in the flipbook.
 *
 * The gesture is a handle above the paper, and what it moves is the *drawing*: the
 * canvas follows the pointer, the thumbnails either side step aside to open a gap, and
 * letting go slides the whole flipbook home around it. Nothing in the scene moves until
 * the very end — see `FlipbookEngine.movePage` — so a drag that wanders across the book
 * and comes back costs nothing at all.
 *
 * **How the handover at the end is invisible**, which is the part worth understanding
 * before touching any of it. Throughout the gesture the strip is anchored on `from`, the
 * slot the page came out of, and the carried page is drawn away from it by a transform.
 * At the release the anchor moves to `to` and the drawing's own offset goes back to
 * zero: those two are the same distance in opposite directions, so what you see is the
 * flipbook and the page it now contains sliding home as one thing. By the time
 * `movePage` is called every element is already standing exactly where the reordered
 * flipbook puts it, and the commit is a re-render that moves nothing — which is why the
 * transitions are only switched on while a reorder is in flight, so the frame that
 * swaps a transform for a slot has nothing to animate.
 *
 * **Pixels do not go through React.** A pointer moves a hundred times a second and each
 * move changes one number; the drawing's offset is written straight onto the element as
 * `--drag`, and React is told only when the *slot* changes, which is a handful of times
 * in a drag. That is the same bargain the gallery's scrub makes.
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
	// leave the engine holding a page it will never be told to put down.
	useEffect(() => {
		return () => {
			if (settling.current !== null) window.clearTimeout(settling.current)
		}
	}, [])

	const finish = useCallback(
		(from: number, to: number) => {
			settling.current = null
			bookRef.current?.style.removeProperty('--drag')

			// Both updates land in one render — React batches inside a timeout — which is
			// what makes the commit a frame in which nothing moves rather than a frame of
			// the reordered flipbook drawn with the drag's transforms still on it.
			engine?.movePage(from, to)
			setReorder(null)
		},
		[engine],
	)

	const settle = useCallback(
		(from: number, to: number) => {
			setReorder({ from, to, settling: true })
			settling.current = window.setTimeout(
				() => finish(from, to),
				prefersReducedMotion() ? 0 : SETTLE_MS,
			)
		},
		[finish],
	)

	const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
		if (!engine || !enabled) return
		if (drag.current || settling.current !== null) return

		const step = engine.pageStep
		if (step <= 0 || pages < 2) return
		if (!engine.beginReorder()) return

		// Capture rather than document listeners, as the page bar does: the drag runs off
		// the end of the flipbook in both directions and has to release wherever it ends.
		event.currentTarget.setPointerCapture(event.pointerId)

		const from = activePage
		drag.current = { pointer: event.pointerId, x: event.clientX, from, to: from, pages, step }
		setReorder({ from, to: from, settling: false })
	}

	const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
		const held = drag.current
		if (!held || event.pointerId !== held.pointer) return

		const offset = clampDrag(event.clientX - held.x, held.from, held.pages, held.step)
		bookRef.current?.style.setProperty('--drag', `${offset}px`)

		const to = targetIndex(offset, held.from, held.pages, held.step)
		if (to === held.to) return

		held.to = to
		setReorder((current) => (current ? { ...current, to } : current))
	}

	// `lostpointercapture` rather than the up/cancel pair: it is the one event that
	// fires however the drag ends, a system interrupt included.
	const onLostPointerCapture = () => {
		const held = drag.current
		if (!held) return

		drag.current = null
		settle(held.from, held.to)
	}

	/**
	 * The keyboard's way in, and the same settle.
	 *
	 * A page moved by a key press has no drag behind it, so the drawing never leaves the
	 * middle of the column — what moves is the page it swaps with, travelling past the
	 * canvas from one side to the other. That is the same movement a released drag makes
	 * and it is made by the same code; only the starting offset differs.
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
	/** Where it landed, which is what the offset is measured from. */
	x: number
	from: number
	to: number
	/** Both read once, at the press: the flipbook can't change shape mid-gesture. */
	pages: number
	step: number
}

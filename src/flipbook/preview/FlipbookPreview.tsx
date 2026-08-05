import { useEffect, useRef, useState } from 'react'

import { FPS } from '../engine/constants'
import { frameAt } from './artwork'
import { peek, retain, type PreviewSource } from './cache'
import { drawPage, sizeCanvas } from './render'
import styles from './FlipbookPreview.module.css'

/**
 * Re-exported so the gallery can start a download before it has decided to show one.
 *
 * The gallery reaches this module through a single lazy `import()` — see `loadPreview`
 * — and importing `cache.ts` directly to get at this would put the whole preview chunk,
 * `engine/formats.ts` and all, back into the entry bundle. One line here keeps that
 * split intact and gives the finger somewhere to knock.
 */
export { prefetch } from './cache'

export interface FlipbookPreviewProps {
	source: PreviewSource
	/**
	 * Where the pointer was when it arrived, in client coordinates.
	 *
	 * Without it a card entered and then held still shows page one until the pointer
	 * moves, which reads as the scrub being broken rather than as the flipbook having
	 * started at the beginning. Coming in over the middle of a card should show the
	 * middle of the flipbook, and this is the only way to know that on the first frame.
	 */
	originX: number
	/**
	 * Run the flipbook rather than follow the pointer.
	 *
	 * What the play button in the card's corner turns on, and the reason it exists: a
	 * finger can scrub a card but it cannot hover one, so without this there is no way
	 * to simply *watch* a flipbook without also covering it up.
	 */
	playing?: boolean
}

/**
 * A flipbook playing under the pointer, on the card it belongs to.
 *
 * One of these exists at a time — the gallery mounts it into whichever card is
 * hovered — so this component *is* the "one canvas" the grid gets, and everything
 * expensive underneath it is shared: one copy of the renderer, one cache of parsed
 * flipbooks, and no paper.js anywhere on the page.
 *
 * Nothing about the scrub goes through React. The pointer moves sixty to a hundred
 * and twenty times a second and each move changes one number and, at most, the
 * pixels in a canvas — neither of which is a thing to re-render a grid of cards for.
 * React is told twice in this component's whole life: once when the first frame has
 * been painted, so the canvas can fade up over the still thumbnail underneath it, and
 * once per slice of the flipbook arriving, which is the cache asking to be redrawn.
 */
export function FlipbookPreview({ source, originX, playing = false }: FlipbookPreviewProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [painted, setPainted] = useState(false)

	/** Which frame playback is on. Only read while `playing`. */
	const playhead = useRef(0)

	/**
	 * Where along the card the pointer is, 0 to 1, and what was last drawn from it.
	 *
	 * A ref rather than state on purpose — see the note above the component. `drawn`
	 * holds the page object rather than its index, because the two ways this redraws
	 * are the pointer moving and a page *appearing*, and the second changes what
	 * index 7 is without changing the number 7.
	 */
	const pointer = useRef({ fraction: 0, drawn: null as unknown, resized: true })

	/**
	 * How the cache asks for a redraw, once the effect below has something to draw on.
	 *
	 * A ref because the two effects want each other: the one that holds the flipbook
	 * has to hand the cache a listener the moment it retains, and what that listener
	 * has to do is schedule a frame — which is the *other* effect's business, and
	 * doesn't exist yet when the first one runs. What the cache reports is never
	 * anything but "there is more of it now", so a redraw is the whole response.
	 *
	 * This was a `useReducer` bump for a render at first, which is the obvious way to
	 * do it and is silently wrong: nothing in the paint reads React state, so a render
	 * changed nothing and the flipbook arrived to a canvas that never drew it. The card
	 * sat there showing its thumbnail, which is exactly what it does while loading.
	 */
	const repaint = useRef<() => void>(() => {})

	// Hold the flipbook for exactly as long as this card is under the pointer. The
	// release is what abandons a download nobody is waiting for any more.
	//
	// biome-ignore lint/correctness/useExhaustiveDependencies: the id is the identity of the source; the object is a fresh literal on every render.
	useEffect(() => retain(source, () => repaint.current()), [source.id])

	// The scrub, and the paint. Both live here because both are the same rAF.
	useEffect(() => {
		const canvas = canvasRef.current
		const card = canvas?.parentElement
		if (!canvas || !card) return

		let frame = 0
		let live = true

		const paint = () => {
			frame = 0
			if (!live) return

			const entry = peek(source.id)
			const first = entry?.pages[0]
			if (!entry || !first) return

			// Playing runs on its own frame counter; scrubbing reads the pointer.
			//
			// Across the whole flipbook, not across the pages that have landed: a long
			// one goes on arriving for a while, and a scrub that remapped itself
			// underneath a stationary pointer would drift through the drawing on its own.
			const index = playing
				? playhead.current
				: frameAt(pointer.current.fraction, entry.total || entry.pages.length)

			// Before it has arrived, the newest page there is. It is the closest thing to
			// what was asked for, and it moves towards it as the rest lands.
			const page = entry.pages[index] ?? entry.pages[entry.pages.length - 1] ?? first

			if (page === pointer.current.drawn && !pointer.current.resized) return

			pointer.current.drawn = page
			pointer.current.resized = false
			drawPage(canvas, page)
			setPainted(true)
		}

		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(paint)
		}

		// From here the cache has somewhere to draw. Everything it reports — a slice of
		// pages built, the last of them, a load that failed — means the same thing here.
		repaint.current = schedule

		/*
		 * Playback: one page every 1000/FPS, looping, from the beginning.
		 *
		 * A timer rather than a rAF count, and the engine's own `FPS` — this is the same
		 * twelve frames a second `scheduleFrame` turns on the playback page, and a
		 * flipbook that ran at a different speed in the grid than on its own page would
		 * be a different animation.
		 *
		 * It doesn't lap while the flipbook is still arriving, for the reason the engine
		 * doesn't: looping the two pages that have landed while the other forty are being
		 * built reads as a stutter rather than as a flipbook. The last page it has is held
		 * until the rest catch up, which on anything but the largest archive files is a
		 * frame or two.
		 */
		let timer = 0
		if (playing) {
			playhead.current = 0

			const advance = () => {
				const entry = peek(source.id)
				const landed = entry?.pages.length ?? 0
				const reach = entry?.status === 'ready' ? (entry.total ?? landed) : landed

				if (reach > 0) playhead.current = (playhead.current + 1) % reach
				schedule()

				timer = window.setTimeout(advance, 1000 / FPS)
			}

			timer = window.setTimeout(advance, 1000 / FPS)
			schedule()
		}

		const track = (clientX: number) => {
			// `getBoundingClientRect` per move looks like the expensive thing here and
			// isn't: it only forces a layout when one is pending, and nothing between
			// moves touches layout — the paint writes canvas pixels and nothing else.
			// Caching it would have to be invalidated on scroll, resize and reflow, and
			// be wrong the once it wasn't.
			const box = card.getBoundingClientRect()
			if (box.width <= 0) return

			pointer.current.fraction = (clientX - box.left) / box.width
			schedule()
		}

		const onMove = (event: PointerEvent) => track(event.clientX)
		card.addEventListener('pointermove', onMove)

		// The card's size decides the backing store, and the backing store is cleared
		// by being assigned — so a resize is a redraw, and `sizeCanvas` says when it
		// was really a resize rather than an observer firing over an unchanged box.
		const observer = new ResizeObserver(([entry]) => {
			const box = entry?.contentRect
			if (!box || box.width <= 0) return

			if (sizeCanvas(canvas, box.width, box.height)) {
				pointer.current.resized = true
				schedule()
			}
		})
		observer.observe(card)

		// Where the pointer came in, so a card entered and held still shows the frame
		// it was entered over rather than page one.
		track(originX)

		return () => {
			live = false
			repaint.current = () => {}
			if (frame !== 0) cancelAnimationFrame(frame)
			if (timer !== 0) window.clearTimeout(timer)
			card.removeEventListener('pointermove', onMove)
			observer.disconnect()
		}
	}, [source.id, originX, playing])

	// No `aria-hidden`, and none needed: a canvas with no fallback content contributes
	// nothing to the accessibility tree on its own, and the card around it already has
	// its name. Writing it here would be marking a decorative element as decorative,
	// which biome reads — correctly — as a sign the element is doing more than that.
	return <canvas ref={canvasRef} className={`${styles.preview} ${painted ? styles.painted : ''}`} />
}

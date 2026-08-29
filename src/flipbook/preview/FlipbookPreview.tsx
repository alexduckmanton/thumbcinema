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
	/**
	 * Follow a *finger* across the card, not just a mouse.
	 *
	 * Off by default, and that matters now that a paused flipbook stays on screen: the
	 * preview listens for pointer moves on the card it is mounted in, and a card showing
	 * a paused flipbook is still a link somebody may be tapping or scrolling past. Under
	 * a finger the only thing allowed to drive the scrub is the drag that began on the
	 * play button, and this is how that drag says so. A mouse is followed regardless —
	 * it can be over the card without having asked for anything.
	 */
	scrubbing?: boolean
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
export function FlipbookPreview({
	source,
	originX,
	playing = false,
	scrubbing = false,
}: FlipbookPreviewProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [painted, setPainted] = useState(false)

	/**
	 * Which frame is on the canvas, and who decided.
	 *
	 * Two things write here and the last one to write wins, which is the whole of how
	 * pausing works: playback advances `index` every frame, a scrub sets `fraction` and
	 * hands the choice back to the pointer, and stopping either of them writes nothing
	 * at all — so whatever was showing stays showing. There is no third state to
	 * represent "paused", because paused is just nobody writing.
	 *
	 * `drawn` holds the page object rather than its index, because the two ways this
	 * redraws are the frame changing and a page *appearing*, and the second changes what
	 * index 7 is without changing the number 7.
	 */
	const frame = useRef({
		index: 0,
		fraction: 0,
		/** True while the pointer owns the frame; false while playback does. */
		follow: true,
		drawn: null as unknown,
		resized: true,
	})

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

	/**
	 * The live value of `playing`, for the pointer effect — which deliberately doesn't
	 * depend on it and so can't close over it.
	 *
	 * Written in render rather than in an effect, the same way `useInfiniteScroll` keeps
	 * its callback current: what is wanted is the latest value at the moment something
	 * reads it, and an effect would be a render late.
	 */
	const playingRef = useRef(playing)
	playingRef.current = playing

	// Hold the flipbook for exactly as long as this card is under the pointer. The
	// release is what abandons a download nobody is waiting for any more.
	//
	// biome-ignore lint/correctness/useExhaustiveDependencies: the id is the identity of the source; the object is a fresh literal on every render.
	useEffect(() => retain(source, () => repaint.current()), [source.id])

	/*
	 * The pointer and the paint. Both live here because both are the same rAF.
	 *
	 * Deliberately *not* keyed on `playing`: starting and stopping playback must not
	 * tear this down and set it up again, because the rebuild ends with `track(originX)`
	 * and that would throw the frame back to wherever the pointer happens to be — which
	 * on a pause is exactly the frame you were trying to keep. Playback has its own
	 * effect below for that reason.
	 */
	useEffect(() => {
		const canvas = canvasRef.current
		const card = canvas?.parentElement
		if (!canvas || !card) return

		let rafId = 0
		let live = true

		const paint = () => {
			rafId = 0
			if (!live) return

			const entry = peek(source.id)
			const first = entry?.pages[0]
			if (!entry || !first) return

			// Whoever wrote last decides. While the pointer owns the frame this resolves
			// its position afresh — across the whole flipbook, not across the pages that
			// have landed, or a long one would remap itself under a stationary finger as
			// the rest arrived. While playback owns it, or while nothing does because it
			// is paused, `index` already says which frame and is simply used.
			const index = frame.current.follow
				? frameAt(frame.current.fraction, entry.total || entry.pages.length)
				: frame.current.index

			// Before it has arrived, the newest page there is. It is the closest thing to
			// what was asked for, and it moves towards it as the rest lands.
			const page = entry.pages[index] ?? entry.pages[entry.pages.length - 1] ?? first

			if (page === frame.current.drawn && !frame.current.resized) return

			frame.current.drawn = page
			frame.current.resized = false
			drawPage(canvas, page, entry.page)
			setPainted(true)
		}

		const schedule = () => {
			if (rafId === 0) rafId = requestAnimationFrame(paint)
		}

		// From here the cache has somewhere to draw. Everything it reports — a slice of
		// pages built, the last of them, a load that failed — means the same thing here.
		repaint.current = schedule

		const track = (clientX: number) => {
			// Playback owns the frame while it is running, and the pointer does not get to
			// argue. Without this the two write to `follow` in turn — the timer clearing it
			// twelve times a second, a mouse moving over a playing card setting it again —
			// and the canvas alternates between the frame playback reached and the frame
			// under the cursor. Pause, or leave and come back, and the pointer has it again.
			if (playingRef.current) return

			// `getBoundingClientRect` per move looks like the expensive thing here and
			// isn't: it only forces a layout when one is pending, and nothing between
			// moves touches layout — the paint writes canvas pixels and nothing else.
			// Caching it would have to be invalidated on scroll, resize and reflow, and
			// be wrong the once it wasn't.
			const box = card.getBoundingClientRect()
			if (box.width <= 0) return

			frame.current.fraction = (clientX - box.left) / box.width
			frame.current.follow = true
			schedule()
		}

		const onMove = (event: PointerEvent) => {
			// A finger only drives the scrub when it is *the* drag — the one that began
			// on the play button and said so. Any other touch crossing this card is
			// somebody tapping the link or scrolling past a paused flipbook, and neither
			// should move the frame. A mouse is always followed: it can be over a card
			// without having asked for anything, which is the whole of what hovering is.
			if (event.pointerType === 'touch' && !scrubbing) return
			track(event.clientX)
		}
		card.addEventListener('pointermove', onMove)

		// The card's size decides the backing store, and the backing store is cleared
		// by being assigned — so a resize is a redraw, and `sizeCanvas` says when it
		// was really a resize rather than an observer firing over an unchanged box.
		const observer = new ResizeObserver(([entry]) => {
			const box = entry?.contentRect
			if (!box || box.width <= 0) return

			if (sizeCanvas(canvas, box.width, box.height)) {
				frame.current.resized = true
				schedule()
			}
		})
		observer.observe(card)

		// Where the pointer came in, so a card entered and held still shows the frame it
		// was entered over rather than page one. `track` stands down on its own while
		// playing — a press on the play button is not a position anyone chose.
		track(originX)

		return () => {
			live = false
			repaint.current = () => {}
			if (rafId !== 0) cancelAnimationFrame(rafId)
			card.removeEventListener('pointermove', onMove)
			observer.disconnect()
		}
	}, [source.id, originX, scrubbing])

	/*
	 * Playback: one page every 1000/FPS, looping, carrying on from whatever is on screen.
	 *
	 * A timer rather than a rAF count, and the engine's own `FPS` — this is the same
	 * twelve frames a second `scheduleFrame` turns on the playback page, and a flipbook
	 * that ran at a different speed in the grid than on its own page would be a
	 * different animation.
	 *
	 * It doesn't lap while the flipbook is still arriving, for the reason the engine
	 * doesn't: looping the two pages that have landed while the other forty are being
	 * built reads as a stutter rather than as a flipbook. The last page it has is held
	 * until the rest catch up, which on anything but the largest archive files is a
	 * frame or two.
	 *
	 * **Its own effect, and that is the whole of how pausing works.** Stopping clears
	 * the timer and writes nothing else, so the frame it had reached is still in
	 * `frame.current.index` and still on the canvas — nothing repaints, nothing reverts,
	 * and the card holds the drawing you stopped on. Folded into the effect above, a
	 * pause would tear that effect down and rebuild it, and the rebuild ends by tracking
	 * the pointer.
	 */
	useEffect(() => {
		if (!playing) return

		// Start from the frame that is showing, whatever put it there. Paused, that is
		// where playback stopped and this is a resume; scrubbed, it is the frame the
		// finger left and playback carries on from it; and on a card that has never been
		// played or touched it is zero, which is page one.
		if (frame.current.follow) {
			const entry = peek(source.id)
			const total = entry ? entry.total || entry.pages.length : 0
			frame.current.index = total ? frameAt(frame.current.fraction, total) : 0
		}
		frame.current.follow = false
		repaint.current()

		const advance = () => {
			const entry = peek(source.id)
			const landed = entry?.pages.length ?? 0
			const reach = entry?.status === 'ready' ? (entry.total ?? landed) : landed

			if (reach > 0) frame.current.index = (frame.current.index + 1) % reach
			frame.current.follow = false
			repaint.current()

			timer = window.setTimeout(advance, 1000 / FPS)
		}

		let timer = window.setTimeout(advance, 1000 / FPS)
		return () => window.clearTimeout(timer)
	}, [source.id, playing])

	// No `aria-hidden`, and none needed: a canvas with no fallback content contributes
	// nothing to the accessibility tree on its own, and the card around it already has
	// its name. Writing it here would be marking a decorative element as decorative,
	// which biome reads — correctly — as a sign the element is doing more than that.
	return <canvas ref={canvasRef} className={`${styles.preview} ${painted ? styles.painted : ''}`} />
}

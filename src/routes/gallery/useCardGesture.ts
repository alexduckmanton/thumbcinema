import { useCallback, useRef, useState } from 'react'

import type { PreviewSource } from '../../flipbook/preview/cache'
import { loadPreview } from './preview'

/**
 * Which card is playing, and where along it the gesture came in.
 *
 * One at a time, because a pointer is one thing — which is what lets a grid of fifty
 * flipbooks be played through a single canvas. See `FlipbookPreview`.
 */
export interface Hover {
	id: string
	originX: number
	/** Running on its own rather than following the pointer. See the play button. */
	playing: boolean
}

/**
 * How far a finger travels before it is a scrub rather than a tap.
 *
 * Ten pixels, the same order as `TAP_SLOP` on the page bar and for the same reason:
 * a finger that means to stay still doesn't, quite. Below this the gesture is still a
 * tap and the card is still a link; above it the card is a scrubber and the tap that
 * would have followed is called off.
 */
const TOUCH_SLOP = 10

interface Candidate {
	id: string
	pointerId: number
	x: number
	y: number
	/** True once the finger has committed to scrubbing rather than tapping. */
	scrubbing: boolean
	/**
	 * A press on the play button of a card that is already playing, waiting to see
	 * whether it was a stop or the start of a drag.
	 *
	 * Turning playback *on* happens at `pointerdown`, because a press-and-hold that
	 * waited for the release wouldn't be a hold. Turning it *off* has to wait, and this
	 * is why: a drag that starts on the button of a running flipbook would otherwise
	 * stop it — unmounting the preview — a few milliseconds before the drag armed and
	 * mounted it again, and the card would flash its thumbnail in the middle of one
	 * continuous gesture.
	 */
	stopOnRelease: boolean
}

/**
 * The card gestures, mouse and finger, in one place.
 *
 * A mouse has a hover and a finger doesn't, and that is the whole of the difference:
 * pointing at a card is free and says nothing, so a mouse plays a flipbook the moment
 * it arrives. A finger has to touch the thing it wants to look at, and the same touch
 * is how you open it — so a flipbook can't start playing on contact without a tap
 * flashing a frame on its way to the playback page.
 *
 * So the finger's version waits. The download starts on contact, because that is
 * wanted either way (see `prefetch`), but nothing is shown until the finger has said
 * which gesture it is by moving sideways. From there it is the same scrub the mouse
 * gets, in the same place, off the same absolute position across the card.
 *
 * What a finger still can't do that way is simply *watch* one, and that is the play
 * button's job — a sibling of the anchor rather than anything inside it, so that the
 * one control wanting a long press is somewhere iOS doesn't answer with a menu. A drag
 * that begins on it is the same drag as any other and ends in the same scrub.
 *
 * Two things make it work on iOS, and neither is a hack:
 *
 *  - **`touch-action: pan-y`** on the card and the button, which is the browser's own
 *    way of being told that vertical belongs to the page and horizontal belongs to us.
 *    Without it Safari claims the gesture for scrolling and sends `pointercancel`
 *    instead of the moves. The gallery only ever scrolls vertically, so nothing is
 *    given up.
 *  - **Pointer capture**, so the drag survives the finger leaving what it started on —
 *    off a 36px button immediately, and off a 200px-tall thumbnail constantly.
 *
 * The card's own press-and-hold menu is left alone. Suppressing it took the link's
 * affordances with it — that menu is how a flipbook is opened in a new tab or its
 * address copied — so the gesture moved instead of the menu going.
 */
export function useCardGesture() {
	const [hover, setHover] = useState<Hover | null>(null)

	const candidate = useRef<Candidate | null>(null)

	/**
	 * Set when a scrub ends, and spent by the click that follows it.
	 *
	 * A drag that begins and ends on the same element still produces a click, and that
	 * click would open the flipbook you had just finished looking through. `Link` calls
	 * its `onClick` before anything else and stands down if the event was defaulted, so
	 * preventing it there is enough to call off both the router and the anchor.
	 */
	const swallowClick = useRef(false)

	/** True while a play-button click is the echo of a press that was already acted on. */
	const byPointer = useRef(false)

	/**
	 * A mouse arriving on a card, which is the whole of what starts a preview for it.
	 *
	 * Asked of the pointer rather than of the device, as the create page's tray is when
	 * it tells a mouse from a finger: `isTouch` answers for the machine, and on a laptop
	 * with a touchscreen the answer is yes while somebody is using the trackpad.
	 *
	 * There is no hover-intent delay in front of this, deliberately. The guard against a
	 * pointer sweeping across the grid isn't to hesitate before every card, which
	 * everyone pays for — it is that letting go of a card whose artwork hasn't arrived
	 * abandons the download. See `retain` in the preview cache.
	 */
	const handleEnter = useCallback((event: React.PointerEvent, id: string) => {
		if (event.pointerType === 'touch') return
		setHover({ id, originX: event.clientX, playing: false })
	}, [])

	// Guarded on the id because leaving one card and entering the next are two events
	// about two different cards, and nothing guarantees which order they arrive in.
	const handleLeave = useCallback((event: React.PointerEvent, id: string) => {
		if (event.pointerType === 'touch') return
		setHover((current) => (current?.id === id ? null : current))
	}, [])

	/**
	 * A finger landing on a card: a tap and a scrub both start here and are told apart
	 * `TOUCH_SLOP` later.
	 *
	 * The card is a real `<a href>` and is left alone, press-and-hold menu and all. The
	 * way past that menu is not to suppress it — that took the link's own affordances
	 * with it — but to put the control that wants a long press somewhere the menu isn't:
	 * the play button in the corner, which is a sibling of the anchor rather than
	 * anything inside it. See `handlePlayDown`.
	 */
	const handlePointerDown = useCallback((event: React.PointerEvent, item: PreviewSource) => {
		if (event.pointerType !== 'touch') return

		// A click that never came — the finger left the card, or the browser took the
		// gesture for a scroll. Cleared here so it can never eat a later tap.
		swallowClick.current = false

		candidate.current = {
			id: item.id,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			scrubbing: false,
			stopOnRelease: false,
		}

		// On contact rather than on the decision, and wanted whichever way the gesture
		// goes: a scrub is about to draw this and a tap is about to open the page that
		// needs it. `prefetch` takes no hold, so there is nothing to undo here.
		loadPreview()
			.then((module) => module.prefetch(item))
			.catch(() => {})
	}, [])

	/**
	 * The move that decides what the gesture was.
	 *
	 * Sideways, and more sideways than up: `touch-action: pan-y` means Safari has
	 * already agreed horizontal is ours, but it makes that call a few events in and
	 * these are the events before it. Requiring the horizontal component to be the
	 * larger one is what stops the first pixels of a scroll flicking a flipbook on.
	 *
	 * After this the preview mounts and takes the pointer over — it listens on the card
	 * itself — so this runs only until a gesture is armed, never during one.
	 */
	const handlePointerMove = useCallback((event: React.PointerEvent) => {
		const held = candidate.current
		if (!held || held.scrubbing || held.pointerId !== event.pointerId) return

		const dx = event.clientX - held.x
		const dy = event.clientY - held.y
		if (Math.abs(dx) < TOUCH_SLOP || Math.abs(dx) <= Math.abs(dy)) return

		held.scrubbing = true

		// Held to the card for the rest of the drag. A thumbnail is a couple of hundred
		// pixels tall and a finger travelling along one wanders out of it without meaning
		// to; without this the scrub would stop dead halfway.
		event.currentTarget.setPointerCapture(event.pointerId)

		// `playing: false` whichever way the gesture began. A drag off the play button is
		// the same drag as a drag across the card, and it takes the flipbook off its own
		// clock and puts it under the finger — which is what dragging a flipbook means.
		setHover({ id: held.id, originX: event.clientX, playing: false })
	}, [])

	/**
	 * The finger lifted. The scrub ends, the click it would have become is called off,
	 * and the frame it landed on **stays**.
	 *
	 * This is the one place the finger and the mouse genuinely want different things,
	 * rather than the same thing arrived at differently. A mouse leaving a card is a
	 * decision — you moved away — and putting the thumbnail back is right. A finger
	 * lifting is not: the whole time a finger is on the card it is *over* the drawing,
	 * so the frame you were looking for is the one frame you could not see. Reverting on
	 * lift would mean you never got to look at it, and the card would flick back to a
	 * page you didn't choose at the exact moment you stopped choosing.
	 *
	 * So the flipbook stays where you left it. Touching another card moves the preview
	 * there — there is only ever one — and tapping this one still opens it, because a
	 * tap that never scrubbed swallows nothing.
	 *
	 * This is also where a running flipbook is stopped, rather than at the press that
	 * asked for it. See `Candidate.stopOnRelease`.
	 */
	const handlePointerUp = useCallback((event: React.PointerEvent) => {
		const held = candidate.current
		if (!held || held.pointerId !== event.pointerId) return
		candidate.current = null

		if (held.scrubbing) {
			swallowClick.current = true
			return
		}

		if (held.stopOnRelease) setHover((current) => (current?.id === held.id ? null : current))
	}, [])

	/**
	 * The browser took the gesture — a scroll, or a second finger.
	 *
	 * No click follows a cancel, so nothing is swallowed: setting the flag here would
	 * leave it set, and the next tap on any card in the grid would go nowhere.
	 *
	 * A cancel that arrives mid-scrub does put the thumbnail back, where a lift doesn't.
	 * The gesture was taken away rather than finished, so there is no frame anyone chose
	 * to leave on screen.
	 */
	const handlePointerCancel = useCallback((event: React.PointerEvent) => {
		const held = candidate.current
		if (!held || held.pointerId !== event.pointerId) return
		candidate.current = null

		if (held.scrubbing) setHover((current) => (current?.id === held.id ? null : current))
	}, [])

	const handleClick = useCallback((event: React.MouseEvent) => {
		if (!swallowClick.current) return
		swallowClick.current = false
		event.preventDefault()
	}, [])

	/** Starts a card playing from the top. The only thing that turns playback on. */
	const startPlaying = useCallback((item: PreviewSource, originX: number) => {
		setHover({ id: item.id, originX, playing: true })
	}, [])

	/** Whether this card is the one currently running. */
	const isPlaying = useCallback((id: string) => hover?.id === id && hover.playing, [hover])

	/**
	 * A press on the play button, which is where a long press is safe.
	 *
	 * The button is a sibling of the `<a>` rather than a child of it — interactive
	 * content inside a link is invalid markup, and more to the point a child would still
	 * be the link as far as iOS is concerned, which is the whole thing being avoided. A
	 * long press here raises no menu because there is no link under the finger.
	 *
	 * Starting is acted on at `pointerdown`, so pressing and holding runs the flipbook
	 * straight away rather than at the moment you let go — which is what a hold is for.
	 * **Stopping waits for the release**, and the asymmetry is deliberate: a drag that
	 * begins on the button of a card that is already running would otherwise stop it,
	 * unmounting the preview a few milliseconds before the drag armed and mounted it
	 * again, and the card would flash its thumbnail in the middle of one gesture.
	 *
	 * The candidate is recorded exactly as the card's is, so the drag that starts here
	 * and leaves the button is the same drag it would have been anywhere else: past
	 * `TOUCH_SLOP` sideways, `handlePointerMove` takes the flipbook off its clock and
	 * puts it under the finger.
	 */
	const handlePlayDown = useCallback(
		(event: React.PointerEvent, item: PreviewSource) => {
			swallowClick.current = false
			byPointer.current = true

			const running = isPlaying(item.id)

			candidate.current = {
				id: item.id,
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				scrubbing: false,
				stopOnRelease: running,
			}

			// Captured on the way in, not at the slop line as the card does it. The button
			// is 36px across and the drag that matters leaves it almost immediately; by the
			// time there is anything to capture, the pointer is over the card instead and
			// `handlePointerMove` would never hear about it.
			event.currentTarget.setPointerCapture(event.pointerId)

			loadPreview()
				.then((module) => module.prefetch(item))
				.catch(() => {})

			if (!running) startPlaying(item, event.clientX)
		},
		[isPlaying, startPlaying],
	)

	/**
	 * The same toggle for the keyboard.
	 *
	 * A click follows every pointer press, and acting on both would turn playback on and
	 * straight back off again — so a click that a `pointerdown` already answered is spent
	 * here and does nothing. What is left is the click with no pointer behind it, which
	 * is Enter or Space on a focused button.
	 */
	const handlePlayClick = useCallback(
		(event: React.MouseEvent, item: PreviewSource) => {
			// It is a sibling of the link rather than inside it, so this can't reach the
			// anchor — but the card is a link and a stray activation on one is a navigation.
			event.preventDefault()

			if (byPointer.current) {
				byPointer.current = false
				return
			}

			// A keyboard has no position to scrub from, so the flipbook starts where the
			// card does — the left-hand edge, which is page one.
			if (isPlaying(item.id)) setHover(null)
			else startPlaying(item, event.currentTarget.getBoundingClientRect().left)
		},
		[isPlaying, startPlaying],
	)

	return {
		hover,
		handleEnter,
		handleLeave,
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		handlePointerCancel,
		handleClick,
		handlePlayDown,
		handlePlayClick,
	}
}

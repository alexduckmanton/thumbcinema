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
 * Three things make that work on iOS, and none of them is a hack:
 *
 *  - **`touch-action: pan-y` on the card**, which is the browser's own way of being
 *    told that vertical belongs to the page and horizontal belongs to us. Without it
 *    Safari claims the gesture for scrolling and sends `pointercancel` instead of the
 *    moves. The gallery only ever scrolls vertically, so nothing is given up.
 *  - **`-webkit-touch-callout: none`**, which is what stops the press-and-hold menu.
 *    The card stays a real `<a href>`; see `handlePointerDown`.
 *  - **Pointer capture once it is a scrub**, so the drag survives the finger drifting
 *    off the card, which over a 200px-tall thumbnail it does constantly.
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
		setHover({ id, originX: event.clientX })
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
	 * The card is left as a real `<a href>` rather than becoming a div that navigates on
	 * click, which was the other way to be rid of the press-and-hold menu. It would have
	 * cost the things an anchor is: cmd-click and middle-click to a new tab, the URL in
	 * the status bar, "copy link", and a link's name and role in the accessibility tree.
	 * `-webkit-touch-callout: none` is one line of CSS against all of that.
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

		setHover({ id: held.id, originX: event.clientX })
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
	 */
	const handlePointerUp = useCallback((event: React.PointerEvent) => {
		const held = candidate.current
		if (!held || held.pointerId !== event.pointerId) return
		candidate.current = null

		if (held.scrubbing) swallowClick.current = true
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

	return {
		hover,
		handleEnter,
		handleLeave,
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		handlePointerCancel,
		handleClick,
	}
}

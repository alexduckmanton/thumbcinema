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

/**
 * How long a press has to last before letting go of it means stop.
 *
 * The play button answers two gestures and they end differently. A **tap** is a switch:
 * it starts the flipbook and leaves it running, and the next tap stops it. A **hold** is
 * a peek: it runs the flipbook for as long as you keep your finger down and stops when
 * you take it away. Both start playback on contact, so the only thing that tells them
 * apart afterwards is how long the finger stayed.
 *
 * 300ms. Below it a press reads as a tap even when it's a slow one; above it, nobody
 * holding a button to watch something thinks they have merely tapped it.
 */
const HOLD_MS = 300

interface Candidate {
	id: string
	pointerId: number
	x: number
	y: number
	/** True once the finger has committed to scrubbing rather than tapping. */
	scrubbing: boolean
	/** Whether this card was already running when the press landed. */
	wasPlaying: boolean
	/** When the press landed, for telling a tap from a hold. See `HOLD_MS`. */
	downAt: number
}

/**
 * The card gestures, mouse and finger, in one place.
 *
 * **A mouse has a hover and a finger doesn't, and the two layouts diverge on that.**
 * Pointing at a card is free and says nothing, so a mouse plays a flipbook the moment
 * it arrives anywhere on one, and scrubs it by moving across. A finger has no move that
 * says nothing: everything it does to a card is a commitment, and the card is a link.
 * So on a finger the card is *only* a link — it doesn't scrub, it doesn't play — and
 * every gesture lives on the play button in the corner instead, where it is asked for
 * rather than stumbled into.
 *
 * The card body did scrub under a finger for a while, and giving that up is what this
 * is: it made every card a thing that might or might not be a link depending on how you
 * touched it, and it needed `touch-action` on the card to hold the scroll off. Both are
 * gone. A card now behaves exactly as a link should on a phone, press-and-hold menu
 * included — that menu is how a flipbook is opened in a new tab or has its address
 * copied, and it was suppressed for a while to make room for a gesture that has since
 * moved somewhere better.
 *
 * The button answers three gestures, all of which begin identically and none of which
 * can be told apart until the finger comes off — see `handlePointerUp`:
 *
 *  - **tap** — plays, and keeps playing. Tap again to stop.
 *  - **hold** — plays while held, stops when let go. `HOLD_MS` apart from a tap.
 *  - **drag** — hands the flipbook to the finger, and is the same scrub the mouse gets:
 *    same place, same absolute position across the card.
 *
 * Two things make that work on iOS, and neither is a hack:
 *
 *  - **`touch-action: none` on the button**, which says the touches that start there
 *    are ours and the scroller may not have them. `pan-y` was not enough — Safari
 *    decides whether a gesture is a scroll from how it begins, so a quick sideways
 *    flick was safe but a press-and-hold left the question open and the first vertical
 *    movement after it took the drag away mid-scrub.
 *  - **Pointer capture**, so the drag survives the finger leaving what it started on,
 *    which off a 36px disc is immediately.
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
	 * A finger landing on a card, which starts a download and nothing else.
	 *
	 * **The card body does not scrub under a finger, and that is deliberate.** It used
	 * to: a sideways drag anywhere on a card was a scrub, which needed
	 * `touch-action: pan-y` to keep Safari from claiming the gesture, and which made
	 * every card a thing that might or might not be a link depending on how you touched
	 * it. On a mouse that ambiguity costs nothing, because hovering is free and says
	 * nothing — so the desktop still plays from anywhere on the card. A finger has no
	 * such move. Everything a finger does to a card is a commitment, so the card is
	 * simply a link again and the gestures live on the play button, where they are
	 * asked for rather than stumbled into.
	 *
	 * What is left here is worth keeping on its own: a tap is about to open the playback
	 * page, and that page needs this artwork. `prefetch` takes no hold, so there is
	 * nothing to undo if the finger goes somewhere else.
	 */
	const handleCardTouch = useCallback((event: React.PointerEvent, item: PreviewSource) => {
		if (event.pointerType !== 'touch') return

		loadPreview()
			.then((module) => module.prefetch(item))
			.catch(() => {})
	}, [])

	/**
	 * The move that turns a press on the play button into a scrub.
	 *
	 * Sideways, and more sideways than up — a drag that sets off downwards is somebody
	 * reaching past the button, not somebody scrubbing.
	 *
	 * The gesture cannot be stolen once it has started, and that is `touch-action: none`
	 * on the button rather than anything here. `pan-y` was not enough: Safari decides
	 * whether a gesture is a scroll from how it *begins*, so a quick sideways flick was
	 * committed to us and safe, while a press-and-hold left the question open — and the
	 * first vertical movement after that, however late, handed the whole drag to the
	 * scroller mid-scrub. Declaring the button's touches ours outright is what closes
	 * that, and it costs only the ability to start a page scroll from a 36px disc.
	 *
	 * After this the preview mounts and listens for itself, so this runs only until a
	 * gesture is armed, never during one.
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
	 * The finger lifted, and this is where the gesture is finally named.
	 *
	 * Three ways out, and each one ends differently:
	 *
	 *  - **A scrub.** The frame it landed on *stays*, and the click it would otherwise
	 *    have become is called off. This is the one place the finger and the mouse
	 *    genuinely want different things rather than the same thing arrived at
	 *    differently. A mouse leaving a card is a decision — you moved away — and
	 *    putting the thumbnail back is right. A finger lifting is not: the whole time it
	 *    is down it is *over* the drawing, so the frame you were looking for is the one
	 *    frame you could not see. Reverting on lift would mean you never got to look at
	 *    it, and the card would flick back to a page you didn't choose at the exact
	 *    moment you stopped choosing.
	 *  - **A hold.** Playback was a peek and the peek is over: it stops. `HOLD_MS` is
	 *    the whole of the difference between this and the next one.
	 *  - **A tap.** Playback is a switch, so it stays running — and a tap on a card that
	 *    was *already* running is the other half of that switch, and stops it.
	 *
	 * All three start the same way, which is why none of this can be decided any earlier
	 * than here.
	 */
	const handlePointerUp = useCallback((event: React.PointerEvent) => {
		const held = candidate.current
		if (!held || held.pointerId !== event.pointerId) return
		candidate.current = null

		if (held.scrubbing) {
			swallowClick.current = true
			return
		}

		const wasHeld = performance.now() - held.downAt >= HOLD_MS
		if (wasHeld || held.wasPlaying) {
			setHover((current) => (current?.id === held.id ? null : current))
		}
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
	 * **Everything starts here and nothing is decided here.** A press always begins
	 * playback, because a hold that waited for the release would not be a hold — and
	 * from that same press the finger can go on to lift quickly (a tap), stay down (a
	 * hold), or set off sideways (a scrub). Which of the three it was is `handlePointerUp`'s
	 * to work out, and it cannot be known any sooner.
	 *
	 * That is also why stopping never happens on the way in. A drag that begins on the
	 * button of a card that is already running would otherwise stop it, unmounting the
	 * preview a few milliseconds before the drag armed and mounted it again, and the
	 * card would flash its thumbnail in the middle of one continuous gesture.
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
				wasPlaying: running,
				downAt: performance.now(),
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
		handleCardTouch,
		handlePointerMove,
		handlePointerUp,
		handlePointerCancel,
		handleClick,
		handlePlayDown,
		handlePlayClick,
	}
}

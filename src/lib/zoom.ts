/**
 * Turns off pinch zoom, which iOS does not let a viewport tag turn off.
 *
 * `user-scalable=no` has been ignored by Safari since iOS 10 — the reasoning being
 * that a page has no business preventing someone from magnifying it, which is fair
 * for a page and wrong for a canvas you draw on with your finger. Safari does still
 * fire its own non-standard gesture events for a pinch, and cancelling those is what
 * stops it. Everything else honours the viewport tag and never gets here.
 *
 * Deliberately not the rest of the usual set:
 *
 *  - **Double-tap zoom** is already off, from `touch-action: manipulation` on the
 *    body. Doing it by hand means swallowing the second tap inside 300ms, which is
 *    also what pressing "new page" twice quickly looks like.
 *  - **Two-finger `touchmove`** is left alone *here*, because on the gallery that is
 *    someone scrolling with two fingers rather than pinching. The create page has no
 *    such thing and takes `refuseMultiTouch()` below instead.
 *
 * **Taking these off does not speed up the first `touchmove`**, which is worth writing
 * down because it looks as though it should. The theory was that a registered gesture
 * listener makes Safari hold a single contact still while it watches for a second one
 * that would make a pinch. It doesn't: measured on iOS 18.7 with the listeners off,
 * the first move of a slow drag still arrived carrying 10.7px against 0.3px for every
 * event after it. The slop is Safari's and is not ours to switch off.
 */
export function preventPinchZoom(): void {
	const cancel = (event: Event) => event.preventDefault()

	document.addEventListener('gesturestart', cancel)
	document.addEventListener('gesturechange', cancel)
	document.addEventListener('gestureend', cancel)
}

/**
 * Refuses every multi-touch gesture on the document, and hands back the undo.
 *
 * The create page's own, and only for as long as the drawing tool is up. Cancelling
 * Safari's `gesture*` events is supposed to be the whole answer to pinch zoom, and it
 * is not: a pinch still gets through occasionally, and the gap is which touches
 * anything is watching. `PointerLayer` calls `preventDefault()` on the gestures it
 * owns, but a touch that starts on a *control* is left alone by design — the tray's
 * page actions, undo, redo, save, the page bar and its arrows, every thumbnail in the
 * strip, and the whole of the header, which is outside the field altogether. Land two
 * fingers starting there and nothing on the page objects.
 *
 * So the page states the rule once, at the top, rather than relying on every control
 * below it: while the tool is up, **two contacts is a drawing gesture and never a
 * pinch**. Nothing on this page scrolls, so there is nothing the refusal costs — which
 * is exactly what is not true of the gallery, and why this isn't done site-wide.
 *
 * Three details are load-bearing. **Capture**, because `PointerLayer` calls
 * `stopPropagation()` on the gestures it owns and a bubble-phase listener on the
 * document would never see them — capture at the document runs before anything else and
 * sees every touch either way. **`passive: false`**, because Safari makes a
 * document-level `touchmove` passive by default and a passive listener may not call
 * `preventDefault()` at all. And **`touchmove` rather than `touchstart`**: a pinch needs
 * movement, and refusing the *start* of a second contact would take the click off every
 * control on the page for anyone with a finger already resting on it.
 */
export function refuseMultiTouch(): () => void {
	const cancel = (event: TouchEvent) => {
		// Once the browser has committed to zooming it stops asking, so this has to land
		// on the first move of the gesture — which is what capture buys.
		if (event.touches.length < 2 || !event.cancelable) return
		event.preventDefault()
	}

	const options = { capture: true, passive: false }
	document.addEventListener('touchmove', cancel, options)

	return () => document.removeEventListener('touchmove', cancel, { capture: true })
}

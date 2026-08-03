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
 *  - **Two-finger `touchmove`** is left alone, because on the gallery that is
 *    someone scrolling with two fingers rather than pinching.
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

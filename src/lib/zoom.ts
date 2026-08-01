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
 */
export function preventPinchZoom(): void {
	const cancel = (event: Event) => event.preventDefault()

	document.addEventListener('gesturestart', cancel)
	document.addEventListener('gesturechange', cancel)
	document.addEventListener('gestureend', cancel)
}

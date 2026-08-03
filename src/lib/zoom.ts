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
 * **The create page went without these for a while and it changed nothing**, which is
 * worth recording so nobody tries it twice. The theory was that a registered gesture
 * listener is what makes Safari hold a single contact still while it watches for a
 * second one — which would explain the first `touchmove` of a slow drag arriving only
 * after the finger has travelled several pixels and then carrying the lot at once. It
 * doesn't: with the listeners off, the first delta was 10.7px against 0.3px for every
 * event after it, against 5.4px with them on. Thirty-five times the rest either way.
 * The slop is Safari's own and is not ours to switch off.
 */

const cancel = (event: Event) => event.preventDefault()

let guarding = false

export function preventPinchZoom(): void {
	if (guarding) return

	document.addEventListener('gesturestart', cancel)
	document.addEventListener('gesturechange', cancel)
	document.addEventListener('gestureend', cancel)
	guarding = true
}

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
 * **The create page takes it back off again**, and that is an experiment rather than
 * a decision — see `allowPinchZoom`.
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

/**
 * Takes the gesture listeners off the document again.
 *
 * The create page does this for the whole time it is mounted, to answer a measured
 * question: on an iPhone the first `touchmove` of a slow drag arrives only after the
 * finger has travelled about five pixels, and then carries the whole distance at once
 * — 5.4px against 0.3px for every event after it, recorded on iOS 18.7. That is touch
 * slop, and because it is a fixed *distance* the delay it causes is inversely
 * proportional to speed: aiming a cursor slowly, which is the whole of what the
 * relative drawing modes are for, is the worst case there is. It reads as the cursor
 * stalling for half a second and then jumping.
 *
 * The suspicion this tests is that a **registered gesture listener is itself the
 * cause** — that Safari holds a single contact still while it watches for a second
 * one that would make a pinch. If it is, the numbers change with these gone; if the
 * first delta is still five times the rest, it never was and these come back.
 *
 * The canvas doesn't need them either way: `touch-action: none` is what stops a pinch
 * that starts on the drawing, and that is where a pinch would start. What is given up
 * meanwhile is pinch zoom being impossible on the *rest* of the create page.
 */
export function allowPinchZoom(): void {
	if (!guarding) return

	document.removeEventListener('gesturestart', cancel)
	document.removeEventListener('gesturechange', cancel)
	document.removeEventListener('gestureend', cancel)
	guarding = false
}

/** Whether the guard is on, for the touch log to record alongside its numbers. */
export function pinchGuarded(): boolean {
	return guarding
}

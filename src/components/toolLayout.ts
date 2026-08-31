import { useLayoutEffect } from 'react'

/**
 * How many mounted components currently hold the drawing tool's page lock.
 *
 * Normally one, and for one frame at the handover it is two. The create route is lazy,
 * so its boot shell and the page itself are different components that want the same
 * layout — and when the route's chunk lands, React runs the shell's cleanup and the
 * page's effect in the same commit. A plain add-on-mount, remove-on-unmount would
 * therefore take the class off and put it back, and while nothing is painted in between,
 * a count says what is actually true and cannot be got wrong by a future third caller.
 */
let held = 0

/**
 * `html.locked`: the drawing tool's page held still, and shaped.
 *
 * Two things in one class, because they are the same claim made twice — see `base.css`.
 * It stops the document scrolling, bouncing, pinching and pulling to refresh; and it makes
 * `#root` a flex column of a definite height with `main` taking what the header leaves,
 * which is what lets the create page's stage have a height to divide at all.
 *
 * The second half is why the boot shell holds it too. Without it `main` stops at its
 * content, the stage's `flex: 1` has nothing to grow into, and the shell draws its sheet
 * of paper at the top of a window the page will centre it in — a jump at the exact moment
 * this shell exists to make uneventful.
 *
 * A layout effect rather than an effect: an ordinary one runs after the browser has
 * painted, so the first frame would be the unshaped page.
 *
 * The rest of the lock — `refuseMultiTouch()`, and the `pannable` escape the save form
 * needs — belongs to the page and stays in `useNoScrolling`. Nothing the shell renders can
 * be drawn on or typed into.
 */
export function useLockedLayout(): void {
	useLayoutEffect(() => {
		held += 1
		document.documentElement.classList.add('locked')

		return () => {
			held -= 1
			if (held === 0) document.documentElement.classList.remove('locked')
		}
	}, [])
}

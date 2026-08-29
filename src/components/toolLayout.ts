import { useLayoutEffect } from 'react'

/**
 * How many mounted components currently need the drawing tool's page shape.
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
 * The drawing tool's page shape: one windowful, with `main` taking whatever the header
 * leaves. See `html.tool` in `base.css`, which is where it is written down.
 *
 * A layout effect rather than an effect, because what this sizes is the page: an
 * ordinary effect runs after the browser has painted, so the first frame of the create
 * route would be a stage with no height in it and a sheet of paper collapsed to nothing.
 *
 * Separate from the gesture lock — no rubber band, no pinch, no pull to refresh — which
 * is `html.locked` and comes off while the save form is up. See `useNoScrolling`.
 */
export function useToolLayout(): void {
	useLayoutEffect(() => {
		held += 1
		document.documentElement.classList.add('tool')

		return () => {
			held -= 1
			if (held === 0) document.documentElement.classList.remove('tool')
		}
	}, [])
}

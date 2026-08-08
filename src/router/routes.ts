/**
 * Route matching, as a pure function over the pathname.
 *
 * Four routes, no nesting, no loaders, no data layer — a router library would be
 * more configuration than this is code, and this can be tested without rendering
 * anything.
 */

import type { GalleryView } from '../lib/api'

export type Route =
	| { name: 'gallery' }
	| { name: 'create' }
	| { name: 'playback'; id: string }
	| { name: 'notFound' }

const PLAYBACK = /^\/f\/([^/]+)\/?$/

export function matchRoute(pathname: string): Route {
	// Trailing slashes are equivalent everywhere except the root itself.
	const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

	if (path === '' || path === '/') return { name: 'gallery' }
	if (path === '/create') return { name: 'create' }

	const playback = PLAYBACK.exec(pathname)
	if (playback?.[1]) {
		// A malformed escape sequence in the URL is a 404, not a crash.
		try {
			return { name: 'playback', id: decodeURIComponent(playback[1]) }
		} catch {
			return { name: 'notFound' }
		}
	}

	return { name: 'notFound' }
}

/** The permalink for a flipbook. The one place its shape is written down. */
export function flipbookPath(id: string): string {
	return `/f/${encodeURIComponent(id)}`
}

/**
 * The drawing tool, empty or opened on a flipbook to remix.
 *
 * A query parameter rather than a route of its own, because it doesn't change what the
 * page *is* — it is the create page either way, with the same URL to reload and the
 * same unsaved-work guard on it. `matchRoute` is a function of the pathname alone and
 * stays that way; the create page reads this for itself.
 */
export function createPath(remixOf?: string | null): string {
	return remixOf ? `/create?remix=${encodeURIComponent(remixOf)}` : '/create'
}

/** Which flipbook the create page was opened on, if any. Null on an empty one. */
export function remixSource(search: string): string | null {
	return new URLSearchParams(search).get('remix')
}

/**
 * Which tab the gallery is on, and the URL for each.
 *
 * Here rather than in the gallery because the boot placeholder draws the toggle too —
 * it stands in for the header while the route is still downloading, and a placeholder
 * that reads the tab from the URL differently to the page it stands in for is a
 * toggle that jumps sides as the page lands.
 */
export function galleryView(search: string): GalleryView {
	return new URLSearchParams(search).get('view') === 'all' ? 'all' : 'featured'
}

export function galleryPath(view: GalleryView): string {
	return view === 'all' ? '/?view=all' : '/'
}

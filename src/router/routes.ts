/**
 * Route matching, as a pure function over the pathname.
 *
 * Four routes, no nesting, no loaders, no data layer — a router library would be
 * more configuration than this is code, and this can be tested without rendering
 * anything.
 */

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

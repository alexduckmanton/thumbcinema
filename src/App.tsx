import { lazy, Suspense, useMemo } from 'react'

import { ErrorBoundary } from './components/ErrorBoundary'
import { RouteShell } from './components/RouteShell'
import { Link, useLocation } from './router/Router'
import { matchRoute } from './router/routes'

/**
 * The drawing tool is ~1 MB of paper.js and only two of the four routes need it, so
 * both are loaded on demand. The gallery — the page most visits land on — never
 * downloads any of it.
 */
const GalleryPage = lazy(() =>
	import('./routes/gallery/GalleryPage').then((m) => ({ default: m.GalleryPage })),
)
const CreatePage = lazy(() =>
	import('./routes/create/CreatePage').then((m) => ({ default: m.CreatePage })),
)
const PlaybackPage = lazy(() =>
	import('./routes/playback/PlaybackPage').then((m) => ({ default: m.PlaybackPage })),
)
const NotFoundPage = lazy(() =>
	import('./routes/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)

export function App() {
	const { pathname } = useLocation()
	const route = useMemo(() => matchRoute(pathname), [pathname])

	return (
		<ErrorBoundary fallback={<Broken />}>
			{/* Keyed on the route, so switching pages mid-load swaps one placeholder for
			    the other rather than leaving the old page's shape up. */}
			<Suspense fallback={<RouteShell key={route.name} route={route} />}>
				{route.name === 'gallery' ? <GalleryPage /> : null}
				{route.name === 'create' ? <CreatePage /> : null}
				{/* Keyed on the id so navigating between two flipbooks tears the engine
				    down and builds a new one, rather than trying to reuse a paper scene
				    that is halfway through loading someone else's artwork. */}
				{route.name === 'playback' ? <PlaybackPage key={route.id} id={route.id} /> : null}
				{route.name === 'notFound' ? <NotFoundPage /> : null}
			</Suspense>
		</ErrorBoundary>
	)
}

function Broken() {
	return (
		<main className="center" style={{ padding: '80px 0', textAlign: 'center' }}>
			<h1>Well, that went wrong.</h1>
			<p>
				Something broke on the way in. <Link to="/">Start again</Link>?
			</p>
		</main>
	)
}

import { lazy, Suspense, useMemo } from 'react'

import { ErrorBoundary } from './components/ErrorBoundary'
import { RouteShell } from './components/RouteShell'
import { Toast } from './components/Toast'
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
		<>
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

			{/*
			 * Outside the boundary and outside Suspense, because it belongs to the tab
			 * rather than to the page: the offline queue publishes on its own schedule
			 * and says so from wherever the reader happens to be, including a route that
			 * is still downloading or one that has fallen over. It is `position: fixed`,
			 * so where it sits in the tree costs nothing.
			 *
			 * `lift` is the one thing it needs told about the page under it: the create
			 * page pins a bar of controls to the bottom of the window, and a toast that
			 * covers the save button is worst exactly when it is saying the save failed.
			 */}
			<Toast lift={route.name === 'create'} />
		</>
	)
}

/**
 * The apology, and the one case where it would be the wrong one.
 *
 * A route is built from chunks that are fetched when it opens, and offline the ones
 * that aren't on the device can't be — most of them are, but paper.js is cached the
 * first time it is actually used rather than in advance (see `docs/offline.md`), so the
 * drawing tool is the page this happens to. "Something broke" is both unhelpful and
 * untrue there: nothing broke, a 210 KB download hasn't happened yet, and the fix is a
 * connection rather than another go.
 *
 * Decided on `navigator.onLine` rather than on the error, which is three different
 * strings in three browsers. It is a weak claim in general — see `online.ts` — but the
 * advice it leads to is right for *any* failure with no connection, so being wrong
 * about the cause costs nothing here.
 */
function Broken() {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) {
		return (
			<main className="center" style={{ padding: '80px 0', textAlign: 'center' }}>
				<h1>Not on this device yet.</h1>
				<p>
					This page needs a piece of the site that hasn&rsquo;t been downloaded. Open it once with a
					connection and it&rsquo;ll be here next time, offline and all.{' '}
					<Link to="/">The gallery</Link> still works.
				</p>
			</main>
		)
	}

	return (
		<main className="center" style={{ padding: '80px 0', textAlign: 'center' }}>
			<h1>Well, that went wrong.</h1>
			<p>
				Something broke on the way in. <Link to="/">Start again</Link>?
			</p>
		</main>
	)
}

import { useCallback, useEffect, useRef } from 'react'

import { Button } from '../../components/Button'
import { AdminToggles } from '../../components/AdminToggles'
import { CreateButton } from '../../components/CreateButton'
import { SiteHeader } from '../../components/SiteHeader'
import { Spinner } from '../../components/Spinner'
import type { GalleryView } from '../../lib/api'
import { Link, navigate, useLocation } from '../../router/Router'
import { flipbookPath } from '../../router/routes'
import { useGallery } from './useGallery'
import { ViewToggle } from './ViewToggle'
import styles from './GalleryPage.module.css'

/** How far from the bottom to start fetching: roughly a screen and a half. */
const PREFETCH_PX = 1200

export function GalleryPage() {
	const { search } = useLocation()
	const view = viewFromSearch(search)

	const { items, loading, exhausted, failed, loadMore, retry, updateItem } = useGallery(view)

	useEffect(() => {
		document.title = 'thumbcinema'
	}, [])

	const changeView = useCallback((next: GalleryView) => {
		// Keep the URL honest so the tab survives a refresh or a shared link.
		// Replace rather than push: the toggle is a filter, not a place.
		navigate(next === 'featured' ? '/' : '/?view=all', { replace: true, preserveScroll: true })
	}, [])

	const sentinel = useInfiniteScroll(loadMore, !loading && !exhausted)

	return (
		<>
			<SiteHeader actionsWrap>
				<ViewToggle view={view} onChange={changeView} />
				<CreateButton />
			</SiteHeader>

			<main className={styles.content}>
				<div className={styles.grid}>
					{items.map((item) => (
						<Link
							key={item.id}
							to={flipbookPath(item.id)}
							className={styles.card}
							style={{ backgroundImage: `url(${item.thumbnail_url})` }}
						>
							{/* The card's only text. Clipped rather than hidden, because
							    without it every link in the grid has no accessible name. */}
							<span className="visuallyHidden">{item.title || 'Untitled flipbook'}</span>

							<AdminToggles
								id={item.id}
								flags={{ featured: item.featured, nsfw: item.nsfw }}
								onChange={(flags) => updateItem(item.id, flags)}
								className={styles.cardAdmin}
							/>
						</Link>
					))}
				</div>

				<div className={styles.foot} ref={sentinel}>
					{loading ? <Spinner className={styles.spinner} label="Loading more flipbooks" /> : null}

					{/* The manual retry: a failed fetch stops the scroll from trying again
					    on its own, so there has to be a way back. */}
					{failed && items.length > 0 ? <Button onClick={retry}>Load more</Button> : null}
				</div>

				{!loading && !items.length && !failed ? (
					<div className={`center ${styles.state}`}>
						<h1>Nothing here yet.</h1>
						<p>
							Be the first &mdash; <Link to="/create">draw something</Link>.
						</p>
					</div>
				) : null}

				{failed && !items.length ? (
					<div className={`center ${styles.state}`}>
						<h1>I definitely meant for this to happen.</h1>
						<p>
							The gallery didn&rsquo;t load.{' '}
							<button type="button" className={styles.retry} onClick={retry}>
								Try again
							</button>
							? Please don&rsquo;t be angry. I&rsquo;m so sorry, oh dear.
						</p>
					</div>
				) : null}
			</main>

			<footer className={styles.footer}>
				<a href="https://alexduckmanton.com/article/thumbcinema" target="_blank" rel="noopener">
					about
				</a>
			</footer>
		</>
	)
}

/**
 * Fetches the next page as the foot of the list comes into view.
 *
 * An IntersectionObserver rather than a throttled scroll handler: it doesn't run on
 * the main thread on every scroll tick, and `rootMargin` expresses "start fetching a
 * screen and a half early" directly instead of as arithmetic on scrollTop.
 */
function useInfiniteScroll(onReach: () => void, enabled: boolean) {
	const target = useRef<HTMLDivElement | null>(null)
	const callback = useRef(onReach)
	callback.current = onReach

	useEffect(() => {
		const element = target.current
		if (!element || !enabled) return

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) callback.current()
			},
			{ rootMargin: `0px 0px ${PREFETCH_PX}px 0px` },
		)

		observer.observe(element)
		return () => observer.disconnect()
	}, [enabled])

	return target
}

function viewFromSearch(search: string): GalleryView {
	return new URLSearchParams(search).get('view') === 'all' ? 'all' : 'featured'
}

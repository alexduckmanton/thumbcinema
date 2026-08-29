import { useCallback, useEffect, useMemo, useRef } from 'react'

import { Button } from '../../components/Button'
import { CreateButton } from '../../components/CreateButton'
import { GALLERY_SKELETON } from '../../components/RouteShell'
import { SiteHeader } from '../../components/SiteHeader'
import { FlipbookCard } from '../../flipbook/card/FlipbookCard'
import { loadPreview } from '../../flipbook/card/preview'
import { useCardGesture } from '../../flipbook/card/useCardGesture'
import type { GalleryView } from '../../lib/api'
import { useOnline } from '../../offline/online'
import { pendingSummary, usePending } from '../../offline/pending'
import { Link, navigate, useLocation } from '../../router/Router'
import { galleryPath, galleryView } from '../../router/routes'
import { useGallery } from './useGallery'
import { ViewToggle } from './ViewToggle'
import styles from './GalleryPage.module.css'

/** How far from the bottom to start fetching: roughly a screen and a half. */
const PREFETCH_PX = 1200

/**
 * The placeholder cards, standing in for a page that's on its way.
 *
 * Twenty. The grid is `auto-fill` at a 320px minimum inside a 1440px maximum, so it is
 * never more than four columns wide or fewer than one, and twenty is a whole number of
 * rows at three of those four — at three columns it is six rows and a pair, which is
 * the one width where the placeholder ends mid-row. Twelve divided by all four and
 * twenty-four does too; twenty is between them because filling the taller screens
 * matters more here than the ragged edge at one width does.
 *
 * Still short of the page size, deliberately. Twenty-four empty cards is a claim about
 * how long the page will be, and the fetch may well come back with three.
 *
 * A list of numbers rather than a count, so each one is keyed by something that is its
 * own rather than by where it happens to sit — and shared with the boot placeholder,
 * which draws this same grid while this file is still downloading. Two counts would
 * mean the cards reshuffle at the handover.
 */
const SKELETON = GALLERY_SKELETON

export function GalleryPage() {
	const { search } = useLocation()
	const view = galleryView(search)

	const { items, loading, exhausted, failed, loadMore, retry, updateItem } = useGallery(view)

	const online = useOnline()

	/*
	 * Flipbooks saved with no connection, at the top of All until they're published.
	 *
	 * All rather than Featured, and it isn't a judgement about them: Featured is a
	 * hand-curated list of rows in a table, and these aren't rows yet. All is
	 * everything else, which is exactly what they are.
	 *
	 * They stay for a moment after they go up — see `PendingStatus` — so the card the
	 * reader is looking at turns solid and becomes a link to the real flipbook rather
	 * than vanishing mid-glance. What that costs is this filter: switch tabs after a
	 * publish and the grid refetches, the real row comes back in the listing, and
	 * without it the same flipbook would be on screen twice.
	 */
	const queued = usePending()
	const shown = useMemo(() => {
		if (view !== 'all') return []
		const listed = new Set(items.map((item) => item.id))
		return queued.filter((entry) => !entry.publishedAs || !listed.has(entry.publishedAs))
	}, [queued, items, view])

	const gesture = useCardGesture()

	useEffect(() => {
		document.title = 'thumbcinema'
	}, [])

	// Fetched now rather than on the first hover, so the first card to be pointed at
	// is no slower than the fiftieth. A failure is nothing to report: `lazy` will ask
	// again, and a gallery whose cards don't play is still a gallery.
	useEffect(() => {
		loadPreview().catch(() => {})
	}, [])

	const changeView = useCallback((next: GalleryView) => {
		// Keep the URL honest so the tab survives a refresh or a shared link.
		// Replace rather than push: the toggle is a filter, not a place.
		navigate(galleryPath(next), { replace: true, preserveScroll: true })
	}, [])

	const sentinel = useInfiniteScroll(loadMore, !loading && !exhausted)

	return (
		<>
			<SiteHeader actionsWrap>
				{/* Featured and All are two views of a listing there is no way to fetch with
				    no connection, so offline the toggle is a control with nothing behind
				    either side of it. The create button stays: it is the one thing here that
				    still works. */}
				{online ? <ViewToggle view={view} onChange={changeView} /> : null}
				<CreateButton />
			</SiteHeader>

			<main className={styles.content}>
				<div className={styles.grid}>
					{shown.map((entry) => (
						<FlipbookCard
							key={entry.book.id}
							item={pendingSummary(entry)}
							gesture={gesture}
							pending={entry.status !== 'published'}
						/>
					))}

					{items.map((item) => (
						<FlipbookCard
							key={item.id}
							item={item}
							gesture={gesture}
							onFlagsChange={(flags) => updateItem(item.id, flags)}
						/>
					))}

					{/* The cards that haven't landed yet, in the grid with the rest so they
					    take the columns the real ones are about to. Nothing moves when a page
					    arrives — the cards were already there and simply take on a drawing. */}
					{loading
						? SKELETON.map((card) => (
								<span
									key={card}
									className={styles.skeleton}
									style={{ '--card': card } as React.CSSProperties}
									aria-hidden
								/>
							))
						: null}
				</div>

				<div className={styles.foot} ref={sentinel}>
					{/* What the spinner used to say. The skeleton above is a picture of a page
					    that isn't here yet and says nothing at all to a screen reader, so the
					    announcement is text — and the region is always mounted, because a live
					    region that appears at the same moment as its own contents is one a
					    reader may never announce. */}
					<p role="status" className="visuallyHidden">
						{loading ? 'Loading flipbooks' : ''}
					</p>

					{/* The manual retry: a failed fetch stops the scroll from trying again
					    on its own, so there has to be a way back. */}
					{failed && items.length > 0 ? <Button onClick={retry}>Load more</Button> : null}
				</div>

				{!loading && !items.length && !shown.length && !failed ? (
					<div className={`center ${styles.state}`}>
						<h1>Nothing here yet.</h1>
						<p>
							Be the first &mdash; <Link to="/create">draw something</Link>.
						</p>
					</div>
				) : null}

				{/*
				 * A gallery is a live listing of somebody else's server, so with no
				 * connection there is nothing to show and no amount of trying again will
				 * change that. Saying so plainly — and pointing at the one thing that does
				 * still work — beats the apology below, which is written for a server that
				 * broke and blames the wrong party here.
				 *
				 * The grid above still stands: anything queued on this device is drawn
				 * whether or not the listing arrived, which is why this doesn't fire when
				 * there is something in it.
				 */}
				{failed && !items.length && !shown.length && !online ? (
					<div className={`center ${styles.state} ${styles.offline}`}>
						<h1>You&rsquo;re offline.</h1>
						<p>
							You can still <Link to="/create">create a flipbook</Link>. It&rsquo;ll publish next
							time you&rsquo;re online.
						</p>
					</div>
				) : null}

				{failed && !items.length && !shown.length && online ? (
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

import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'

import { Button } from '../../components/Button'
import { AdminToggles } from '../../components/AdminToggles'
import { CreateButton } from '../../components/CreateButton'
import { GALLERY_SKELETON } from '../../components/RouteShell'
import { SiteHeader } from '../../components/SiteHeader'
import type { GalleryView } from '../../lib/api'
import { Link, navigate, useLocation } from '../../router/Router'
import { flipbookPath, galleryPath, galleryView } from '../../router/routes'
import { loadPreview } from './preview'
import { type Hover, useCardGesture } from './useCardGesture'
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

/**
 * The preview, in its own chunk.
 *
 * It is a few kilobytes — the renderer, the cache, and `engine/formats.ts` with it —
 * and none of it is needed to draw the grid, but all of it is needed the instant a
 * pointer lands on a card. So the module is asked for as soon as the gallery has
 * mounted and is in memory long before then; `lazy` resolves out of the module cache
 * and the Suspense boundary never shows.
 *
 * The reason it is split at all is `formats.ts`, which the two paper.js routes also
 * import. Left in the entry bundle it would be carried by every visit to every page,
 * including the ones that already have their own copy of it in their chunk.
 */
const FlipbookPreview = lazy(() =>
	loadPreview().then((module) => ({ default: module.FlipbookPreview })),
)

/**
 * The play button's mark: a triangle, or a pair of bars while it is running.
 *
 * Pause rather than stop, because that is what the button does — it leaves the flipbook
 * on the frame it had reached and pressing play again carries on from there. A square
 * promises the drawing is about to go away, and it isn't.
 *
 * Drawn here rather than taken from the sprite because the sprite hasn't got either —
 * play went with the tray it lived in — and because it shouldn't. That sheet is
 * hand-drawn pictures of *things*: a pencil, an eraser, a printer. These are geometric
 * primitives, and they belong with the ↺ and ↻ on the create page, which are live text
 * for the same reason.
 *
 * Both marks are centred on the 12×12 box by their own geometry rather than nudged into
 * place by CSS — the triangle's points average to exactly 6, so the disc needs no
 * per-state offset and there is no rule to keep in step with the markup.
 */
/** Whether `id` is the card currently running. Read twice per card, per render. */
function playingNow(hover: Hover | null, id: string): boolean {
	return hover?.id === id && hover.playing
}

function PlayGlyph({ playing }: { playing: boolean }) {
	return (
		<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">
			{playing ? (
				<>
					<rect x="2.5" y="1.5" width="2.5" height="9" rx="0.5" />
					<rect x="7" y="1.5" width="2.5" height="9" rx="0.5" />
				</>
			) : (
				<path d="M3.5 1.5 L11 6 L3.5 10.5 Z" />
			)}
		</svg>
	)
}

export function GalleryPage() {
	const { search } = useLocation()
	const view = galleryView(search)

	const { items, loading, exhausted, failed, loadMore, retry, updateItem } = useGallery(view)

	const {
		hover,
		handleEnter,
		handleLeave,
		handleCardTouch,
		handlePointerMove,
		handlePointerUp,
		handlePointerCancel,
		handleClick,
		handlePlayDown,
		handlePlayClick,
	} = useCardGesture()

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
				<ViewToggle view={view} onChange={changeView} />
				<CreateButton />
			</SiteHeader>

			<main className={styles.content}>
				<div className={styles.grid}>
					{items.map((item) => (
						/*
						 * The card is three things side by side rather than one inside another:
						 * the link, the flipbook playing over it, and the play button.
						 *
						 * They are siblings because two of them must not be *inside* a link.
						 * A button within an `<a>` is invalid markup — interactive content
						 * can't nest — and, more to the point, iOS treats a press anywhere
						 * inside a link as a press on the link and offers to open it. The one
						 * control that wants a long press has to be somewhere that isn't the
						 * anchor, and this is what that costs: one wrapper.
						 */
						<div key={item.id} className={styles.cell}>
							<Link
								to={flipbookPath(item.id)}
								className={styles.card}
								style={{ backgroundImage: `url(${item.thumbnail_url})` }}
								onPointerEnter={(event) => handleEnter(event, item.id)}
								onPointerLeave={(event) => handleLeave(event, item.id)}
								// Touch only starts a download here — the card is a plain link
								// under a finger, and the gestures are all on the play button.
								// The mouse still plays and scrubs from anywhere on the card.
								onPointerDown={(event) => handleCardTouch(event, item)}
								// Kept as a backstop: a drag that began on the button and ended
								// over the card could otherwise release into a navigation.
								onClick={handleClick}
							>
								{/* The card's only text. Clipped rather than hidden, because
								    without it every link in the grid has no accessible name. */}
								<span className="visuallyHidden">{item.title || 'Untitled flipbook'}</span>
							</Link>

							{/* The flipbook itself, on the card the pointer is on and on no
							    other. The fallback is null because there is nothing to stand
							    in for — the thumbnail is already showing, and it is a picture
							    of this flipbook rather than a picture of an absence. */}
							{hover?.id === item.id ? (
								<Suspense fallback={null}>
									<FlipbookPreview
										source={item}
										originX={hover.originX}
										playing={hover.playing}
										scrubbing={hover.scrubbing}
									/>
								</Suspense>
							) : null}

							{/*
							 * The way in for a finger, which has no hover to play a card with —
							 * and the only one, since under a finger the card is just a link.
							 *
							 * Pressed, it runs the flipbook; dragged off, it hands the flipbook
							 * to the finger and becomes the same scrub the mouse gets. It sits
							 * over the link rather than in it, so holding it is a hold on a
							 * button and iOS offers nothing.
							 *
							 * The label says what the press will do rather than describing a
							 * state, which is how a media control reads out, and is why there
							 * is no `aria-pressed` beside it: two ways of saying one thing is
							 * one of them disagreeing eventually.
							 */}
							<button
								type="button"
								className={styles.play}
								aria-label={`${playingNow(hover, item.id) ? 'Pause' : 'Play'} ${item.title || 'Untitled flipbook'}`}
								onPointerDown={(event) => handlePlayDown(event, item)}
								onPointerMove={handlePointerMove}
								onPointerUp={handlePointerUp}
								onPointerCancel={handlePointerCancel}
								onClick={(event) => handlePlayClick(event, item)}
							>
								<PlayGlyph playing={playingNow(hover, item.id)} />
							</button>

							<AdminToggles
								id={item.id}
								flags={{ featured: item.featured, nsfw: item.nsfw }}
								onChange={(flags) => updateItem(item.id, flags)}
								className={styles.cardAdmin}
							/>
						</div>
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

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AdminToggles } from '../../components/AdminToggles'
import { CreateButton } from '../../components/CreateButton'
import { SiteHeader } from '../../components/SiteHeader'
import { PageNav } from '../../flipbook/components/PageNav'
import { pageVars } from '../../flipbook/pageVars'
import { useFlipbookEngine } from '../../flipbook/useFlipbookEngine'
import { useKeyboardShortcuts } from '../../flipbook/useKeyboardShortcuts'
import { LEGACY_PAGE_SIZE } from '../../flipbook/engine/constants'
import { getFlipbook, getFlipbookData, type Flipbook, pageSizeOf } from '../../lib/api'
import { isTouch } from '../../lib/device'
import {
	discardPending,
	getPending,
	isPendingId,
	type PendingEntry,
	pendingFlipbook,
	usePending,
} from '../../offline/pending'
import { Link, navigate } from '../../router/Router'
import { flipbookPath, galleryPath } from '../../router/routes'
import icons from '../../styles/icons.module.css'
import canvasStyles from '../../flipbook/components/FlipbookCanvas.module.css'
import styles from './PlaybackPage.module.css'
import { usePrint } from './usePrint'
import { useRemixes } from './useRemixes'

/**
 * The remixes, in their own chunk.
 *
 * They bring the gallery's card with them, and a plain import would put it in this
 * route's preload set — fetched in front of the artwork on every visit to every
 * flipbook, to draw a list most flipbooks haven't got. See `RemixList`.
 *
 * Not warmed the way the gallery warms its preview, because there is nothing to be
 * ready for: this is below the fold, it is mounted only once the list has arrived, and
 * the fetch that decides whether it exists at all is slower than the chunk.
 */
const RemixList = lazy(() =>
	import('./RemixList').then((module) => ({ default: module.RemixList })),
)

export interface PlaybackPageProps {
	id: string
}

/**
 * The line under a flipbook that hasn't been published yet.
 *
 * It follows the upload rather than describing the queue: waiting, going up, up — or
 * refused, in the server's own words, because "it didn't work" leaves nothing to do
 * about it. Once it *is* up the offer to discard goes and nothing takes its place —
 * there was a link to the published flipbook here, and it was an invitation to go and
 * look at the drawing already playing six inches above it.
 */
function PendingNote({ entry, onDiscard }: { entry: PendingEntry; onDiscard: () => void }) {
	if (entry.status === 'published') {
		return <p className={styles.pending}>Published, and it&rsquo;s in the gallery now.</p>
	}

	return (
		<p className={styles.pending}>
			{entry.status === 'uploading'
				? 'Publishing this one now…'
				: entry.error
					? `This one couldn’t be published: ${entry.error}`
					: 'Saved on this device. I’ll publish next time you’re online.'}{' '}
			<button type="button" className={styles.discard} onClick={onDiscard}>
				Discard it
			</button>
		</p>
	)
}

/**
 * How many pages have to have arrived before it starts playing.
 *
 * Two — the fewest that can flip. The wait people were sitting through was a whole
 * flipbook being rebuilt behind a blue screen before a single frame of it moved, and
 * on the longest in the archive that is most of a second on a phone. It is decoded
 * in frame-sized slices either way, so the rest of it lands behind the first few
 * frames instead of in front of them. `scheduleFrame` holds the last page it has
 * rather than lapping, so a flipbook can't briefly play as a two-page loop.
 */
const PAGES_BEFORE_PLAY = 2

export function PlaybackPage({ id }: PlaybackPageProps) {
	const { engine, state, canvasRef } = useFlipbookEngine({ mode: 'playback', isTouch })

	const [flipbook, setFlipbook] = useState<Flipbook | null>(null)
	const [ready, setReady] = useState(false)
	const [missing, setMissing] = useState(false)
	const [flags, setFlags] = useState({ featured: false, nsfw: false })

	/** True once the artwork is in hand and pages have started landing in the store. */
	const replaying = useRef(false)

	/*
	 * The queue entry this page is, when it is one.
	 *
	 * `/f/local-…` is a real URL that reloads and can be shared with the person holding
	 * the phone, and everything below treats what comes back from it as an ordinary
	 * flipbook — the artwork is a blob URL, so even the fetch is the same fetch. What is
	 * different is what the page has to *say*: this drawing is on one device, it is going
	 * up when there's a signal, and there is a way to change your mind. See
	 * `docs/offline.md`.
	 *
	 * Read from the live list rather than from the copy loaded below, so the note under
	 * the flipbook follows it up: waiting, uploading, published, or refused with a reason.
	 */
	const queued = usePending().find((entry) => entry.book.id === id) ?? null
	const local = isPendingId(id)

	const { print, container } = usePrint(engine)

	/**
	 * The shape of the page. The metadata carries it, so the frame is right from the
	 * first paint; the store takes over once the artwork has restated it off the file.
	 * The legacy page while neither has arrived, which is what every row without the
	 * columns is.
	 */
	const page = state?.page ?? pageSizeOf(flipbook) ?? LEGACY_PAGE_SIZE

	/*
	 * Throwing a queued flipbook away, which is the one thing you can do to one besides
	 * wait. Asked first, because it is the only copy in the world and there is no
	 * undoing it — and then straight to the gallery, since the page it was asked on is
	 * about to be a flipbook that doesn't exist.
	 */
	const discard = useCallback(() => {
		if (!window.confirm('Throw this flipbook away? It hasn’t been published, so this is it.'))
			return

		void discardPending(id).then(() => navigate(galleryPath('all')))
	}, [id])

	// Everything made from this flipbook — including, when this one is itself a remix,
	// its siblings. The lineage is flat, so every page in a family shows the same list.
	// Never asked for a queued flipbook: it has no lineage until it is a row, and the
	// request would be to a server that by definition isn't answering.
	const remixes = useRemixes(local ? null : (flipbook?.remix_root ?? null))

	/*
	 * The list, minus the flipbook already on the page.
	 *
	 * A remix is in its own lineage, so on its own page it would otherwise be listed
	 * under itself — a card that plays the drawing six inches above it and links to
	 * where you already are. Filtered here rather than in the query because it is a fact
	 * about this page and not about the list: the same request from the original's page
	 * wants every row of it.
	 *
	 * What is *not* here is the root, on the page of a remix of a remix. The lineage is
	 * flat and the root is the one member of it that carries no `remix_root`, so it
	 * isn't in the list — `remix_of` above is the way back up, one step at a time.
	 */
	const family = useMemo(() => remixes.items.filter((item) => item.id !== id), [remixes.items, id])

	useKeyboardShortcuts(engine, { enabled: true, tools: false })

	// Metadata first: it's what names the page, and it tells us which of the two
	// artwork formats to expect.
	useEffect(() => {
		const controller = new AbortController()

		// A queued flipbook is its own metadata: it was made here, and the copy in
		// IndexedDB is the only one there is. No request, which is the point — this page
		// has to work with the radios off.
		if (isPendingId(id)) {
			getPending(id).then((entry) => {
				if (controller.signal.aborted) return
				if (!entry) {
					setMissing(true)
					return
				}

				const found = pendingFlipbook(entry)
				setFlipbook(found)
				document.title = found.title ? `${found.title} — thumbcinema` : 'thumbcinema'
			})

			return () => controller.abort()
		}

		getFlipbook(id, { signal: controller.signal })
			.then((found) => {
				setFlipbook(found)
				setFlags({ featured: found.featured, nsfw: found.nsfw })
				document.title = found.title ? `${found.title} — thumbcinema` : 'thumbcinema'
			})
			.catch(() => {
				if (!controller.signal.aborted) setMissing(true)
			})

		return () => controller.abort()
	}, [id])

	// Then the artwork, once there is both an engine to put it in and a format to
	// read it as. 2012 flipbooks are point lists and get redrawn stroke by stroke;
	// everything since is SVG and is imported.
	useEffect(() => {
		if (!engine || !flipbook) return

		const controller = new AbortController()

		getFlipbookData(flipbook.data_url, { signal: controller.signal })
			.then(async (text) => {
				if (controller.signal.aborted) return

				// Armed before the load rather than after it: what starts playback is
				// the pages arriving in the store, and the first of them land inside
				// this call.
				replaying.current = true

				if (flipbook.format === 'legacy-json') await engine.loadLegacy(text, controller.signal)
				else await engine.loadSvg(text, controller.signal)
			})
			.catch(() => {
				if (!controller.signal.aborted) setMissing(true)
			})

		return () => controller.abort()
	}, [engine, flipbook])

	// A flipbook page plays on arrival — and now on partial arrival. It's an
	// animation; that's the point, and waiting for the last page of a two-hundred
	// page one before showing any of it never was.
	useEffect(() => {
		if (!engine || !state || ready || !replaying.current) return
		if (state.loading && state.pages.length < PAGES_BEFORE_PLAY) return

		setReady(true)
		engine.togglePlay()
	}, [engine, state, ready])

	if (missing) {
		return (
			<>
				<SiteHeader width="narrow">
					<CreateButton />
				</SiteHeader>
				<main className={`center ${styles.missing}`}>
					<h1>This flipbook has wandered off.</h1>
					<p>
						I can&rsquo;t find it anywhere. <Link to="/">Try the gallery</Link>?
					</p>
				</main>
			</>
		)
	}

	return (
		<>
			{/*
			 * The create button, wearing the one label that makes sense on a page that is
			 * already showing you a flipbook: Remix. Same button, same corner, same errand
			 * — the drawing tool — and the only difference is that it opens on this.
			 *
			 * **Optimistic, and that is a deliberate reversal.** It read the format first
			 * and said "New" until the metadata landed, which meant every visit to every
			 * flipbook showed the wrong label and then changed it — barely visible coming
			 * from the gallery, and a long, obvious flip on a refresh, where `RouteShell`
			 * had already been saying "New" for the whole of the route chunk's download.
			 * A label that is right at once for almost everything beats one that is right
			 * eventually for everything: `legacy-json` is 147 of the 585 archive rows and
			 * none of the flipbooks saved since, so the guess is nearly always correct and
			 * settles without moving.
			 *
			 * **Where the guess is wrong the button goes, rather than reverting to "New".**
			 * Reverting would be the same flash again with the labels swapped. Those pages
			 * still reach the drawing tool through the wordmark and the gallery behind it.
			 *
			 * Being wrong is safe, which is what makes the guess affordable: press Remix
			 * on a 2012 flipbook before the format arrives and `useRemixSource` refuses it,
			 * says so, and leaves a blank flipbook — and the server drops the link too, so
			 * nothing can be saved claiming a parent it isn't allowed.
			 */}
			<SiteHeader width="narrow">
				{/* No remixing a queued flipbook. A remix is stored as a link to a row that
				    doesn't exist yet, and the drawing tool opens one by fetching it — so
				    the button offers the other thing it does instead, which is a new
				    flipbook. Once this is published it is an ordinary flipbook on an
				    ordinary page with an ordinary Remix button. */}
				{local ? (
					<CreateButton />
				) : flipbook?.format === 'legacy-json' ? null : (
					<CreateButton remixOf={id} />
				)}
			</SiteHeader>

			<main className={styles.content} style={pageVars(page) as React.CSSProperties}>
				<div className="center">
					<div className={canvasStyles.book}>
						{/* The canvas is the whole drawable area — twice the page in each
						    direction — and `.sheet` is the page-shaped hole it is seen through.
						    Playback never draws, but it shares the scene with the create page and
						    so shares its coordinate space. */}
						<div className={canvasStyles.sheet}>
							<canvas ref={canvasRef} className={canvasStyles.canvas} />
						</div>

						{/* The flipbook, before it is one. Nothing to say to a screen reader —
						    it's a picture of an absence — so the announcement is text, in a
						    region that is always mounted: one that appears at the same moment
						    as its own contents is one a reader may never announce. */}
						{ready ? null : <div className={canvasStyles.skeleton} aria-hidden="true" />}
					</div>

					<p role="status" className="visuallyHidden">
						{ready ? '' : 'Loading flipbook'}
					</p>

					{/* The create page's page bar, on the flipbook you are watching, at every
					    width — and the only play button either page has left. */}
					{engine && state ? (
						<PageNav
							engine={engine}
							activePage={state.activePage}
							pages={state.pages.length}
							playback={state.playback}
							// Empty until the flipbook is one — see `.waiting`. `ready` rather
							// than `state.loading`: the rest of a long flipbook goes on landing
							// for a while after it starts playing, and the bar is telling the
							// truth about the pages it has by then.
							waiting={!ready}
						/>
					) : null}

					{/*
					 * What this page has to say about the flipbook, and the two things you
					 * can do to it, in one row under the bar.
					 *
					 * There was a tray here — the create page's row of controls, carrying
					 * print, play, circleplay and the admin toggles. Play is the handle above
					 * and circleplay is gone, which left a full-width bar of chrome holding
					 * one printer icon. Print stands next to the title instead, which is
					 * where the rest of what this page can do already was.
					 */}
					{flipbook ? (
						<div className={styles.info}>
							<div className={styles.text}>
								<div className={styles.heading}>
									<h2>{flipbook.title}</h2>
									<h3 className={styles.byline}>{flipbook.byline}</h3>

									{/* What this was drawn on top of. The *direct* parent rather
									    than the head of the chain, so it names the flipbook that
									    was actually open in the drawing tool — the list below is
									    the flat one, and the two answer different questions.

									    A remix of an archive piece can point at a row that was
									    recovered without a title, hence the fallback: the link has
									    to go somewhere either way. */}
									{flipbook.remix_of ? (
										<p className={styles.lineage}>
											Remixed from{' '}
											<Link to={flipbookPath(flipbook.remix_of.id)}>
												{flipbook.remix_of.title || 'an untitled flipbook'}
											</Link>
										</p>
									) : null}
								</div>
								<p className={styles.description}>{flipbook.description}</p>

								{/* What is actually going on with this one, which is the whole
								    reason a queued flipbook has a page of its own rather than just
								    a faded card in the grid. */}
								{queued ? <PendingNote entry={queued} onDiscard={discard} /> : null}
							</div>

							{/* Both of these render nothing most of the time — the toggles unless
							    you hold the admin token, print unless there is a printer worth
							    offering. An empty box, and the title takes the width. */}
							<div className={styles.aside}>
								{/* Nothing to moderate on a flipbook that isn't published, and the
								    PATCH would be to a row that doesn't exist. */}
								{local ? null : <AdminToggles id={flipbook.id} flags={flags} onChange={setFlags} />}

								{/* Printing lays the flipbook out as a cut-and-staple booklet.
								    There is no useful touch equivalent, so it isn't offered there. */}
								{isTouch ? null : (
									<button type="button" className={styles.print} title="Print" onClick={print}>
										<span className={icons.print} aria-hidden="true" />
										<span className="visuallyHidden">Print</span>
									</button>
								)}
							</div>
						</div>
					) : null}

					{/*
					 * What people have made from this one.
					 *
					 * The gallery's card, which is the whole reason it moved out of the
					 * gallery: a remix is an ordinary flipbook and this is an ordinary list
					 * of them, so it hovers, plays and scrubs here exactly as it does there.
					 * Its own `useCardGesture` rather than the grid's, because there isn't
					 * one — and one instance drives one list.
					 *
					 * Absent rather than empty when there is nothing: most flipbooks have no
					 * remixes and a permanent "Remixes (0)" heading on every page in the
					 * archive is a feature announcing itself on 585 pages that don't use it.
					 * A failed fetch lands here too, deliberately — see `useRemixes`.
					 *
					 * No admin toggles on these. They are on the cards in the grid and on the
					 * flipbook above, which is every route to a flipbook that needs
					 * moderating; a third copy on a card that is also on the home page is a
					 * second place to keep the same two switches in step.
					 */}
					{/*
					 * Absent rather than empty when there is nothing: most flipbooks have no
					 * remixes, and a permanent "Remixes" heading on every page in the archive
					 * is a feature announcing itself on 585 pages that don't use it. A failed
					 * fetch lands here too, deliberately — see `useRemixes`.
					 *
					 * The fallback is null because there is nothing to stand in for. The list
					 * was not on the page a moment ago and nothing below it moves when it
					 * arrives, so a placeholder would be a box appearing in order to be
					 * replaced by a box.
					 */}
					{family.length > 0 ? (
						<Suspense fallback={null}>
							<RemixList items={family} more={remixes.more} onLoadMore={remixes.loadMore} />
						</Suspense>
					) : null}
				</div>
			</main>

			<div className={styles.printRoot} ref={container} aria-hidden="true" />
		</>
	)
}

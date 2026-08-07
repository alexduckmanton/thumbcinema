import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { AdminToggles } from '../../components/AdminToggles'
import { CreateButton } from '../../components/CreateButton'
import { SiteHeader } from '../../components/SiteHeader'
import { PageNav } from '../../flipbook/components/PageNav'
import { useFlipbookEngine } from '../../flipbook/useFlipbookEngine'
import { useKeyboardShortcuts } from '../../flipbook/useKeyboardShortcuts'
import { getFlipbook, getFlipbookData, type Flipbook } from '../../lib/api'
import { isTouch } from '../../lib/device'
import { Link } from '../../router/Router'
import { flipbookPath } from '../../router/routes'
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

	const { print, container } = usePrint(engine)

	// Everything made from this flipbook — including, when this one is itself a remix,
	// its siblings. The lineage is flat, so every page in a family shows the same list.
	const remixes = useRemixes(flipbook?.remix_root ?? null)

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
			 * Not offered on the 2012 flipbooks. Those are point lists rather than paths
			 * and only come back through the pencil, so what the tool could open is a
			 * resampled copy rather than the artwork; a button that quietly handed you
			 * something slightly different from what you were looking at is worse than no
			 * button. They go on playing and printing here exactly as before. While the
			 * metadata is still in flight the format is unknown, so it says New — which is
			 * true, and is what it would have said a moment ago anyway.
			 */}
			<SiteHeader width="narrow">
				<CreateButton remixOf={flipbook && flipbook.format !== 'legacy-json' ? id : undefined} />
			</SiteHeader>

			<main className={styles.content}>
				<div className="center">
					<div className={canvasStyles.book}>
						<canvas ref={canvasRef} className={canvasStyles.canvas} />

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
							</div>

							{/* Both of these render nothing most of the time — the toggles unless
							    you hold the admin token, print unless there is a printer worth
							    offering. An empty box, and the title takes the width. */}
							<div className={styles.aside}>
								<AdminToggles id={flipbook.id} flags={flags} onChange={setFlags} />

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

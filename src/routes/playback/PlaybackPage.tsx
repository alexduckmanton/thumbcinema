import { useEffect, useRef, useState } from 'react'

import { CreateButton } from '../../components/CreateButton'
import { SiteHeader } from '../../components/SiteHeader'
import { Spinner } from '../../components/Spinner'
import { PlaybackTray } from '../../flipbook/components/PlaybackTray'
import { useFlipbookEngine } from '../../flipbook/useFlipbookEngine'
import { useKeyboardShortcuts } from '../../flipbook/useKeyboardShortcuts'
import { getFlipbook, getFlipbookData, type Flipbook } from '../../lib/api'
import { isTouch } from '../../lib/device'
import { Link } from '../../router/Router'
import canvasStyles from '../../flipbook/components/FlipbookCanvas.module.css'
import styles from './PlaybackPage.module.css'
import { usePrint } from './usePrint'

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
			<SiteHeader width="narrow">
				<CreateButton />
			</SiteHeader>

			<main className={styles.content}>
				<div className="center">
					<div className={canvasStyles.book}>
						<canvas ref={canvasRef} className={canvasStyles.canvas} />

						{/* Somewhere to circle that isn't the flipbook. See `.scrub`. */}
						{isTouch && state?.playback === 'circleplay' ? (
							<div className={canvasStyles.scrub} aria-hidden="true" />
						) : null}

						{ready ? null : (
							<div className={canvasStyles.overlay}>
								<Spinner label="Loading flipbook" />
							</div>
						)}
					</div>

					{engine && state && flipbook ? (
						<PlaybackTray
							engine={engine}
							state={state}
							id={flipbook.id}
							title={flipbook.title ?? ''}
							views={flipbook.views}
							flags={flags}
							onFlagsChange={setFlags}
							onPrint={print}
						/>
					) : null}

					{flipbook ? (
						<div className={styles.info}>
							<div className={styles.heading}>
								<h2>{flipbook.title}</h2>
								<h3 className={styles.byline}>{flipbook.byline}</h3>
							</div>
							<p className={styles.description}>{flipbook.description}</p>
						</div>
					) : null}
				</div>
			</main>

			<div className={styles.printRoot} ref={container} aria-hidden="true" />
		</>
	)
}

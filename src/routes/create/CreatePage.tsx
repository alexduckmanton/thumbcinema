import { useCallback, useEffect, useState } from 'react'

import { Button } from '../../components/Button'
import { SiteHeader } from '../../components/SiteHeader'
import { Spinner } from '../../components/Spinner'
import { CreateTray } from '../../flipbook/components/CreateTray'
import { PageStrip } from '../../flipbook/components/PageStrip'
import { SaveForm, type SaveFormValues } from '../../flipbook/components/SaveForm'
import { useFlipbookEngine } from '../../flipbook/useFlipbookEngine'
import { useKeyboardShortcuts } from '../../flipbook/useKeyboardShortcuts'
import { ApiError, saveFlipbook } from '../../lib/api'
import { canDraw, isTouch } from '../../lib/device'
import { registerMessage, showMessage } from '../../lib/messages'
import { guardNavigation, navigate } from '../../router/Router'
import canvasStyles from '../../flipbook/components/FlipbookCanvas.module.css'
import styles from './CreatePage.module.css'
import { Recovery } from './Recovery'
import { useCrashRecovery } from './useCrashRecovery'

type Phase = 'drawing' | 'naming' | 'sending'

export function CreatePage() {
	const { engine, state, canvasRef } = useFlipbookEngine({ mode: 'create', isTouch })
	const [phase, setPhase] = useState<Phase>('drawing')

	const crash = useCrashRecovery(engine)

	useEffect(() => {
		document.title = 'create — thumbcinema'
	}, [])

	// Phones were always turned away: the canvas needs a real pointer and some room.
	useEffect(() => {
		if (!canDraw) navigate('/', { replace: true })
	}, [])

	// Shortcuts are off while the form is up, so typing a title doesn't switch tools.
	useKeyboardShortcuts(engine, { enabled: phase === 'drawing', tools: true })

	const pages = state?.pages.length ?? 1
	useUnsavedWarning(pages > 1 && phase !== 'sending')

	const handleSave = useCallback(
		async (values: SaveFormValues) => {
			if (!engine) return
			setPhase('sending')

			try {
				// A beat before the work starts, so the wash is painted before the main
				// thread disappears into serialising a large drawing.
				await nextPaint()
				const { svg, thumbnailDataUrl } = engine.exportForSave()

				const location = await saveFlipbook({
					title: values.title,
					description: values.description,
					svg,
					thumbnailDataUrl,
					nsfw: values.nsfw,
				})

				// Left for the page we're about to land on.
				registerMessage({
					copy: "Nice one! Your flipbook's saved. Give yourself a pat on the back.",
					cta: "Don't mind if I do",
					type: 'success',
				})

				// A full load rather than a client-side navigation: the drawing tool has
				// a paper.js scene, a megabyte of artwork and an unsaved-work guard
				// attached to this document, and none of it should follow us.
				window.location.href = location
			} catch (error) {
				setPhase('naming')

				const message =
					error instanceof ApiError && error.status === 413
						? 'That flipbook is too big to save. Try deleting a few pages.'
						: "Oh no! Something went wrong and I couldn't save your flipbook. Try again."

				showMessage({ copy: message, cta: 'Dang', type: 'error' })
			}
		},
		[engine],
	)

	const contentClass = [
		styles.content,
		phase === 'drawing' ? '' : styles.naming,
		phase === 'sending' ? styles.sending : '',
	]
		.filter(Boolean)
		.join(' ')

	return (
		<>
			<SiteHeader width="narrow" />

			<main className={contentClass}>
				{engine && state ? (
					<PageStrip
						engine={engine}
						pages={state.pages}
						activePage={state.activePage}
						playing={state.playback !== 'none'}
						animating={state.busy}
						arriving={state.arriving}
						canvasRef={canvasRef}
					/>
				) : null}

				<div className="center">
					<div className={canvasStyles.book}>
						<canvas ref={canvasRef} className={canvasStyles.canvas} />

						{state?.loading ? (
							<div className={canvasStyles.overlay}>
								<h2>Restoring your flipbook</h2>
								<Spinner label="" />
							</div>
						) : null}

						{phase === 'sending' ? (
							<div className={`${canvasStyles.overlay} ${canvasStyles.sending}`}>
								<Spinner label="Saving" />
							</div>
						) : null}

						{phase !== 'drawing' ? <div className={canvasStyles.wash} aria-hidden="true" /> : null}

						{phase !== 'drawing' ? (
							<SaveForm
								saving={phase === 'sending'}
								onSave={(values) => void handleSave(values)}
								onCancel={() => setPhase('drawing')}
							/>
						) : null}
					</div>

					{engine && state ? (
						<CreateTray engine={engine} state={state} stowed={phase !== 'drawing'} />
					) : null}

					<div className={pages > 1 ? styles.save : `${styles.save} ${styles.noSave}`}>
						<Button onClick={() => setPhase('naming')} disabled={pages < 2}>
							Save flipbook
						</Button>
					</div>
				</div>
			</main>

			{crash.crashed ? <Recovery saved={crash.saved} /> : null}
		</>
	)
}

const WARNING = "Whoa, you haven't saved your flipbook yet. Leave and you'll lose it."

/** Module scope, so the effect below doesn't see a new function on every render. */
const askBeforeLeaving = () => window.confirm(WARNING)

/** Marks the spare history entry the back guard leaves behind. See below. */
const SPARE = 'tc:unsaved'

/**
 * The "you haven't saved this" prompt, on all three ways out.
 *
 * One page is a drawing, not a flipbook, so it doesn't count as work worth warning
 * about — which is exactly where 2013 drew the line too. What has changed since is
 * that this is one document now: in 2013 the logo and the back button both left the
 * page for real and `beforeunload` caught them both, and here neither one does.
 *
 *  - Reloading and closing the tab: `beforeunload`, and the browser's own wording.
 *  - The logo, and any other `<Link>`: the router asks the guard first.
 *  - Back: see below. It can't be cancelled, so it's answered rather than stopped.
 */
function useUnsavedWarning(enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return

		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			// Browsers show their own wording now; the string is only for very old ones.
			event.returnValue = WARNING
		}

		window.addEventListener('beforeunload', onBeforeUnload)
		const release = guardNavigation(askBeforeLeaving)

		/*
		 * Back, which can't be stopped — by the time `popstate` fires the entry it came
		 * from is already gone. So instead of stopping it, this leaves a spare entry on
		 * the stack for the same URL. Back lands on the spare: same route, same
		 * component, nothing re-rendered and nothing lost, which is the moment there's
		 * something to ask about. Stay, and the spare goes back on ready for the next
		 * press; leave, and one more step back reaches where they were headed.
		 *
		 * It costs an extra history entry, and a forward button with somewhere to go,
		 * for as long as the drawing is unsaved. A trackpad swipe costing an afternoon's
		 * work costs more.
		 */

		// Read before the spare is pushed: a tab opened straight on /create has nothing
		// behind it, and saying "you're leaving" and then not leaving is worse than not
		// asking at all.
		const canGoBack = window.history.length > 1

		// Marked, so that deleting back down to one page and drawing a second again
		// doesn't stack up a fresh spare every time the guard comes back on.
		const pushSpare = () => {
			if (window.history.state?.[SPARE]) return
			window.history.pushState({ ...window.history.state, [SPARE]: true }, '', window.location.href)
		}

		pushSpare()
		let leaving = false

		const onPopState = () => {
			if (leaving) return

			if (!askBeforeLeaving()) {
				pushSpare()
				return
			}

			leaving = true
			// Released first, or going home would ask a second time.
			release()
			if (canGoBack) window.history.back()
			else navigate('/')
		}

		window.addEventListener('popstate', onPopState)

		return () => {
			window.removeEventListener('beforeunload', onBeforeUnload)
			window.removeEventListener('popstate', onPopState)
			release()
		}
	}, [enabled])
}

function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	})
}

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
import { navigate } from '../../router/Router'
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

/**
 * The "you haven't saved this" prompt.
 *
 * One page is a drawing, not a flipbook, so it doesn't count as work worth warning
 * about — which is exactly where 2013 drew the line too.
 */
function useUnsavedWarning(enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return

		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			// Browsers show their own wording now; the string is only for very old ones.
			event.returnValue = "Whoa, you haven't saved your flipbook yet."
		}

		window.addEventListener('beforeunload', onBeforeUnload)
		return () => window.removeEventListener('beforeunload', onBeforeUnload)
	}, [enabled])
}

function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	})
}

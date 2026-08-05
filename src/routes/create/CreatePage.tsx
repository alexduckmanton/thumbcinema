import { useCallback, useEffect, useRef, useState } from 'react'

import { SiteHeader } from '../../components/SiteHeader'
import { Spinner } from '../../components/Spinner'
import { CreateTray } from '../../flipbook/components/CreateTray'
import { InkCursor } from '../../flipbook/components/InkCursor'
import { PageNav } from '../../flipbook/components/PageNav'
import { PageStrip } from '../../flipbook/components/PageStrip'
import { SaveForm, type SaveFormValues } from '../../flipbook/components/SaveForm'
import type { FlipbookEngine, FlipbookState } from '../../flipbook/engine/FlipbookEngine'
import { settledPageCount } from '../../flipbook/engine/pages'
import { useFlipbookEngine } from '../../flipbook/useFlipbookEngine'
import { useKeyboardShortcuts } from '../../flipbook/useKeyboardShortcuts'
import { ApiError, saveFlipbook } from '../../lib/api'
import { isTouch } from '../../lib/device'
import { refuseMultiTouch } from '../../lib/zoom'
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

	/*
	 * Everywhere a finger may aim from, which is the whole page rather than the drawing.
	 *
	 * The cursor is nudged rather than placed — see `PointerLayer` — so it doesn't care
	 * where the nudge comes from, and on a phone the band of white under the tools is
	 * where a thumb already is and is the only part of this page nothing else wants.
	 * Controls standing on it keep their own touches.
	 */
	const field = useRef<HTMLElement | null>(null)

	const crash = useCrashRecovery(engine)

	useEffect(() => {
		document.title = 'create — thumbcinema'
	}, [])

	// Everything but the naming form, which has fields in it a finger may want to pan.
	useNoScrolling(phase !== 'naming')

	// Shortcuts are off while the form is up, so typing a title doesn't switch tools.
	useKeyboardShortcuts(engine, { enabled: phase === 'drawing', tools: true })

	// Not the raw length: a page on its way off the screen is still in the list, and
	// counting it makes the save button fade in and straight back out again.
	const pages = state ? settledPageCount(state.pages) : 1
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
			{/* No create button — you are already here. What goes up there instead is
			    undo and redo, on the desktop layout only; see `UndoRedo`.

			    Not offered while the save form is up: everything else on the page has
			    either flown away or gone under the wash, and a live undo button up in the
			    corner is the one control still able to change a drawing nobody can see.
			    The footer's copy leaves with the footer; this one has nowhere to go, so it
			    dims instead — which is what `.step:disabled` already says. */}
			<SiteHeader width="narrow">
				<UndoRedo
					engine={engine}
					state={phase === 'drawing' ? state : null}
					className={styles.historyTop}
				/>
			</SiteHeader>

			<main className={contentClass} ref={field}>
				{engine && state ? (
					<PageStrip
						engine={engine}
						pages={state.pages}
						activePage={state.activePage}
						playing={state.playback !== 'none'}
						arriving={state.arriving}
						canvasRef={canvasRef}
					/>
				) : null}

				<div className="center">
					<div className={canvasStyles.book}>
						<canvas
							ref={canvasRef}
							className={
								state?.arriving
									? `${canvasStyles.canvas} ${canvasStyles.handedOver}`
									: canvasStyles.canvas
							}
						/>

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

						{/* The ring that says what the stroke will be, or the shape that says
						    what the transform tool would grab. Inside `.book` because both are
						    measured against the drawing rather than the window. */}
						{state && phase === 'drawing' ? (
							<InkCursor engine={engine} canvasRef={canvasRef} tool={state.tool} fieldRef={field} />
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

					{engine && state && phase === 'drawing' ? (
						<PageNav
							engine={engine}
							activePage={state.activePage}
							pages={pages}
							playback={state.playback}
							// A crashed drawing being replayed arrives a page at a time exactly
							// as a saved one does, so the bar waits the same way. Empty on a
							// fresh page too, and there is nothing to say about a flipbook of
							// one page anyway.
							waiting={state.loading}
						/>
					) : null}

					{engine && state ? (
						<CreateTray engine={engine} state={state} stowed={phase !== 'drawing'} />
					) : null}

					<div className={styles.footer}>
						{/* The phone's copy, at the far end of the bar from save. */}
						<UndoRedo engine={engine} state={state} className={styles.history} />

						<div className={pages > 1 ? styles.save : `${styles.save} ${styles.noSave}`}>
							<button
								type="button"
								className={styles.saveButton}
								onClick={() => setPhase('naming')}
								disabled={pages < 2}
							>
								<span className={styles.saveLabel}>Save</span>
							</button>
						</div>
					</div>
				</div>
			</main>

			{crash.crashed ? <Recovery saved={crash.saved} /> : null}
		</>
	)
}

/**
 * Undo and redo, as a pair, in whichever of the page's two corners this layout keeps
 * them: the bottom left on a phone, next to the wordmark on a desktop.
 *
 * Rendered in both places and hidden in one, which is the whole of how it moves. The
 * two corners are in different parts of the tree — one is the site header's actions
 * slot, the other is a bar pinned to the bottom of the window — and there is no
 * arrangement of CSS that carries one box between them. Two copies with `display: none`
 * on the wrong one costs a few elements and leaves exactly one pair in the
 * accessibility tree at any width, which is the thing that actually matters.
 *
 * Why it is up there at all on a desktop, when 2013 offered no undo and this page's
 * first version offered it only on a phone: ⌘Z is genuinely the shortcut a hand on a
 * keyboard reaches for, but a fifty-step history that nothing on the screen mentions is
 * a feature people find out about by accident. The buttons say it exists. They go at the
 * top because the bottom of this column is the save button's, and undo standing next to
 * save is the pair of buttons you least want to confuse.
 */
function UndoRedo({
	engine,
	state,
	className,
}: {
	engine: FlipbookEngine | null
	state: FlipbookState | null
	className: string | undefined
}) {
	return (
		<div className={className}>
			<StepButton
				label="Undo"
				glyph="↺"
				hint="Undo (⌘Z)"
				enabled={state?.canUndo ?? false}
				onPress={() => engine?.undo()}
			/>
			<StepButton
				label="Redo"
				glyph="↻"
				hint="Redo (⇧⌘Z)"
				enabled={state?.canRedo ?? false}
				onPress={() => engine?.redo()}
			/>
		</div>
	)
}

/**
 * One step back or forward: a white disc the height of the save button, wearing a
 * Pecita glyph.
 *
 * Written in the wordmark's hand rather than taken from the icon sheet, because the
 * sheet is drawings of *things* — a pencil, an eraser, a page — and these two are not
 * things. ↺ and ↻ are letters as far as this font is concerned, so they are set as
 * text: one face, one weight, and nothing to redraw at 2×.
 */
function StepButton({
	label,
	glyph,
	hint,
	enabled,
	onPress,
}: {
	label: string
	glyph: string
	hint: string
	enabled: boolean
	onPress: () => void
}) {
	return (
		<button
			type="button"
			className={styles.step}
			title={hint}
			disabled={!enabled}
			onClick={onPress}
		>
			<span className={styles.stepGlyph} aria-hidden="true">
				{glyph}
			</span>
			<span className="visuallyHidden">{label}</span>
		</button>
	)
}

/**
 * The document holds still while the drawing tool is up: no scroll, no bounce, no pull
 * to refresh, no pinch.
 *
 * The create page has never had anywhere to scroll *to* — `--book-reserve` sizes the
 * drawing around everything else in the column precisely so it doesn't, because a page
 * that scrolls while you draw on it is a page that has taken the stroke away from you.
 * What it did still have was the rubber band, and the whole drawing sliding an inch
 * under your finger on a stroke that started near the bottom edge; and a pull far enough
 * to reload the tab, which on an unsaved flipbook is the worst outcome this page has.
 *
 * Both of those got much easier to reach the moment the empty band under the tools
 * became somewhere to drag. What the class does, and why it takes four properties to do
 * it, is in `base.css`.
 *
 * Off while the save form is up, which is the one time this page has fields in it: a
 * long description in a small textarea has to be pannable, and `touch-action: none` on
 * an ancestor cannot be given back by a descendant. Nothing is lost by it — the drawing
 * tool is behind the wash by then, and `beforeunload` is already guarding the reload.
 */
function useNoScrolling(enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return

		document.documentElement.classList.add('locked')
		// And the one thing CSS can't say on iOS, where `touch-action` does not reach page
		// zoom and cancelling the gesture events turns out not to be the whole answer.
		const release = refuseMultiTouch()

		return () => {
			document.documentElement.classList.remove('locked')
			release()
		}
	}, [enabled])
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

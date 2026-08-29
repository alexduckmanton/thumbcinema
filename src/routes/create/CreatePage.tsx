import { useCallback, useEffect, useRef, useState } from 'react'

import { SiteHeader } from '../../components/SiteHeader'
import { Spinner } from '../../components/Spinner'
import { useToolLayout } from '../../components/toolLayout'
import { DrawModeSwitch } from '../../flipbook/components/DrawModeSwitch'
import { AimPad } from '../../flipbook/components/AimPad'
import { InkCursor } from '../../flipbook/components/InkCursor'
import { ZoomStage, ZoomWindow } from '../../flipbook/components/ZoomStage'
import { PageHandle } from '../../flipbook/components/PageHandle'
import { PageNav } from '../../flipbook/components/PageNav'
import { PageStrip } from '../../flipbook/components/PageStrip'
import { SaveForm, type SaveFormValues } from '../../flipbook/components/SaveForm'
import { ToolPanel } from '../../flipbook/components/ToolPanel'
import type { FlipbookEngine } from '../../flipbook/engine/FlipbookEngine'
import { settledPageCount } from '../../flipbook/engine/pages'
import {
	isZoomStageMode,
	stageOnPaper,
	startingZoom,
	useDrawMode,
	usesAimPad,
} from '../../flipbook/drawModes'
import { TraceLayer } from '../../flipbook/trace/TraceLayer'
import { TraceMenu } from '../../flipbook/trace/TraceMenu'
import { useTracePhoto } from '../../flipbook/trace/useTracePhoto'
import { usePointerLayer } from '../../flipbook/usePointerLayer'
import { useStage } from '../../flipbook/zoomStage'
import { useFlipbookEngine } from '../../flipbook/useFlipbookEngine'
import { useKeyboardShortcuts } from '../../flipbook/useKeyboardShortcuts'
import { SETTLE_MS } from '../../flipbook/engine/reorder'
import { usePageReorder } from '../../flipbook/usePageReorder'
import { ApiError, getFlipbook, getFlipbookData, saveFlipbook } from '../../lib/api'
import { isTouch } from '../../lib/device'
import { refuseMultiTouch } from '../../lib/zoom'
import { registerMessage, showMessage } from '../../lib/messages'
import { guardNavigation, navigate, useLocation } from '../../router/Router'
import { remixSource } from '../../router/routes'
import canvasStyles from '../../flipbook/components/FlipbookCanvas.module.css'
import styles from './CreatePage.module.css'
import { Recovery } from './Recovery'
import { useCrashRecovery } from './useCrashRecovery'

type Phase = 'drawing' | 'naming' | 'sending'

export function CreatePage() {
	const { engine, state, canvasRef } = useFlipbookEngine({ mode: 'create', isTouch })
	const [phase, setPhase] = useState<Phase>('drawing')
	/** The trace photo's remove/replace/edit sheet, which is up or it isn't. */
	const [traceMenu, setTraceMenu] = useState(false)

	// Which flipbook this is being drawn on top of, if any. Read off the URL rather
	// than held in state, so a reload lands on the same flipbook rather than an empty
	// page — which is also what makes the crash recovery reload work.
	const { search } = useLocation()
	const asked = remixSource(search)

	// Which answer to "a finger is opaque" is switched on. Scaffolding: see
	// `drawModes.ts` for the list of them, and `DrawModeSwitch` for how one is picked.
	const drawMode = useDrawMode()

	/*
	 * Everywhere a finger may aim from, which in the default mode is the whole page
	 * rather than the drawing.
	 *
	 * The cursor is nudged rather than placed — see `PointerLayer` — so it doesn't care
	 * where the nudge comes from, and on a phone the band of white under the tools is
	 * where a thumb already is and is the only part of this page nothing else wants.
	 * Controls standing on it keep their own touches. The modes that mark at the fingertip
	 * ignore this and keep to the drawing; the layer decides, not this file.
	 */
	const field = useRef<HTMLElement | null>(null)

	/*
	 * The one `PointerLayer` this page has, which two canvases now read.
	 *
	 * It used to be built inside `InkCursor`, which was right while the cursor was the
	 * only thing that needed it. v11 puts a second drawing surface on the page with a
	 * cursor of its own, and two components cannot each own the object that decides what
	 * a finger means.
	 */
	const layer = usePointerLayer({
		engine,
		canvasRef,
		mode: drawMode,
		tool: state?.tool ?? null,
		fieldRef: field,
	})

	/*
	 * v12: the zoomed stage stands in the paper's place rather than in the band below.
	 *
	 * `onPaper` is the mode's answer and `staged` is whether it actually got a stage —
	 * the stylesheet hides it above the breakpoint and a phone held sideways has no room,
	 * either of which puts the mode back to v2 and the live canvas back on screen. One
	 * measurement, read here for the layout and in `PointerLayer` for the gestures.
	 */
	const onPaper = stageOnPaper(drawMode)
	const staged = useStage().view !== null && onPaper

	const crash = useCrashRecovery(engine, asked)

	// What a save will actually be attributed to: the recovery file's answer when there
	// was one to restore, the URL's otherwise. See `useCrashRecovery`.
	const remixOf = crash.remixOf

	useEffect(() => {
		document.title = 'create — thumbcinema'
	}, [])

	const remixLoaded = useRemixSource(engine, crash.decided && !crash.restored ? asked : null)

	// Everything but the naming form, which has fields in it a finger may want to pan.
	useNoScrolling(phase !== 'naming')

	// Shortcuts are off while the form is up, so typing a title doesn't switch tools —
	// and off while the trace photo's sheet is up, which is a question being asked and
	// not a moment to be adding pages behind it.
	useKeyboardShortcuts(engine, { enabled: phase === 'drawing' && !traceMenu, tools: true })

	// Not the raw length: a page on its way off the screen is still in the list, and
	// counting it makes the save button fade in and straight back out again.
	const pages = state ? settledPageCount(state.pages) : 1

	/*
	 * A remix that has been opened and not yet drawn on is not work, and warning about
	 * it is a false alarm at the exact moment somebody is most likely to change their
	 * mind: press Remix, look at it in the tool, press back.
	 *
	 * `canUndo` is what tells the two apart, and it is exact rather than approximate.
	 * `loadSvg` clears the history, so a freshly-opened remix has nothing to undo and
	 * anything at all done to it — a stroke, a page, a nudge — puts a step on the stack.
	 * It reads as a proxy and isn't one: "the drawing has been changed since it was
	 * loaded" is precisely what an undo stack with something in it means.
	 *
	 * It is asked only of a remix. Crash-recovered work has an empty history too — the
	 * same `loadSvg` cleared it — and that genuinely is unsaved work, which is the whole
	 * reason it was recovered.
	 */
	const untouchedRemix = remixLoaded && !state?.canUndo
	useUnsavedWarning(pages > 1 && phase !== 'sending' && !untouchedRemix)

	/*
	 * The camera, and the photograph it took.
	 *
	 * The photo itself belongs to the engine — which page it is on, where it is standing,
	 * whether it is in hand, and how undo puts it back are all page questions, and the
	 * engine is the only thing that can answer them. See `FlipbookState.trace`. This hook
	 * is the camera end of it: the file input, the decode, and the object URLs.
	 */
	const camera = useTracePhoto(engine)

	const photo = state ? (state.trace[state.pages[state.activePage]?.id ?? -1] ?? null) : null
	const placing = state?.tracePlacing ?? false

	/*
	 * The photo is a reference for the page you are drawing on, so it goes while the
	 * flipbook is playing: twelve frames a second under a photograph pinned to one of
	 * them says nothing about any of them. It also goes while a saved flipbook is still
	 * arriving, because the pages it would be standing on are being replaced.
	 */
	const playing = state?.playback !== 'none'
	const showTrace = phase === 'drawing' && !state?.loading && !playing && photo !== null

	/**
	 * The camera button, which is three buttons depending on what is already on the page.
	 *
	 * Nothing on this page has a second reading of one press — see `engagePress` — and
	 * this doesn't either: what it does is decided entirely by the state it is pressed in,
	 * and the button says which state that is by being lit or not. Empty page, it opens
	 * the camera. Photo in hand, it is the "done" the drawing itself also offers, and is
	 * the one you can find without knowing that tapping the paper works. Photo lying on
	 * the page, it raises the sheet, because by then there are three things to want and no
	 * press can mean all of them.
	 */
	const pressTrace = useCallback(() => {
		if (!photo) camera.take()
		else if (placing) engine?.settleTrace()
		else setTraceMenu(true)
	}, [photo, placing, camera, engine])

	/*
	 * The handle above the paper, and everything dragging it does.
	 *
	 * Off unless there is a flipbook to rearrange and a moment to do it in: one page has
	 * nowhere to go, a flipbook still arriving is being written to a page at a time, and
	 * while it is playing the strip isn't even on screen — and while a photo is in hand
	 * the sheet is somewhere a finger is already dragging something else.
	 */
	const reorderable = phase === 'drawing' && pages > 1 && !state?.loading && !playing && !placing

	const { reorder, bookRef, shiftFor, handleProps } = usePageReorder(engine, {
		activePage: state?.activePage ?? 0,
		pages,
		enabled: reorderable,
	})

	const handleSave = useCallback(
		async (values: SaveFormValues) => {
			if (!engine) return
			setPhase('sending')

			try {
				// A beat before the work starts, so the wash is painted before the main
				// thread disappears into serialising a large drawing.
				await nextPaint()
				const { svg, thumbnailDataUrl, cover } = await engine.exportForSave()

				const location = await saveFlipbook({
					title: values.title,
					description: values.description,
					svg,
					thumbnailDataUrl,
					cover,
					nsfw: values.nsfw,
					// Permanent, and not offered as a choice. Pressing Remix is what makes
					// this a remix; there is no box to untick on the way out, because a
					// drawing made on top of somebody else's is one however much of theirs
					// is left by the end. The server checks the flipbook is really there
					// and drops the link rather than refusing the save if it isn't.
					remixOf,
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
		[engine, remixOf],
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
			{/* Nothing beside the wordmark any more. The four edit actions used to live up
			    here on the desktop layout, because the header was the only place with room
			    for them; they are in the panel with everything else now, which is the whole
			    point of there being a panel. */}
			<SiteHeader />

			{/* Scaffolding, and above everything so it stays reachable in every mode — including
			    the two that park a magnifier under the top edge of the window. */}
			<DrawModeSwitch mode={drawMode} />

			{/*
			 * The page, as three boxes: the panel, the stage the flipbook scrolls in, and
			 * the page bar under it.
			 *
			 * A flex row on a desktop and a flex column on a phone, which is the whole of
			 * the difference between the two layouts — the panel is first in the document
			 * either way and `order` is what puts it at the bottom of the smaller one. That
			 * is also the tab order, and it is the right one at both widths: the tools come
			 * before the drawing.
			 *
			 * `main` is exactly what is left of the window under the header — see
			 * `html.tool main` in base.css — so the stage can take the rest of it with a
			 * `flex: 1` and nothing here ever has to know how tall the header is.
			 */}
			<main className={contentClass} ref={field}>
				{engine && state ? (
					<ToolPanel
						engine={engine}
						state={state}
						stowed={phase !== 'drawing'}
						mode={drawMode}
						drawing={phase === 'drawing'}
						trace={{
							label: traceLabel(photo !== null, placing),
							on: placing,
							enabled: phase === 'drawing' && !camera.busy,
							onPress: pressTrace,
						}}
					/>
				) : null}

				<div className={styles.body}>
					<div className={styles.stage}>
						{/* The flipbook, as a column you scroll. It fills the stage and the paper
						    below stands over the middle of it — so this is both the thing behind
						    the drawing and the thing that turns the page. */}
						{engine && state ? (
							<PageStrip
								engine={engine}
								pages={state.pages}
								activePage={state.activePage}
								playing={state.playback !== 'none'}
								arriving={state.arriving}
								// A page animation, and not the other thing `busy` covers: carrying a
								// page has the scroller easing to the gesture's own timing, and the
								// two would be arguing about the same scroll position.
								throwing={state.busy && !state.reordering}
								canvasRef={canvasRef}
								reorder={reorder}
								shiftFor={shiftFor}
							/>
						) : null}

						{/* The drawing, pinned over the middle of the column: it is the one thing
						    on the stage that does not scroll. Transparent to the pointer except
						    where the paper actually is, so the strip either side of it is
						    somewhere you can take hold of the flipbook and scroll. */}
						<div className={styles.paper}>
							{/* `--settle` is the one number the drag and the stylesheet have to agree
							    about; it is stated in `usePageReorder` and handed down here so they
							    can't drift. */}
							<div
								ref={bookRef}
								className={[
									canvasStyles.book,
									canvasStyles.fitted,
									reorder ? canvasStyles.dragging : '',
									reorder?.settling ? canvasStyles.settling : '',
								]
									.filter(Boolean)
									.join(' ')}
								style={{ '--settle': `${SETTLE_MS}ms` } as React.CSSProperties}
							>
								<canvas
									ref={canvasRef}
									className={[
										canvasStyles.canvas,
										state?.arriving ? canvasStyles.handedOver : '',
										// A page being carried is a page sliding about under the pointer,
										// and paper listens for a mousedown on this element directly — so
										// the press is taken off it here rather than refused inside. The
										// finger's half of that is in `PointerLayer.engage`.
										state?.reordering ? canvasStyles.inert : '',
										// And v12 stands its own canvas in front of this one, so paper
										// goes on drawing here and nothing looks at it. See `.staged`.
										staged ? canvasStyles.staged : '',
									]
										.filter(Boolean)
										.join(' ')}
								/>

								{/* Two ways a flipbook lands in the drawing tool and they are not the
								    same event: one is your own work coming back after a crash, the
								    other is somebody else's arriving to be drawn on. Same overlay,
								    same spinner, different sentence. */}
								{state?.loading ? (
									<div className={canvasStyles.overlay}>
										<h2>
											{asked && !crash.restored
												? 'Opening that flipbook'
												: 'Restoring your flipbook'}
										</h2>
										<Spinner label="" />
									</div>
								) : null}

								{phase === 'sending' ? (
									<div className={`${canvasStyles.overlay} ${canvasStyles.sending}`}>
										<Spinner label="Saving" />
									</div>
								) : null}

								{/* The photograph being traced over. Above the canvas and multiplied into
								    it, which is what lets the ink stay as dark as it was drawn — see
								    `TraceLayer`. Never part of the artwork, and never photographed into a
								    thumbnail: it is a DOM layer, and the canvas underneath is untouched. */}
								{/* Except in v12 once a photo has settled, where the stage in front of
								    this is drawing it into the zoomed view instead — a layer over the
								    top would be the same photograph a second time, at the wrong size.
								    While it is being *placed* the stage stands its window back at 1×
								    and this does the work, because placing is stated in the paper's own
								    pixels and both of them are the same box up there. */}
								{showTrace && photo && engine && (!staged || placing) ? (
									<TraceLayer
										photo={photo}
										placing={placing}
										onPlaced={(placement) => engine.placeTracePhoto(placement)}
										onAccept={() => engine.settleTrace()}
									/>
								) : null}

								{/* v12's zoomed drawing surface, standing exactly where the canvas is.
								    Inside `.book` and before the cursor, so the ring is drawn over it. */}
								{onPaper && phase === 'drawing' ? (
									<ZoomStage
										layer={layer}
										engine={engine}
										canvasRef={canvasRef}
										tool={state?.tool ?? null}
										photo={showTrace ? photo : null}
										placing={placing}
										surface="paper"
										startZoom={startingZoom(drawMode)}
										suspended={placing}
									/>
								) : null}

								{/* The ring that says what the stroke will be, or the shape that says
								    what the transform tool would grab. Inside `.book` because both are
								    measured against the drawing rather than the window.

								    It draws nothing while a trace photo is in hand — there is no tool
								    then, and no tool is no cursor. That used to matter a great deal,
								    because this component also *built* `PointerLayer` and the layer is
								    the only thing listening for a tool button being pressed: unmounting
								    it made the three tools completely dead while a photo was being
								    placed. The layer is `usePointerLayer`'s now, called above and outside
								    every one of these conditions, so the panel goes on working whatever
								    this renders. */}
								{state && phase === 'drawing' ? (
									<InkCursor
										layer={layer}
										canvasRef={canvasRef}
										tool={state.tool}
										mode={drawMode}
									/>
								) : null}

								{/* v11's outline: which part of the page the stage below is showing.
								    Inside `.book` because it is measured against the drawing, exactly
								    as the cursor above it is.

								    v11's alone. v12 has no overview — its stage *is* the paper — and the
								    sheet this outline is drawn on covers the whole drawing, so leaving it
								    up there would put a rectangle round the entire page and, far worse,
								    take every press before the stage underneath could have it. */}
								{!onPaper && phase === 'drawing' ? <ZoomWindow /> : null}

								{phase !== 'drawing' ? (
									<div className={canvasStyles.wash} aria-hidden="true" />
								) : null}

								{phase !== 'drawing' ? (
									<SaveForm
										saving={phase === 'sending'}
										onSave={(values) => void handleSave(values)}
										onCancel={() => setPhase('drawing')}
									/>
								) : null}

								{/* The tab on the side of the sheet. Inside `.book` because it is part
								    of the page — it hangs off the paper's edge, and it travels with it
								    when the page is carried. */}
								{phase === 'drawing' ? (
									<PageHandle
										handleProps={handleProps}
										page={(state?.activePage ?? 0) + 1}
										pages={pages}
										carrying={reorder !== null}
										disabled={!reorderable}
									/>
								) : null}
							</div>
						</div>

						{/*
						 * Save, floating in the bottom right-hand corner of the drawing.
						 *
						 * Inside the stage rather than pinned to the window, and that is what
						 * keeps it clear of the two boxes below: the page bar spans the drawing's
						 * width and v14's aiming pad spans the rest, and a button in the window's
						 * own corner sat on top of the pad. The stage is the one box on this page
						 * whose corner nothing else wants.
						 *
						 * It spent a version inside the panel, pinned to the end of the rail. Two
						 * things were wrong with that: it was the only thing in a list of 40px
						 * tiles that was not one, and the rail is a list of things you do *to* the
						 * drawing, which the press that ends the drawing is not.
						 */}
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

					{/* The page bar, still horizontal and still under the drawing — the one
					    control on this page that did not turn with the flipbook. It says where
					    you are in the *whole* book, which is a length rather than a direction,
					    and a bar standing on end beside a column of pages would be a second
					    scrollbar for the thing already scrolling next to it. */}
					<div className={styles.navBand}>
						{engine && state && phase === 'drawing' ? (
							<PageNav
								engine={engine}
								// Where the page would land while one is being carried, rather than
								// the page being drawn on — which doesn't change until the gesture
								// ends, so the bar would sit still through the whole of it. It is
								// the only thing on screen that says where you are against the
								// *whole* flipbook, which is exactly what a long run needs.
								activePage={reorder ? reorder.to : state.activePage}
								pages={pages}
								playback={state.playback}
								// And it travels at the flipbook's own rate while the book is running
								// past the page, rather than hopping onto each slot in turn.
								glide={reorder?.slide ?? null}
								// A crashed drawing being replayed arrives a page at a time exactly
								// as a saved one does, so the bar waits the same way. Empty on a
								// fresh page too, and there is nothing to say about a flipbook of
								// one page anyway.
								waiting={state.loading}
							/>
						) : null}
					</div>

					{/* v14's aiming pad, under the page bar and at the bottom of the screen.
					    Rendered only in the mode that has one, and hidden by its own stylesheet
					    above the phone breakpoint — a mouse has a precise pointer and none of
					    what it answers is a problem it has. It is the *only* place a finger
					    aims from in v14, which is what leaves the flipbook free to scroll. */}
					{usesAimPad(drawMode) && phase === 'drawing' ? <AimPad /> : null}

					{/* And v11's second canvas, in whatever the body has left. It is rendered on
					    every layout and hides itself where there is no room, because "is there a
					    stage" is then one measurement rather than a media query written out
					    again in JavaScript. */}
					{isZoomStageMode(drawMode) && !onPaper && phase === 'drawing' ? (
						<ZoomStage
							layer={layer}
							engine={engine}
							canvasRef={canvasRef}
							tool={state?.tool ?? null}
							// The same photo the paper is showing, under the same condition — so
							// the two either both have it or neither does. It is drawn into the
							// stage rather than laid over it: see `paintTrace`.
							photo={showTrace ? photo : null}
							placing={placing}
							surface="band"
							startZoom={startingZoom(drawMode)}
						/>
					) : null}
				</div>
			</main>

			{traceMenu && photo ? (
				<TraceMenu
					onEdit={() => {
						setTraceMenu(false)
						engine?.beginTracePlacing()
					}}
					onReplace={() => {
						setTraceMenu(false)
						camera.take()
					}}
					onRemove={() => {
						setTraceMenu(false)
						engine?.removeTracePhoto()
					}}
					onCancel={() => setTraceMenu(false)}
				/>
			) : null}

			{crash.crashed ? <Recovery saved={crash.saved} /> : null}
		</>
	)
}

/**
 * What the camera button is offering right now, as words.
 *
 * It is the accessible name and the tooltip both, and it changes because the button
 * does: a control that reads "Trace photo" while it is standing in for "done" is one
 * nobody using it by ear can follow.
 */
function traceLabel(has: boolean, placing: boolean): string {
	if (placing) return 'Place the trace photo'
	// Plural on the way in, because the picker takes several and a batch is laid across a
	// run of frames — see `addTracePhotos`. Singular everywhere after, where there is only
	// ever the one on this frame to talk about.
	return has ? 'Trace photo options' : 'Trace over photos'
}

/**
 * Opens the drawing tool on a flipbook that already exists.
 *
 * The same two fetches the playback page makes and the same `loadSvg` at the end of
 * them, because it is the same job: a saved flipbook, replayed into a scene. What
 * differs is only that this one can be drawn on afterwards, and that is not a property
 * of the load.
 *
 * Four things worth keeping straight:
 *
 *  - **`null` while the crash recovery is still deciding**, and `null` forever if it
 *    restored something. Recovered work is a drawing that already exists and already
 *    contains whatever it was remixed from; fetching the original over the top of it
 *    would replay two flipbooks into one scene. The URL survives the recovery reload
 *    — `Recovery` calls `location.reload()` — so without the guard that is exactly
 *    what would happen, every time.
 *  - **`legacy-json` is refused.** Those are point lists that only come back through
 *    the pencil, so what the tool would open is a resampled copy rather than the
 *    artwork. The button isn't offered on them; this is the same answer given where it
 *    can't be got round, and the server drops the link too.
 *  - **A failure leaves an empty page rather than an error.** Every path out of here
 *    is a flipbook that couldn't be fetched, and what is on screen is a working
 *    drawing tool — so the message says the remix didn't happen and the page carries
 *    on being what it already is. It clears `remixOf`… except that it can't, and
 *    doesn't need to: the save resolves the parent server-side, so a flipbook that
 *    couldn't be fetched here is one that won't be linked to there either.
 *  - **The engine's own history is cleared by `loadSvg`**, so the pages that arrive
 *    aren't fifty undo steps you can walk backwards out of. That is the loader's
 *    behaviour already, and it is the right one here: undoing your way past the
 *    beginning of a remix should not be possible. It is also what tells a remix
 *    nobody has touched from one somebody has — see `useUnsavedWarning` below.
 *
 * Answers whether a flipbook is on the page because of this, which the unsaved-work
 * guard needs and nothing else does.
 */
function useRemixSource(engine: FlipbookEngine | null, id: string | null): boolean {
	const [loaded, setLoaded] = useState(false)

	useEffect(() => {
		if (!engine || !id) return

		const controller = new AbortController()

		getFlipbook(id, { signal: controller.signal })
			.then(async (found) => {
				if (controller.signal.aborted) return

				if (found.format === 'legacy-json') {
					throw new Error('A 2012 flipbook can only be redrawn, not edited.')
				}

				const text = await getFlipbookData(found.data_url, { signal: controller.signal })
				if (controller.signal.aborted) return

				await engine.loadSvg(text, controller.signal)
				if (!controller.signal.aborted) setLoaded(true)
			})
			.catch(() => {
				if (controller.signal.aborted) return
				showMessage({
					copy: "I couldn't open that flipbook to remix. Here's a blank one instead.",
					cta: 'Fair enough',
					type: 'error',
				})
			})

		return () => controller.abort()
	}, [engine, id])

	return loaded
}

/**
 * The document holds still while the drawing tool is up: no scroll, no bounce, no pull
 * to refresh, no pinch.
 *
 * **The one thing on this page that scrolls is the page strip, and it is not the
 * document.** That is a stronger claim than it used to be rather than a weaker one: the
 * flipbook is a scroll container of its own now, with `overscroll-behavior: contain`, so
 * a flick that runs off the end of the last page has nowhere to go — where before there
 * was simply nothing on the page that could scroll at all. What the document still has
 * without this is the rubber band, and the whole drawing sliding an inch under your
 * finger on a stroke that started near the bottom edge; and a pull far enough to reload
 * the tab, which on an unsaved flipbook is the worst outcome this page has.
 *
 * What the class does, and why it takes four properties to do it, is in `base.css`.
 *
 * **Two classes, and they come off at different times.** `tool` is the layout — one
 * windowful, and `main` is what is left of it under the header — and it stays on from the
 * boot shell until the page unmounts, because the stage it sizes holds the strip, the
 * drawing and the save form alike. `locked` is the gesture lock and comes off while the
 * form is up, which
 * is the one time this page has fields in it: a long description in a small textarea has
 * to be pannable, and `touch-action: none` on an ancestor cannot be given back by a
 * descendant. Nothing is lost by it — the drawing tool is behind the wash by then, and
 * `beforeunload` is already guarding the reload.
 */
function useNoScrolling(enabled: boolean): void {
	// The page shape, which the boot shell is already wearing — see `useToolLayout`, and
	// the count in it for why the handover between the two is not a flicker.
	useToolLayout()

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

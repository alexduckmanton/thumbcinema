import { useCallback, useEffect, useRef, useState } from 'react'

import { SiteHeader } from '../../components/SiteHeader'
import { useLockedLayout } from '../../components/toolLayout'
import { Spinner } from '../../components/Spinner'
import { AimPad } from '../../flipbook/components/AimPad'
import { InkCursor } from '../../flipbook/components/InkCursor'
import { ToolPanel } from '../../flipbook/components/ToolPanel'
import { ZoomStage, ZoomWindow } from '../../flipbook/components/ZoomStage'
import { DEFAULT_PAGE_SIZE, type PageSize } from '../../flipbook/engine/constants'
import { pageVars } from '../../flipbook/pageVars'
import { PageHandle } from '../../flipbook/components/PageHandle'
import { PageNav } from '../../flipbook/components/PageNav'
import { SaveForm, type SaveFormValues } from '../../flipbook/components/SaveForm'
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
import { canvasViewport, useStage, type Viewport } from '../../flipbook/zoomStage'
import { useFlipbookEngine } from '../../flipbook/useFlipbookEngine'
import { useKeyboardShortcuts } from '../../flipbook/useKeyboardShortcuts'
import { SETTLE_MS } from '../../flipbook/engine/reorder'
import { usePageReorder } from '../../flipbook/usePageReorder'
import {
	ApiError,
	getFlipbook,
	getFlipbookData,
	isNetworkFailure,
	saveFlipbook,
} from '../../lib/api'
import { isTouch } from '../../lib/device'
import { refuseMultiTouch } from '../../lib/zoom'
import { registerMessage, showMessage } from '../../lib/messages'
import { queueFlipbook } from '../../offline/pending'
import { hasServiceWorker } from '../../offline/register'
import { guardNavigation, navigate, useLocation } from '../../router/Router'
import { flipbookPath, remixSource } from '../../router/routes'
import canvasStyles from '../../flipbook/components/FlipbookCanvas.module.css'
import styles from './CreatePage.module.css'
import { Recovery } from './Recovery'
import { useCrashRecovery } from './useCrashRecovery'

type Phase = 'drawing' | 'naming' | 'sending'

export function CreatePage() {
	const { engine, state, canvasRef } = useFlipbookEngine({
		mode: 'create',
		isTouch,
		page: DEFAULT_PAGE_SIZE,
	})
	const [phase, setPhase] = useState<Phase>('drawing')
	/** The trace photo's remove/replace/edit sheet, which is up or it isn't. */
	const [traceMenu, setTraceMenu] = useState(false)

	/*
	 * Whether v14's aiming pad is on screen, which is a preference rather than a mode.
	 *
	 * The pad is where a finger aims from and is the only place it can — but it is also the
	 * widest piece of furniture on a phone, and there is drawing you would rather have the
	 * room to look at. Taking it away leaves v14 with nowhere to aim from, which is the
	 * honest trade and is exactly what the button in the rail is for: off, the tools and the
	 * paper still work and the cursor simply stays where it was.
	 *
	 * Not persisted. It is a thing you do to look at something, not a setting.
	 */
	const [pad, setPad] = useState(true)

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
	/**
	 * The shape of the page, from the store rather than off the engine: a remix restates
	 * it when its artwork lands, and the layout has to be told when that happens. Never
	 * null here — this page opens a blank flipbook and so states its shape up front.
	 */
	const page = state?.page ?? DEFAULT_PAGE_SIZE

	const onPaper = stageOnPaper(drawMode)
	const stageView = useStage().view
	const staged = stageView !== null && onPaper

	const crash = useCrashRecovery(engine, asked)

	// What a save will actually be attributed to: the recovery file's answer when there
	// was one to restore, the URL's otherwise. See `useCrashRecovery`.
	const remixOf = crash.remixOf

	useEffect(() => {
		document.title = 'create — thumbcinema'
	}, [])

	const remixLoaded = useRemixSource(engine, crash.decided && !crash.restored ? asked : null)

	// Held still the whole time, the save form included: a page scrolling behind a modal
	// is the scroll conflict the modal exists to avoid. `pannable` is what lets a finger
	// pan inside the form — the description field is 72px tall and a longer description
	// than that has to be scrollable — while the document stays put. See `base.css`.
	useNoScrolling(true, { pannable: phase !== 'drawing' })

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
	const showTrace = !state?.loading && !playing && photo !== null

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
	const reorderable = pages > 1 && !state?.loading && !playing && !placing

	const { reorder, bookRef, handleProps } = usePageReorder(engine, {
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

				const payload = {
					title: values.title,
					description: values.description,
					svg,
					thumbnailDataUrl,
					cover,
					// Permanent, and not offered as a choice. Pressing Remix is what makes
					// this a remix; there is no box to untick on the way out, because a
					// drawing made on top of somebody else's is one however much of theirs
					// is left by the end. The server checks the flipbook is really there
					// and drops the link rather than refusing the save if it isn't.
					remixOf,
				}

				let location: string
				let queued = false
				try {
					location = await saveFlipbook(payload)

					// Left for the page we're about to land on.
					registerMessage({
						copy: "Nice one! Your flipbook's saved. Give yourself a pat on the back.",
						cta: "Don't mind if I do",
						type: 'success',
					})
				} catch (error) {
					// A request that never got an answer is a connection, not a refusal —
					// so the flipbook goes in the queue and the page carries on as if it had
					// saved, because from here it has: it has an id, a permalink and a card
					// in the gallery, and `sync.ts` posts it the moment there's a signal. A
					// server that *did* answer is a different thing entirely and falls
					// through to the banner below; a flipbook that is too big to save now
					// will still be too big tomorrow. See docs/offline.md.
					if (!isNetworkFailure(error)) throw error

					const entry = await queueFlipbook(payload)
					location = flipbookPath(entry.book.id)
					queued = true

					registerMessage({
						copy: "You're offline. I'll publish the moment you're back.",
						cta: 'Okay',
						type: 'info',
					})
				}

				// A full load rather than a client-side navigation: the drawing tool has
				// a paper.js scene, a megabyte of artwork and an unsaved-work guard
				// attached to this document, and none of it should follow us.
				//
				// Except with no connection and no service worker to answer for the site —
				// a first visit, or a browser that refused to register one — where a real
				// load is the browser's error page and the reader would think the save had
				// failed. It hasn't; the queue is IndexedDB and is already written. So that
				// one case stays inside the app, and pays for it by carrying the scene
				// along. The guard is already off: `phase` is 'sending' by now.
				if (queued && !hasServiceWorker()) navigate(location)
				else window.location.href = location
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

	return (
		<>
			{/*
			 * The header, pinned to the top, carrying nothing but Save.
			 *
			 * No wordmark: the create page is the one page that isn't somewhere you read, and
			 * a 70px word plus a header's worth of padding is room a square page needs. What
			 * is left is one button, and it is the right one to keep up here — it is the only
			 * control on the page that isn't about the drawing.
			 *
			 * `position: fixed` on a wrapper rather than on `SiteHeader` itself, which is
			 * shared with two pages that scroll normally.
			 */}
			<SiteHeader width="narrow" wordmark={false}>
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
			</SiteHeader>

			{/*
			 * The page: a rail, a stage, a page bar and — in v14 — an aiming pad, in one
			 * windowful that does not scroll.
			 *
			 * **It scrolled for a while and it doesn't any more.** The flipbook was a column
			 * of thumbnails you scrolled with the drawing pinned over the middle of it, which
			 * is a real way to build this and is written down in `docs/create-page.md` with
			 * what it cost. What it cost was the whole page: a scroll container, a snap
			 * container, a sticky wrapper to keep the chrome in the scroller's chain, a
			 * measured snap offset, two rules stopping the scroll and the page number from
			 * answering each other, and one canvas per page under a memory ceiling. The page
			 * bar does the same job in one control and 60px of height.
			 *
			 * Nothing here changes when the save form goes up: it is a modal that paints its
			 * own wash and puts `inert` on `#root`, so everything in here is already
			 * unpressable, unfocusable and out of the accessibility tree while it is up.
			 */}
			<main className={styles.content} ref={field} style={pageVars(page) as React.CSSProperties}>
				{/* Every control on the page, in a rail down the left at both widths. First in
				    the document, which is also the tab order and is the right one: the tools
				    come before the drawing. */}
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
							enabled: !camera.busy,
							onPress: pressTrace,
						}}
						// Only in the mode that has a pad. Every other mode aims from somewhere
						// else, or from nowhere at all, and a switch for a thing that is not on
						// the page is a control that does nothing.
						pad={usesAimPad(drawMode) ? { on: pad, onToggle: () => setPad((up) => !up) } : null}
					/>
				) : null}

				<div className={styles.stage}>
					{/* `--settle` is the one number the drag and the stylesheet have to agree
				    about; it is stated in `usePageReorder` and handed down here so they
				    can't drift. */}
					<div
						ref={bookRef}
						className={[
							canvasStyles.book,
							// `.fitted`, which is where the stacking context lives: the canvas
							// overflows this box on every side and has to pass *under* the page
							// bar. See the note on it.
							canvasStyles.fitted,
							reorder ? canvasStyles.dragging : '',
							reorder?.settling ? canvasStyles.settling : '',
						]
							.filter(Boolean)
							.join(' ')}
						style={{ '--settle': `${SETTLE_MS}ms` } as React.CSSProperties}
					>
						{/* `.open`, so the canvas is *not* cropped to the page while you are
						    drawing on it: the element is the whole drawable area, twice the page
						    in each direction, and it overflows this box on all four sides. What
						    says where the flipbook ends is the crop outline below. See `.open`. */}
						<div className={`${canvasStyles.paper} ${canvasStyles.open}`}>
							<canvas
								ref={canvasRef}
								className={[
									canvasStyles.canvas,
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
						</div>

						{/* Two ways a flipbook lands in the drawing tool and they are not the
					    same event: one is your own work coming back after a crash, the
					    other is somebody else's arriving to be drawn on. Same overlay,
					    same spinner, different sentence. */}
						{state?.loading ? (
							<div className={canvasStyles.overlay}>
								<h2>
									{asked && !crash.restored ? 'Opening that flipbook' : 'Restoring your flipbook'}
								</h2>
								<Spinner label="" />
							</div>
						) : null}

						{/*
						 * The crop frame: the one thing on the page that says which ink survives
						 * the save.
						 *
						 * Drawn here rather than by the stage, because the stage is not always
						 * there — it is hidden above the phone breakpoint, and on a desktop the
						 * canvas is shown directly. One formula covers both: with no stage the
						 * surface *is* the whole canvas, so `canvasViewport` is the window and the
						 * frame comes out at exactly this box.
						 *
						 * Positioned in percentages of `.book`, which is the page's own box, while
						 * the surface is `CANVAS_SCALE` times it and centred — hence the `-50%`
						 * and the `200%`, the same two numbers the canvas is laid out with. At
						 * rest they cancel and the frame is `0%`/`100%`: exactly where the sheet
						 * used to be, which is why the layout did not move.
						 */}
						<CropFrame view={stageView ?? canvasViewport(page)} page={page} />

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
								page={page}
								placing={placing}
								onPlaced={(placement) => engine.placeTracePhoto(placement)}
								onAccept={() => engine.settleTrace()}
							/>
						) : null}

						{/* v12's zoomed drawing surface, standing exactly where the canvas is.
					    Inside `.book` and before the cursor, so the ring is drawn over it. */}
						{onPaper ? (
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
					    every one of these conditions, so the tray goes on working whatever
					    this renders. */}
						{state ? (
							<InkCursor layer={layer} canvasRef={canvasRef} tool={state.tool} mode={drawMode} />
						) : null}

						{/* v11's outline: which part of the page the stage below is showing.
					    Inside `.book` because it is measured against the drawing, exactly
					    as the cursor above it is.

					    v11's alone. v12 has no overview — its stage *is* the paper — and the
					    sheet this outline is drawn on covers the whole drawing, so leaving it
					    up there would put a rectangle round the entire page and, far worse,
					    take every press before the stage underneath could have it. */}
						{!onPaper ? <ZoomWindow page={page} /> : null}

						{/* A modal: it paints its own wash over the whole window and is portalled
					    out of here to `<body>`, so where it stands in this tree decides
					    nothing about where it appears. It stays up while the save is in
					    flight, with the spinner in its own button, which is why this is
					    `!== 'drawing'` rather than `=== 'naming'`. */}
						{phase !== 'drawing' ? (
							<SaveForm
								saving={phase === 'sending'}
								onSave={(values) => void handleSave(values)}
								onCancel={() => setPhase('drawing')}
							/>
						) : null}

						{/* The tab on the top edge of the sheet. Inside `.book` because it is
					    part of the page — it hangs above the paper, and it travels with it
					    when the page is carried. */}
						<PageHandle
							handleProps={handleProps}
							page={(state?.activePage ?? 0) + 1}
							pages={pages}
							carrying={reorder !== null}
							disabled={!reorderable}
						/>
					</div>

					{/* The page bar: horizontal, under the drawing, and exactly as wide as it.

					    It is the whole of page navigation now. It says where you are against the
					    *entire* flipbook, which a column of thumbnails could only ever show three
					    of — and it is one control rather than a canvas per page, which is what a
					    200-page archive flipbook makes the difference between. */}
					<div className={styles.navBand}>
						{engine && state ? (
							<PageNav
								engine={engine}
								// Where the page would land while one is being carried, rather than
								// the page being drawn on — which doesn't change until the gesture
								// ends, so the bar would sit still through the whole of it. With the
								// thumbnails gone this is the only thing on screen that says a
								// reorder is going anywhere, which makes it load-bearing rather than
								// a nicety.
								activePage={reorder ? reorder.to : state.activePage}
								pages={pages}
								playback={state.playback}
								// And it travels at the flipbook's own rate while the book is running
								// underneath the page, rather than hopping onto each slot in turn.
								glide={reorder?.slide ?? null}
								// A crashed drawing being replayed arrives a page at a time exactly
								// as a saved one does, so the bar waits the same way. Empty on a
								// fresh page too, and there is nothing to say about a flipbook of
								// one page anyway.
								waiting={state.loading}
							/>
						) : null}
					</div>
				</div>

				{/* v14's aiming pad, at the bottom of the screen and hidden by its own
				    stylesheet above the phone breakpoint — a mouse has a precise pointer and
				    none of what it answers is a problem it has. It is the *only* place a finger
				    aims from in v14. Out of the flow on purpose: the band it stands in is
				    reserved whether it is in it or not, so the rail's switch takes the pad away
				    without moving the drawing. */}
				{usesAimPad(drawMode) && pad ? <AimPad /> : null}

				{/* And v11's second canvas, in whatever the column has left. It is rendered on
				    every layout and hides itself where there is no room, because "is there a
				    stage" is then one measurement rather than a media query written out again
				    in JavaScript. */}
				{isZoomStageMode(drawMode) && !onPaper ? (
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
 * The outline round the part of the canvas that will be saved.
 *
 * A DOM box rather than anything painted into the canvas, for the same reason the trace
 * photo is a DOM layer: nothing that is not the drawing may ever be in a position to end up
 * *in* the drawing. Stated in percentages, so it needs no measurement of its own and cannot
 * fall out of step with the surface beside it — both are drawn from the same numbers on the
 * same render.
 *
 * `-50%` and `200%` are `CANVAS_SCALE` written twice: the surface is that many times this
 * box and centred on it, so a fraction of the *surface* becomes a percentage of the box by
 * scaling and shifting. With the window at the whole canvas the two cancel exactly and the
 * frame lands on `0%`/`100%` — which is why nothing about the layout moved.
 */
function CropFrame({ view, page }: { view: Viewport; page: PageSize }) {
	const across = (value: number) => `${-50 + (200 * (value - view.x)) / view.w}%`
	const down = (value: number) => `${-50 + (200 * (value - view.y)) / view.h}%`

	return (
		<div
			className={canvasStyles.crop}
			aria-hidden="true"
			style={{
				left: across(0),
				top: down(0),
				width: `${(200 * page.width) / view.w}%`,
				height: `${(200 * page.height) / view.h}%`,
			}}
		/>
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
 * `pannable` while the save form is up, which is the one time this page has something in
 * front of it a finger may want to drag inside. It keeps every part of the lock except
 * `touch-action: none` — which is an intersection down the ancestor chain that a
 * descendant cannot give back, so with it on, not even the description field could be
 * panned. The document stays held still either way, which is the point: a page scrolling
 * behind a modal is the conflict the modal exists to avoid.
 */
function useNoScrolling(enabled: boolean, { pannable = false } = {}): void {
	// `locked` itself is the boot shell's too — it is the page's shape as well as its lock,
	// and the shell has to draw the same shape — so it is held by a ref-counted hook in the
	// entry bundle rather than added here. See `useLockedLayout`.
	useLockedLayout()

	useEffect(() => {
		if (!enabled) return

		const root = document.documentElement
		if (pannable) root.classList.add('pannable')

		// And the one thing CSS can't say on iOS, where `touch-action` does not reach page
		// zoom and cancelling the gesture events turns out not to be the whole answer.
		const release = refuseMultiTouch()

		return () => {
			root.classList.remove('pannable')
			release()
		}
	}, [enabled, pannable])
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

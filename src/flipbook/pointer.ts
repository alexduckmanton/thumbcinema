import { isTouch } from '../lib/device'
import { Store } from '../lib/store'
import {
	aimsOffStage,
	CURSOR_OFFSET,
	type DrawMode,
	drivesAllTools,
	HOLD_DELAY,
	HOLD_SLOP,
	holdsTool,
	isMultiTouchMode,
	isRelativeMode,
	isTimedMode,
	isZoomStageMode,
	stageOnPaper,
	TRAIL_DISTANCE,
} from './drawModes'
import type { PageSize } from './engine/constants'
import type { FlipbookEngine } from './engine/FlipbookEngine'
import type { ModalToolId } from './engine/tools/types'
import {
	type Box,
	centreViewport,
	onPage,
	type PageZoom,
	panPage,
	paperPoint,
	panViewport,
	type Point,
	setPageZoom,
	setViewport,
	stage,
	stageElement,
	subscribeStage,
	stagePlace,
	stagePoint,
	type Viewport,
	visiblePage,
	zoomPage,
	zoomViewport,
} from './zoomStage'

/**
 * Where the pointer is and what it is doing, in the terms the cursor is drawn in.
 *
 * All four coordinates are CSS pixels from the top left of the canvas, which is what
 * `InkCursor` positions against — see the note at the top of `InkCursor.module.css`
 * for why that box and not the window.
 */
export interface Cursor {
	/** The pointer itself: the fingertip, or the mouse, or the standing cursor. */
	x: number
	y: number
	/**
	 * Where the mark actually lands.
	 *
	 * The same point as the pointer in most modes. v4 lifts it clear of the finger; v5
	 * lets it trail behind. The ring is drawn here rather than at the pointer, because
	 * the ring's whole job is to say where the ink will be.
	 */
	inkX: number
	inkY: number
	/** How wide the canvas is being shown, which is what maps these onto the artwork. */
	size: number
	/** And how far down the window it starts, which is what stops the loupe leaving it. */
	top: number
	/** True when a finger put it there rather than a mouse. The loupe's condition. */
	touching: boolean
	/**
	 * Which canvas these coordinates are measured against.
	 *
	 * The paper in every mode but v11, and in v11 the magnified stage under the tools —
	 * which is a different box, at a different scale, in a different part of the tree. So
	 * the two components that draw a cursor each render only their own surface's, and
	 * neither has to know the other exists.
	 */
	surface: Surface
	/**
	 * True when this is the standing cursor rather than a picture of a pointer.
	 *
	 * The two are different objects. A mouse's cursor is where the mouse is, it exists
	 * only while the mouse is over the drawing, and it says nothing about what is
	 * happening because you can see your own hand on the desk. The standing cursor —
	 * v6 onwards — is a thing a finger pushes around, it is on the page whether anything
	 * is touching the glass or not, and it has to say for itself whether the tool is
	 * working, which is what greys and blackens it. See `.waiting` and `.inking`.
	 */
	standing: boolean
	/** True while the tool is working. In the standing cursor this is what colours it. */
	marking: boolean
	/**
	 * What a drag from here would do to a selection, and along which axis.
	 *
	 * Only ever anything but `none` for the transform tool, which is the one tool that
	 * grabs rather than marks. `angle` is degrees clockwise from horizontal, and matters
	 * for `scale`.
	 */
	affordance: { kind: 'none' | 'move' | 'scale' | 'rotate'; angle: number }
}

/**
 * The one place a pointer becomes a mark, for as long as there is more than one
 * candidate answer to how a finger should draw.
 *
 * A finger is opaque, so the thing you are aiming at on a phone is underneath the thing
 * you are aiming with. Ten answers to that are built here and drawn with side by side;
 * `drawModes.ts` is the list of them and what each one comes from, and **v10 is the one
 * the tool ships with**. The rest are reachable from the switch in the corner of the
 * create page.
 *
 * v10, in full, because it is the default and because everything below reads as
 * branching around it: **the cursor is a thing standing on the page, and a finger
 * anywhere nudges it by however far the finger moved.** It never travels to the contact
 * point — that is the whole idea, and it has to hold from the first event of every
 * gesture or the cursor would jump under the hand and back — and it survives the gesture
 * that moved it, because a cursor you have carefully placed and then lost by lifting your
 * finger is worse than no cursor at all. What sets the tool *working* is a second
 * contact, and there are two of them because they are the same thing: a second finger
 * anywhere on the page, or a tool held down in the tray by the other hand. Both are a
 * mouse button, so either will do it and a gesture can have both at once — which is why
 * letting go asks whether the *other* holder is still there; see `releaseHold`. Either
 * finger steers, and the cursor follows the average of whichever contacts the browser
 * reports as having moved.
 *
 * **Seven of the eleven cannot be built on paper.js**, and it is worth being precise about
 * why. paper 0.12 is single-pointer by construction: on a touch device it listens for
 * `touchstart` on the canvas and `touchmove`/`touchend` on the document, and
 * `DomEvent.getPoint` reads `event.targetTouches[0]` — there is one drag in flight and no
 * notion of a pointer id anywhere in it. A gesture that has to start without drawing
 * (v6), stop halfway through (v7), put the ink somewhere other than under the finger
 * (v5), wait for the other hand (v8) or watch a *second finger* (v9, v10) has nowhere to
 * say so. The last two are the plainest case: paper cannot see a second contact at all.
 *
 * So those seven are taken away from paper entirely. This layer listens in the **capture**
 * phase, which runs before the canvas's own listeners and before anything can bubble as
 * far as the document, and calls `stopPropagation()` — paper then sees no part of the
 * gesture, and the tool in hand is driven directly through
 * `engine.toolDown`/`toolDrag`/`toolUp` instead. It is touch events that are intercepted
 * rather than pointer events, and that is not a detail: the two are separate streams, and
 * stopping a `pointerdown` does nothing at all to the `touchstart` paper is actually
 * listening for. The other four modes don't need any of that — paper draws as it always
 * has, and this layer only watches, so that the ring and the loupe have somewhere to read
 * the pointer from. v11 is the seventh, and takes its gestures away for a different reason
 * again: the finger is on a second canvas that paper has never heard of.
 *
 * **In the relative modes the field is the whole page, not the drawing.** A cursor that
 * is nudged rather than placed doesn't care where the nudge comes from, and a phone's
 * create page is a column of drawing with a band of empty white under it — which is where
 * a thumb already is, and which nothing else on the page wants. Dragging there aims; the
 * other hand holds a tool, or a second finger lands anywhere, and the tool works up on
 * the paper. The modes that mark at the fingertip keep the drawing as their field, having
 * nothing to say about a finger that isn't on the paper. Controls keep their own touches
 * either way: see `ownsTouch`.
 *
 * The mouse is a different question and gets a different surface, in every mode. It has a
 * visible cursor, sits a pixel wide and occludes nothing, so all of this is about a
 * problem it doesn't have — what it takes from this file is the ring, and the transform
 * tool's four shapes. It is watched on the drawing alone, because a ring is a picture of
 * a pointer and there is no pointer out on the page.
 */
export class PointerLayer {
	private readonly store = new Store<{ cursor: Cursor | null }>({ cursor: null })

	/** Everywhere a finger may aim from: the page, less the controls standing on it. */
	private readonly field: HTMLElement
	/** `.book`, which is the drawing. The mouse's ring is only ever over this. */
	private readonly book: HTMLElement
	private readonly canvas: HTMLCanvasElement
	private readonly engine: FlipbookEngine

	private mode: DrawMode

	/** The touch steering the cursor, if any. */
	private gesture: Gesture | null = null

	/**
	 * Every other finger on the glass, by `Touch.identifier`.
	 *
	 * Empty in all but two modes, where these are the gesture's on-switch: two or more
	 * fingers down means the tool is working. v10 also lets them steer, which is why
	 * their positions are kept rather than merely counted — a delta needs somewhere to be
	 * measured from.
	 */
	private readonly others = new Map<number, { x: number; y: number }>()
	private holdTimer: number | null = null

	/**
	 * Which surface the gesture in hand started on. The zoomed modes', and only ever
	 * `book` elsewhere.
	 *
	 * A gesture belongs to the surface it opened on for the whole of its life: a stroke
	 * that starts on the stage and wanders up over the paper is still a stroke, a drag of
	 * the outline that wanders down over the stage is still a drag, and in v13 a finger
	 * that starts in the band below and slides up onto the drawing is still aiming.
	 * Deciding it per event would mean a gesture that changed its mind halfway.
	 */
	private surface: GestureSurface = 'book'

	/** Two fingers moving and resizing the window. v11 only; see `applyPinch`. */
	private pinch: Pinch | null = null

	/** Whether a mouse is over the stage, which is the only thing that draws its ring. */
	private stageOver = false

	/** Drops the three subscriptions. Assigned in the constructor. */
	private releaseTool: (() => void) | null = null
	private releaseGrab: (() => void) | null = null
	private releaseStage: (() => void) | null = null

	/** The tool button that is held down in the tray. See `onToolPressed`. */
	private pressed: Press | null = null

	/**
	 * Which kind of pointer the cursor currently describes.
	 *
	 * It starts as whatever the device leads with and flips on the first event of the
	 * other kind, so a laptop with a touchscreen gets whichever one is actually being
	 * used. It decides two things: whether there is a cursor at all when nothing is
	 * happening — a standing cursor is always somewhere, a mouse's is nowhere until the
	 * mouse arrives — and whether the ring reports its own state.
	 */
	private source: 'touch' | 'mouse' = isTouch ? 'touch' : 'mouse'

	/** The mouse, which has states a finger doesn't: it can be over without being down. */
	private over = false
	private held = false
	private mouseX = 0
	private mouseY = 0

	/**
	 * Where the cursor is standing, in the modes that have one of its own.
	 *
	 * The layer's state rather than the gesture's, because it outlives the gesture that
	 * moved it. See the note at the top of the class.
	 */
	private cursorX = 0
	private cursorY = 0

	/**
	 * And where v13's is, which is kept in the *page's* own units rather than in pixels.
	 *
	 * The two are the same idea and cannot be the same field. v6–v10 have a cursor
	 * standing on a canvas that shows the whole page, so pixels on that canvas and units
	 * of artwork are the same thing scaled; v13's stands on a page that is being shown
	 * through a window which moves and changes size under it. Held in project units, the
	 * cursor stays on the part of the drawing it was put on when the window pans, and the
	 * zoom decides how far a pixel of finger carries it — both of which are what you would
	 * expect of a thing standing on the page, and neither of which survives being stored
	 * as a position on the glass.
	 */
	private cursorPage: Point

	/**
	 * And which half of v13 the hand is in: the drawing, or the band below it.
	 *
	 * The two halves are two different tools and the cursor belongs to the second of them,
	 * so touching the drawing puts it away and touching the band brings it back — standing
	 * where it was left, because it never went anywhere.
	 *
	 * It is **sticky rather than a property of the gesture in flight**, and that is the
	 * whole of what it is for. A cursor drawn only while a band gesture was live came back
	 * at the end of every stroke made on the canvas, in a place the hand that drew the
	 * stroke had nothing to do with — which reads as it having jumped there, and is a thing
	 * to look at in the moment you are looking at what you just drew. Under the fingertip
	 * it costs nothing to hide: the ring is 6px and a fingertip is nearer 40.
	 */
	private half: 'stage' | 'field' = 'field'

	constructor(
		field: HTMLElement,
		book: HTMLElement,
		canvas: HTMLCanvasElement,
		engine: FlipbookEngine,
		mode: DrawMode,
	) {
		this.field = field
		this.book = book
		this.canvas = canvas
		this.engine = engine
		this.mode = mode
		// Not a field initialiser: those run before the constructor body, and this is
		// centred on a page whose size only `engine` knows.
		this.cursorPage = centreOf(engine.page)

		// Capture, and non-passive: the first is what puts this in front of paper, the
		// second is what allows `preventDefault()` — which is what stops the browser
		// synthesising a compatibility mouse event out of the gesture, and what stops it
		// treating a drag across the empty half of the page as a scroll.
		const options = { capture: true, passive: false }
		field.addEventListener('touchstart', this.onTouchStart, options)
		field.addEventListener('touchmove', this.onTouchMove, options)
		field.addEventListener('touchend', this.onTouchEnd, options)
		field.addEventListener('touchcancel', this.onTouchEnd, options)

		book.addEventListener('pointerdown', this.onPointerDown)
		book.addEventListener('pointermove', this.onPointerMove)
		book.addEventListener('pointerenter', this.onPointerMove)
		book.addEventListener('pointerleave', this.onPointerLeave)
		// Capture, ahead of the canvas's own listeners: this is what keeps paper's
		// `mousedown` out of a stroke this layer is driving. See `onMouseDown`.
		book.addEventListener('mousedown', this.onMouseDown, { capture: true })
		// The samples a finger's `touchmove` didn't carry. See `onCoalescedTouchMove`.
		field.addEventListener('pointermove', this.onCoalescedTouchMove, { capture: true })

		// And the stage's own mouse, on the field because the stage is built by a
		// component this one doesn't own and may not exist yet. Capture, so a press lands
		// here before anything under it; they stand down unless v11 has a stage up.
		field.addEventListener('pointerdown', this.onStagePointerDown, { capture: true })
		field.addEventListener('pointermove', this.onStagePointerMove, { capture: true })
		document.addEventListener('pointerup', this.onStagePointerUp)
		document.addEventListener('pointercancel', this.onStagePointerUp)
		// On the document, because a drag can be released anywhere — the same reason
		// the engine listens for mouseup there rather than on the canvas.
		document.addEventListener('pointerup', this.onPointerUp)
		document.addEventListener('pointercancel', this.onPointerUp)

		// The other hand. The button is in the tray, which is nowhere near either of
		// these elements, so it arrives as a signal rather than as an event.
		this.releaseTool = subscribeToolPressed(this.onToolPressed)
		// And what the transform tool would grab, which changes without the pointer
		// moving — see `onGrab`.
		this.releaseGrab = engine.subscribeGrab(this.onGrab)
		// And the window itself, for v13 — see `onStageChanged`.
		this.releaseStage = subscribeStage(this.onStageChanged)

		this.applyMode()
	}

	get subscribe(): (listener: () => void) => () => void {
		return this.store.subscribe
	}

	get snapshot(): Cursor | null {
		return this.store.snapshot.cursor
	}

	setMode(mode: DrawMode): void {
		if (mode === this.mode) return

		// Whatever is half-done belongs to the mode being left. A gesture that began in
		// v6 and ended in v5 would be neither.
		this.abandon()
		this.mode = mode
		this.applyMode()
	}

	/**
	 * Say where the cursor is again, without anything having moved.
	 *
	 * Picking a tool up changes what the cursor *is* — a ring for the two that mark, one
	 * of four shapes for the one that grabs — and on a desktop that happens by clicking a
	 * button, which moves no pointer and so publishes nothing.
	 */
	refresh(): void {
		this.publish()
	}

	destroy(): void {
		this.abandon()

		const options = { capture: true }
		this.field.removeEventListener('touchstart', this.onTouchStart, options)
		this.field.removeEventListener('touchmove', this.onTouchMove, options)
		this.field.removeEventListener('touchend', this.onTouchEnd, options)
		this.field.removeEventListener('touchcancel', this.onTouchEnd, options)

		this.book.removeEventListener('pointerdown', this.onPointerDown)
		this.book.removeEventListener('pointermove', this.onPointerMove)
		this.book.removeEventListener('pointerenter', this.onPointerMove)
		this.book.removeEventListener('pointerleave', this.onPointerLeave)
		this.book.removeEventListener('mousedown', this.onMouseDown, options)
		this.field.removeEventListener('pointermove', this.onCoalescedTouchMove, options)

		this.field.removeEventListener('pointerdown', this.onStagePointerDown, options)
		this.field.removeEventListener('pointermove', this.onStagePointerMove, options)
		document.removeEventListener('pointerup', this.onStagePointerUp)
		document.removeEventListener('pointercancel', this.onStagePointerUp)
		document.removeEventListener('pointerup', this.onPointerUp)
		document.removeEventListener('pointercancel', this.onPointerUp)

		this.releaseTool?.()
		this.releaseTool = null
		this.releaseGrab?.()
		this.releaseGrab = null
		this.releaseStage?.()
		this.releaseStage = null

		this.engine.setTouchOffset(0)
		this.store.set({ cursor: null })
	}

	/**
	 * The one thing a mode changes outside this file.
	 *
	 * The offset is applied inside the scene rather than here, because in v4 paper is
	 * still doing the drawing and `Scene.pinCoordinates` already owns the one place a
	 * pointer becomes a project point.
	 */
	private applyMode(): void {
		this.engine.setTouchOffset(this.mode === 'v4' ? CURSOR_OFFSET : 0)

		// The middle of the page, every time one of the relative modes is switched on.
		// Somewhere known beats wherever it happened to be left the last time, and the
		// middle is the one place on a 16:9 sheet that is a short drag from anywhere.
		if (this.relative) {
			const box = this.canvas.getBoundingClientRect()
			this.cursorX = box.width / 2
			this.cursorY = box.height / 2
		}

		// And the middle of the *page* for v13's, for the same reason and in its own units.
		if (aimsOffStage(this.mode)) {
			this.cursorPage = centreOf(this.engine.page)
			this.half = 'field'
		}

		this.publish()
	}

	private get relative(): boolean {
		return isRelativeMode(this.mode)
	}

	private get timed(): boolean {
		return isTimedMode(this.mode)
	}

	/** Whether fingers other than the steering one open and close the gesture. */
	private get multiTouch(): boolean {
		return isMultiTouchMode(this.mode)
	}

	/**
	 * The magnified stage, when v11 is on and the layout has left room for one.
	 *
	 * Everything about v11 hangs off this being non-null, and it is asked of the *stage*
	 * rather than of the mode on purpose. The band under the tools is whatever the column
	 * has left over, the stylesheet hides it outright above the breakpoint, and a phone
	 * held sideways has none of it — so "is there a second canvas" is a measurement, and
	 * the mode falls back to v2 whenever the answer is no. One condition, read in one
	 * place, rather than a media query written out again in JavaScript.
	 */
	private get zoom(): Zoom | null {
		if (!isZoomStageMode(this.mode)) return null

		const current = stage()
		return current.view ? { box: current.box, view: current.view, page: current.zoom } : null
	}

	/** Which of a zoomed mode's surfaces a touch landed on, or null for none of them. */
	private surfaceOf(target: EventTarget | null): GestureSurface | null {
		if (!(target instanceof Element)) return null
		if (target.closest(CONTROLS)) return null

		const element = stageElement()
		if (element?.contains(target)) return 'stage'

		// v13's aiming band, which is everywhere the stage and the page's own controls have
		// not already claimed — the white under the tools, and the air either side of the
		// column. Asked before the paper, because in v13 the stage covers the paper and
		// there is no `book` surface left for anything to land on anyway.
		if (aimsOffStage(this.mode)) return 'field'

		// v12 has no overview: its stage stands in the paper's place and covers it, so
		// nothing on the paper is anybody's but the stage's. Said outright rather than left
		// to the stage's box happening to reach every corner — the `book` branch drags a
		// window that mode hasn't got, and a gap in the covering would find it.
		if (stageOnPaper(this.mode)) return null

		return this.book.contains(target) ? 'book' : null
	}

	/**
	 * Where a surface is on screen, which is what a touch has to be measured against.
	 *
	 * The band has no box of its own and needs none: nothing about a gesture down there is
	 * a position on anything, only a delta, so it is measured in client coordinates and
	 * the origin cancels. See `openField`.
	 *
	 * **The stage's box is `.book`'s wherever the stage stands in the paper's place**, and
	 * that is the whole of what keeps a pinch measurable. Those two modes pinch the *sheet*
	 * — the stage element carries a transform and its rectangle grows and slides with it —
	 * so measuring a finger against it would be measuring against a frame that the gesture
	 * is itself moving. `.book` is the same box at rest, is exactly where the paper belongs,
	 * and never moves; `onPage` is what takes the sheet's own offset back out afterwards.
	 * v11's stage is a second canvas in the band with a box of its own, and nothing ever
	 * transforms it.
	 */
	private boxOf(surface: GestureSurface): DOMRect {
		if (surface === 'field') return ORIGIN
		const element = surface === 'stage' && !stageOnPaper(this.mode) ? stageElement() : this.book
		return (element ?? this.book).getBoundingClientRect()
	}

	/** True while the gesture in hand is v13's aiming drag in the band below the drawing. */
	private get aiming(): boolean {
		return this.gesture !== null && this.surface === 'field'
	}

	// --- touch ---------------------------------------------------------------

	/**
	 * Whether a touch landing here is ours, or the control's it landed on.
	 *
	 * In the relative modes the field is the whole page, so most of what is in it is a
	 * button: three tools, three page actions, the page bar and its two arrows, every
	 * thumbnail in the strip, undo, redo and save. Those own their touches outright —
	 * this returns false and the event is left entirely alone, propagation and all, which
	 * is what lets the tray's own touch handlers see a finger arriving on a tool while
	 * another one is already aiming.
	 *
	 * A press on the tray is still felt here, just not as a *finger*: it arrives through
	 * `onToolPressed` as the other hand, which is a different thing and is counted
	 * differently. Letting it be both would have the same press engage the tool twice and
	 * leave it engaged when only one of the two was released.
	 *
	 * The modes that mark at the fingertip want none of the page but the drawing. A
	 * finger down on the empty white below is not aiming at anything up there, and there
	 * is nothing for it to nudge.
	 */
	private ownsTouch(target: EventTarget | null): boolean {
		const element = target instanceof Element ? target : null
		if (element?.closest(CONTROLS)) return false
		if (this.zoom) return this.surfaceOf(target) !== null
		if (!this.relative && !(element && this.book.contains(element))) return false
		return true
	}

	/**
	 * Whether this mode has to take the gesture away from paper.
	 *
	 * The marking tools in the modes that move the ink off the fingertip, and every tool in
	 * the three whose changeover is a button press in all but name — a held tray button,
	 * or a second finger. The difference is what each mode's changeover *is*: the timed
	 * ones and v5 gate ink, and there is no sensible way to half-press a rotation, but a
	 * press is exactly what selecting, marqueeing, moving, scaling and rotating are made
	 * of. So in those three it works, by handing the tool the three events it would have
	 * had.
	 *
	 * Where transform is *not* intercepted it keeps paper's own event handling, and
	 * behaves as it always has — with one exception, v4, which is applied inside the
	 * scene rather than here, so up there a transform gesture grabs 40px above the
	 * fingertip too. Deliberate: that mode's claim is that the contact point and the
	 * working point are different things, and a tool that quietly disagreed would be the
	 * one place it stopped being true.
	 *
	 * **The question is only which mode and which tool, never what the engine is busy
	 * with**, and that is a fix rather than a simplification. It used to hand the gesture
	 * back to paper while a page animation or a load was in flight, and handing a gesture
	 * to paper in a relative mode is wrong by construction: paper works at the
	 * *fingertip*, and up there the fingertip is not the cursor and is not on the drawing
	 * at all. Touching the canvas during the 750ms a duplicate then took therefore dropped
	 * whatever was selected — a transform mousedown arriving somewhere near your thumb —
	 * and a marquee dragged from there was the few pixels the finger moved rather than the
	 * distance the cursor covered. And because interception is decided once, at
	 * `touchstart`, the gesture stayed paper's for as long as the finger was down: the
	 * animation ended and it still didn't work, which is why it read as having to lift and
	 * start again. The animations are gone, and the rule they taught is not.
	 */
	private intercepts(): boolean {
		if (!this.relative && this.mode !== 'v5') return false

		const state = this.engine.store.snapshot
		if (!state.tool) return false
		return drivesAllTools(this.mode) || state.tool === 'pencil' || state.tool === 'eraser'
	}

	private onTouchStart = (event: TouchEvent): void => {
		if (this.swallowsTouch(event)) return

		const touch = event.changedTouches[0]
		if (!touch) return
		if (!this.ownsTouch(event.target)) return

		this.source = 'touch'

		if (this.zoom) {
			this.zoomTouchStart(event)
			return
		}

		if (!this.intercepts()) {
			// Paper's gesture, watched rather than taken: `engaged` is true from the first
			// frame because paper is already working.
			if (this.gesture) return
			this.others.clear()
			this.gesture = this.open(touch, false, true)
			this.publish()
			return
		}

		event.stopPropagation()
		event.preventDefault()

		/*
		 * A finger arriving on top of a gesture already in flight.
		 *
		 * In two modes that is the control itself — the second finger is the button, and
		 * putting it down is what sets the tool working at the cursor. Everywhere else it
		 * is swallowed: one drag, one cursor, and nothing to say about a second contact.
		 */
		if (this.gesture) {
			if (!this.multiTouch) return

			const box = this.canvas.getBoundingClientRect()
			for (const touched of Array.from(event.changedTouches)) {
				if (touched.identifier === this.gesture.id) continue
				this.others.set(touched.identifier, {
					x: touched.clientX - box.left,
					y: touched.clientY - box.top,
				})
			}

			if (this.others.size > 0) this.engage()
			this.publish(box)
			return
		}

		this.others.clear()
		this.gesture = this.open(touch, true, false)

		/*
		 * Which state a gesture opens in is most of what separates these six. v5 and v7
		 * are marking from the frame they are touched; v6 opens with nothing but a cursor;
		 * v8 asks the other hand; and the two-finger modes open with one finger down,
		 * which by definition is not yet two — but their other hand still counts, which is
		 * why v10 asks the same question v8 does.
		 */
		if (this.mode === 'v5' || this.mode === 'v7') this.engage()
		else if (holdsTool(this.mode)) this.engagePress()

		// Only the two with a changeover on a timer. v5 draws for the whole gesture and v8
		// is told when to start, so neither has anything for a timer to do.
		if (this.timed) this.armHold()

		this.publish()
	}

	private onTouchMove = (event: TouchEvent): void => {
		if (this.swallowsTouch(event)) return

		const zoom = this.zoom
		if (zoom) {
			this.zoomTouchMove(event, zoom)
			return
		}

		const gesture = this.gesture
		if (!gesture) return

		const box = this.canvas.getBoundingClientRect()

		/*
		 * How far the cursor should travel, from however many fingers moved.
		 *
		 * The steering finger always counts. In v10 so does every other one, and the
		 * answer is their *average*: one finger moving gives its own delta and two moving
		 * give the mean of the pair.
		 *
		 * "Moved" is whatever the browser says moved. `changedTouches` carries only the
		 * contacts that actually changed in this event, so a resting finger is usually
		 * absent from it and drops out of the average on its own. There was a floor here
		 * for the case where it isn't — a contact that jitters a fraction of a pixel and
		 * halves the mean — and it did more harm than good: a slow, careful drag is *made*
		 * of sub-pixel deltas, so the floor swallowed exactly the movement this exists to
		 * make possible.
		 */
		let sumX = 0
		let sumY = 0
		let movers = 0
		let sawSteering = false

		for (const touched of Array.from(event.changedTouches)) {
			const x = touched.clientX - box.left
			const y = touched.clientY - box.top

			if (touched.identifier === gesture.id) {
				sumX += x - gesture.x
				sumY += y - gesture.y
				gesture.travel += Math.hypot(x - gesture.x, y - gesture.y)
				gesture.x = x
				gesture.y = y
				sawSteering = true
				movers++
				continue
			}

			const other = this.others.get(touched.identifier)
			if (!other) continue

			const dx = x - other.x
			const dy = y - other.y
			other.x = x
			other.y = y

			// Only one mode lets a finger that isn't the steering one steer.
			if (this.mode === 'v10') {
				sumX += dx
				sumY += dy
				movers++
			}
		}

		// Nothing of ours moved — a finger that started on a control, which owns its own
		// gesture. Left alone entirely, propagation included.
		if (!sawSteering && movers === 0) return

		if (gesture.intercepted) {
			event.stopPropagation()
			event.preventDefault()
		}

		// The relative modes take the *difference*, leaving the cursor where it was: this
		// is what lets the finger work at the bottom of the page while the ink lands at
		// the top of the drawing. Everywhere else the finger is the cursor and this is a
		// no-op.
		if (this.relative && movers > 0) {
			this.cursorX = clamp(this.cursorX + sumX / movers, 0, box.width)
			this.cursorY = clamp(this.cursorY + sumY / movers, 0, box.height)
		}

		if (gesture.intercepted) {
			/*
			 * The hold is a hold, not a delay: dragging restarts it, so a finger on its way
			 * somewhere never trips the changeover, and one that has arrived and settled
			 * always does.
			 *
			 * And it can trip any number of times, in both modes. A gesture is a run of
			 * alternating states — aim, draw, aim, draw — and one finger that never leaves
			 * the glass can place several separate strokes with the cursor repositioned
			 * between each. What the mode's name says is only which state a gesture opens
			 * in.
			 *
			 * The cost, and it is a real one: pausing mid-stroke to think about where the
			 * line goes next lifts the pencil off the page. Half a second is not long.
			 * Whether that is worse than having no way back once you have started is the
			 * thing these two are here to find out.
			 */
			if (
				this.timed &&
				Math.hypot(gesture.x - gesture.anchorX, gesture.y - gesture.anchorY) > HOLD_SLOP
			) {
				gesture.anchorX = gesture.x
				gesture.anchorY = gesture.y
				this.armHold()
			}

			if (gesture.engaged && this.mode === 'v5') this.trail(gesture)
			else if (this.relative) {
				gesture.inkX = this.cursorX
				gesture.inkY = this.cursorY
			} else {
				gesture.inkX = gesture.x
				gesture.inkY = gesture.y
			}

			const point = this.engine.toProject(gesture.inkX, gesture.inkY)

			if (gesture.engaged) this.engine.toolDrag(point)
			// A cursor moving with nothing held down is a *hover*, and on a phone there has
			// never been such a thing. It is what shows the transform tool's handles before
			// you commit to one and what puts push's dots under the cursor, both of which a
			// mouse has always got for free.
			else if (this.relative) this.engine.toolHover(point)
		} else if (this.relative) {
			// A relative mode with a tool this layer doesn't intercept — the transform tool
			// in v6 or v7. paper is driving, but the standing cursor still belongs to the
			// finger, so it still moves with it.
			gesture.inkX = this.cursorX
			gesture.inkY = this.cursorY
		} else {
			gesture.inkX = gesture.x
			gesture.inkY = this.mode === 'v4' ? gesture.y - CURSOR_OFFSET : gesture.y
		}

		this.publish(box)
	}

	/**
	 * A finger leaving, which is three different events depending on which finger.
	 *
	 * One of the extras going is the tool being released, unless the other hand is still
	 * holding it. The steering finger going *hands the cursor over* to whichever extra is
	 * still down rather than ending the gesture — lifting the first of two fingers should
	 * not pull the rug out from under the second — and only when nothing is left does the
	 * gesture end.
	 */
	private onTouchEnd = (event: TouchEvent): void => {
		if (this.swallowsTouch(event)) return

		if (this.zoom) {
			this.zoomTouchEnd(event)
			return
		}

		const gesture = this.gesture
		if (!gesture) return

		let steeringLeft = false
		let ours = false
		for (const touched of Array.from(event.changedTouches)) {
			if (touched.identifier === gesture.id) {
				steeringLeft = true
				ours = true
			} else if (this.others.delete(touched.identifier)) ours = true
		}

		if (!ours) return
		if (gesture.intercepted) event.stopPropagation()

		if (steeringLeft) {
			const next = this.others.entries().next()
			if (next.done) {
				this.clearHold()
				this.disengage()

				/*
				 * A tap on the page puts the selection down.
				 *
				 * In the intercepted modes a bare finger only ever moves the cursor, so a
				 * press that went nowhere and never put a tool to work had no other meaning
				 * at all — and without this there is no way to let go of a selection except
				 * by doing something that changes the drawing.
				 *
				 * Both halves of the test are needed and the time is the one earning its
				 * keep: Safari withholds movement until the finger has travelled several
				 * pixels, so a small deliberate nudge of the cursor reports *no* movement
				 * and is a tap by distance alone. It is not a tap by duration. See
				 * `TAP_TIME`.
				 */
				if (gesture.intercepted && !gesture.everEngaged) {
					const quick = performance.now() - gesture.openedAt <= TAP_TIME
					if (quick && gesture.travel <= TAP_SLOP) this.engine.clearSelection()
				}

				this.gesture = null
				this.others.clear()
				this.publish()
				return
			}

			const [id, at] = next.value
			this.others.delete(id)
			gesture.id = id
			gesture.x = at.x
			gesture.y = at.y
			gesture.anchorX = at.x
			gesture.anchorY = at.y
		}

		// Down to one finger: whatever the second one was switching on is over, unless
		// the other hand is holding a tool down as well.
		if (this.multiTouch) this.releaseHold()
		this.publish()
	}

	// --- the zoom stage ------------------------------------------------------

	/*
	 * v11 and v12, the two modes whose answer is a zoomed canvas rather than a different
	 * gesture, and whose touch handling is therefore a different shape from every other
	 * mode's rather than a branch inside it.
	 *
	 * The **stage** is where you draw: one finger, directly under the fingertip, which is
	 * v2's rule. What makes it answer the occlusion problem is that the drawing under the
	 * finger is up to four times life size, so the tip covers proportionally less of it.
	 * Two fingers on it pinch and pan the window.
	 *
	 * That much is both modes. What differs is the *other* surface. In v11 the stage is a
	 * second canvas in the band under the tools, and the **paper** above it is the whole
	 * page with an outline saying which part the stage is showing — a finger up there
	 * moves that outline and makes no mark at all, and a pinch up there reads in the
	 * opposite sense, because the thing under your fingers is the rectangle rather than
	 * the drawing (see `zoomViewport`). In v12 the stage stands in the paper's own place
	 * and there is no overview at all, so `surfaceOf` never answers `book` and everything
	 * below that deals with the paper is simply never reached.
	 *
	 * Nothing here goes near `others`, `holdTimer` or the standing cursor — neither mode
	 * shares that machinery, and interleaving it with the code above would make both
	 * harder to follow than keeping them apart.
	 */

	private zoomTouchStart(event: TouchEvent): void {
		const surface = this.surfaceOf(event.target)
		if (!surface) return

		event.stopPropagation()
		event.preventDefault()

		// A third finger has nothing left to say: two of them are already a pinch.
		if (this.pinch) return

		const gesture = this.gesture
		if (gesture) {
			// A second finger on the *other* surface is not half of anything — they are
			// separate controls — so it is swallowed rather than paired.
			if (surface !== this.surface) return

			// Down in the band a second finger is the on-switch rather than half of a pinch:
			// there is nothing to pinch there, and this is exactly v10's changeover.
			if (surface === 'field') {
				this.holdField(event, gesture)
				return
			}

			const second = Array.from(event.changedTouches).find((t) => t.identifier !== gesture.id)
			if (second) this.beginPinch(gesture, second)
			return
		}

		const touch = event.changedTouches[0]
		if (!touch) return

		this.surface = surface
		this.others.clear()

		if (surface === 'field') {
			// Back into the half the cursor belongs to, and it is drawn from this line on —
			// before anything has moved, so what you see first is where it was left.
			this.half = 'field'
			this.gesture = this.openField(touch)
			// The other hand may have been holding a tool down before this finger landed,
			// which is v8's mechanism and v10's second answer. `onToolPressed` asks the same
			// question from the other side.
			if (this.pressed) this.engagePress()
			// And several contacts in one event, which down here is the on-switch arriving
			// whole rather than a pinch. Same reason `zoomTouchStart` looks for one below.
			this.holdField(event, this.gesture)
			this.publish()
			return
		}

		// A finger on the drawing is v13's other half, and the cursor goes for as long as
		// the hand stays in it. A pinch counts: it is the drawing being handled, and a
		// cursor reappearing at the end of one is the same surprise as at the end of a
		// stroke.
		if (surface === 'stage') this.half = 'stage'

		this.gesture = this.open(touch, surface === 'stage', false, this.boxOf(surface))

		/*
		 * Two fingers in one event, which is a pinch that never had a one-finger phase.
		 *
		 * A browser is allowed to report several contacts as changed in a single
		 * `touchstart` and some do — anything that synthesises touch certainly does. Opened
		 * here rather than left to the second finger's own event, because otherwise the
		 * extra contacts are simply dropped and the gesture goes on being a stroke: two
		 * fingers landing together would draw rather than pinch, and nothing would ever
		 * correct it. Doing it before `engage` is also what means there is no dot to take
		 * back off the page afterwards.
		 */
		const second = Array.from(event.changedTouches).find((t) => t.identifier !== touch.identifier)
		if (second) {
			this.beginPinch(this.gesture, second)
			return
		}

		// The stage marks from the frame it is touched, which is v2's rule and the whole
		// of what this mode takes from it. The paper only ever moves the window.
		if (surface === 'stage') this.engage()

		this.publish()
	}

	private zoomTouchMove(event: TouchEvent, zoom: Zoom): void {
		const pinch = this.pinch
		if (pinch) {
			this.applyPinch(event, pinch, zoom)
			return
		}

		const gesture = this.gesture
		if (!gesture) return

		if (this.surface === 'field') {
			this.moveField(event, zoom, gesture)
			return
		}

		const box = this.boxOf(this.surface)
		let moved = false

		for (const touched of Array.from(event.changedTouches)) {
			if (touched.identifier !== gesture.id) continue

			const x = touched.clientX - box.left
			const y = touched.clientY - box.top
			gesture.travel += Math.hypot(x - gesture.x, y - gesture.y)

			// The samples between the last touchmove and this one, if the pointer event
			// ahead of it carried any. Fed before the point the touch itself carries, which
			// is the last of them and is handled below as it always was.
			if (this.surface === 'stage' && gesture.engaged) {
				for (const sample of this.takeCoalesced(touched)) {
					this.workStageAt(sample.x - box.left, sample.y - box.top, true)
				}
			}

			if (this.surface === 'book') {
				// The outline goes where the finger goes: a delta on the paper is a delta on
				// the page, scaled by however small the paper is being shown. Read from the
				// store rather than from `zoom`, which is a frame old by now.
				const view = stage().view
				const page = this.engine.page
				const from = paperPoint(gesture.x, gesture.y, box, page)
				const to = paperPoint(x, y, box, page)
				if (view)
					setViewport(panViewport(view, to.x - from.x, to.y - from.y, page, aspectOf(zoom.box)))
			}

			gesture.x = x
			gesture.y = y
			gesture.inkX = x
			gesture.inkY = y
			moved = true
		}

		// Nothing of ours moved: a finger that started on a control, which owns it.
		if (!moved) return

		event.stopPropagation()
		event.preventDefault()

		if (this.surface === 'stage') this.workStage(gesture)

		this.publish()
	}

	private zoomTouchEnd(event: TouchEvent): void {
		const ids = Array.from(event.changedTouches).map((touched) => touched.identifier)

		const pinch = this.pinch
		if (pinch) {
			if (!ids.includes(pinch.a.id) && !ids.includes(pinch.b.id)) return

			event.stopPropagation()

			// One finger of a pinch leaving ends the gesture rather than handing the window
			// to the finger that is left: that finger has been steering half of a pinch, and
			// treating its next move as a drag would throw the window sideways at the exact
			// moment somebody is letting go of it.
			this.pinch = null
			this.gesture = null
			this.publish()
			return
		}

		const gesture = this.gesture
		if (!gesture) return

		if (this.surface === 'field') {
			this.endField(event, gesture)
			return
		}

		if (!ids.includes(gesture.id)) return

		event.stopPropagation()

		if (this.surface === 'stage') this.disengage()
		else this.tapPaper(gesture)

		this.gesture = null
		this.publish()
	}

	// --- v13's aiming band ---------------------------------------------------

	/*
	 * v10, run against the zoomed page rather than against the paper, and reached only
	 * from the space around the drawing.
	 *
	 * Everything about it is v10's — a cursor nudged by a delta rather than placed, a
	 * second contact or a held tool button to set it working, either finger steering and
	 * the average of whichever moved — with one substitution: the cursor is a point on the
	 * *page* rather than on the canvas, so the window the stage is showing decides how far
	 * a pixel of finger carries it and where on the glass it is drawn. `cursorPage` has
	 * the reasoning; `stagePlace` is the drawing half of it.
	 *
	 * It is written here rather than shared with the relative modes above because the two
	 * agree about the rule and about nothing else: those measure against the canvas, gate
	 * on `intercepts()`, run the hold timers and can hand the gesture to paper, none of
	 * which is true down here. What they do share is the two constants and `releaseHold`.
	 */

	/**
	 * The gesture in the band, which is measured in client coordinates.
	 *
	 * Nothing about it is a position on a surface — only a delta, and only ever applied to
	 * the cursor — so there is no box to measure against and no box to keep up to date.
	 * `inkX`/`inkY` go unread for the whole of its life: where the mark lands is
	 * `cursorPage`, which belongs to the layer rather than to any one gesture.
	 */
	private openField(touch: Touch): Gesture {
		return {
			id: touch.identifier,
			// paper is cut out of this gesture as thoroughly as it is on the stage: the
			// fingertip is not on the drawing at all, and a mousedown at it would land
			// somewhere near the tray.
			intercepted: true,
			engaged: false,
			everEngaged: false,
			openedAt: performance.now(),
			travel: 0,
			x: touch.clientX,
			y: touch.clientY,
			inkX: touch.clientX,
			inkY: touch.clientY,
			anchorX: touch.clientX,
			anchorY: touch.clientY,
		}
	}

	/** Extra fingers in the band, which are the on-switch. v10's `others`, exactly. */
	private holdField(event: TouchEvent, gesture: Gesture): void {
		for (const touched of Array.from(event.changedTouches)) {
			if (touched.identifier === gesture.id) continue
			this.others.set(touched.identifier, { x: touched.clientX, y: touched.clientY })
		}

		if (this.others.size > 0) this.engage()
		this.publish()
	}

	private moveField(event: TouchEvent, zoom: Zoom, gesture: Gesture): void {
		let sumX = 0
		let sumY = 0
		let movers = 0
		let sawSteering = false

		for (const touched of Array.from(event.changedTouches)) {
			if (touched.identifier === gesture.id) {
				sumX += touched.clientX - gesture.x
				sumY += touched.clientY - gesture.y
				gesture.travel += Math.hypot(touched.clientX - gesture.x, touched.clientY - gesture.y)
				gesture.x = touched.clientX
				gesture.y = touched.clientY
				sawSteering = true
				movers++
				continue
			}

			const other = this.others.get(touched.identifier)
			if (!other) continue

			sumX += touched.clientX - other.x
			sumY += touched.clientY - other.y
			other.x = touched.clientX
			other.y = touched.clientY
			movers++
		}

		// Nothing of ours moved — a finger that started on a control, which owns its own
		// gesture. Left alone entirely, propagation included.
		if (!sawSteering && movers === 0) return

		event.stopPropagation()
		event.preventDefault()

		if (movers > 0) {
			// Read afresh: a pinch on the stage may have moved the paper since `zoom` was
			// taken, and the cursor has to be nudged against the drawing as it stands now.
			const current = stage()
			const view = current.view ?? zoom.view
			const scale = stageOnPaper(this.mode) ? current.zoom.scale : 1

			/*
			 * Screen pixels into page units through the drawing as it is currently *shown*,
			 * rather than at the rate the artwork is stored in. At 1× a pixel of finger is a
			 * pixel of cursor, exactly as it is in v10; with the sheet pinched to 4× it is a
			 * quarter of a page unit, so the same drag places the mark four times as
			 * precisely — and the cursor still travels under the finger at the finger's own
			 * rate, because the scale cancels between the nudge and the drawing of it. That
			 * is the whole bargain of running these two modes together, and it falls out of
			 * holding the cursor in project units rather than being arranged for.
			 */
			const perX = zoom.box.width === 0 ? 0 : view.w / (zoom.box.width * scale)
			const perY = zoom.box.height === 0 ? 0 : view.h / (zoom.box.height * scale)

			// And kept where it can be seen, which off a pinched page is not the same as
			// kept on the page. See `clampCursor`.
			const bounds = this.visibleView() ?? view

			this.cursorPage = {
				x: clamp(this.cursorPage.x + (sumX / movers) * perX, bounds.x, bounds.x + bounds.w),
				y: clamp(this.cursorPage.y + (sumY / movers) * perY, bounds.y, bounds.y + bounds.h),
			}
		}

		const point = this.engine.inProject(this.cursorPage.x, this.cursorPage.y)

		if (gesture.engaged) this.engine.toolDrag(point)
		// A cursor moving with nothing held down is a hover, which is what puts the
		// transform tool's handles and push's dots under it before you commit to either.
		else this.engine.toolHover(point)

		this.publish()
	}

	/**
	 * A finger leaving the band, which is `onTouchEnd`'s three cases again.
	 *
	 * One of the extras going stops the tool, unless the other hand is still holding it.
	 * The steering finger going hands the cursor to whichever extra is left rather than
	 * ending the gesture — lifting the first of two fingers must not pull the rug out from
	 * under the second — and only when nothing is left does the gesture end.
	 */
	private endField(event: TouchEvent, gesture: Gesture): void {
		let steeringLeft = false
		let ours = false
		for (const touched of Array.from(event.changedTouches)) {
			if (touched.identifier === gesture.id) {
				steeringLeft = true
				ours = true
			} else if (this.others.delete(touched.identifier)) ours = true
		}

		if (!ours) return
		event.stopPropagation()

		if (steeringLeft) {
			const next = this.others.entries().next()
			if (next.done) {
				this.disengage()

				// A bare tap down here puts the selection down, exactly as it does in v10: a
				// finger that engaged nothing only ever moved the cursor, so a press that went
				// nowhere had no other meaning — and without it there is no way to let go of a
				// selection except by doing something that changes the drawing. Both halves of
				// the test are needed; see `TAP_TIME`.
				if (!gesture.everEngaged) {
					const quick = performance.now() - gesture.openedAt <= TAP_TIME
					if (quick && gesture.travel <= TAP_SLOP) this.engine.clearSelection()
				}

				this.gesture = null
				this.others.clear()
				this.publish()
				return
			}

			const [id, at] = next.value
			this.others.delete(id)
			gesture.id = id
			gesture.x = at.x
			gesture.y = at.y
		}

		this.releaseHold()
		this.publish()
	}

	/**
	 * Keeps v13's cursor on the part of the page you can actually see, so pinching and
	 * panning never leave it off the screen.
	 *
	 * The alternative is to clamp it to the *page* and let the view slide off it, which is
	 * more faithful to "a thing standing on the drawing" and is worse to use: a cursor you
	 * cannot see is a cursor you have to go and find, and the only way to find it is to pan
	 * back. Being nudged along by the edge of what is showing costs nothing by comparison —
	 * the cursor was going to be moved before it was next used anyway.
	 *
	 * What "showing" means differs between the two shapes of stage, which is why the paper
	 * is measured rather than reasoned about. v11's band shows a window on the page and the
	 * bound is that window. v13's sheet is the whole page at whatever size it has been
	 * pinched to, hanging out of its frame and mostly off the window with it — so the bound
	 * is the overlap between the sheet and the screen, which is `visiblePage`.
	 */
	private clampCursor(): void {
		if (!aimsOffStage(this.mode)) return

		const view = this.visibleView()
		if (!view) return

		this.cursorPage = {
			x: clamp(this.cursorPage.x, view.x, view.x + view.w),
			y: clamp(this.cursorPage.y, view.y, view.y + view.h),
		}
	}

	/** How much of the page there is to stand a cursor on. See `clampCursor`. */
	private visibleView(): Viewport | null {
		const current = stage()
		const view = current.view
		if (!view) return null
		if (!stageOnPaper(this.mode)) return view

		const frame = this.boxOf('stage')
		const { scale, x, y } = current.zoom

		return visiblePage(
			{
				left: frame.left + x,
				top: frame.top + y,
				width: frame.width * scale,
				height: frame.height * scale,
			},
			{ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
			this.engine.page,
		)
	}

	/**
	 * A point on the frame, in the stage's own pixels — the ones its canvas and its cursor
	 * are drawn in, which a pinch does not move.
	 *
	 * The identity in v11, whose stage is never transformed. In v12 and v13 the sheet is
	 * standing somewhere else and at some other size, and this is where that is taken back
	 * out: the frame is `.book`, the same box for the whole of a gesture, and what comes
	 * out is where the finger is on the *paper* however far the paper has been pinched.
	 */
	private stageLocal(x: number, y: number, zoom: Zoom): Point {
		return stageOnPaper(this.mode) ? onPage(zoom.page, x, y) : { x, y }
	}

	/** And the same point in the artwork, which is what every tool is handed. */
	private stagePointAt(x: number, y: number, zoom: Zoom, view: Viewport = zoom.view): Point {
		const at = this.stageLocal(x, y, zoom)
		return stagePoint(view, at.x, at.y, zoom.box)
	}

	/** Puts the tool to work at the point on the page the finger is over on the stage. */
	private workStage(gesture: Gesture): void {
		this.workStageAt(gesture.inkX, gesture.inkY, gesture.engaged)
	}

	/** The same, at a point in the stage's own pixels rather than the gesture's. */
	private workStageAt(x: number, y: number, engaged: boolean): void {
		const view = stage().view
		const zoom = this.zoom
		if (!view || !zoom) return

		const at = this.stagePointAt(x, y, zoom, view)
		const point = this.engine.inProject(at.x, at.y)

		if (engaged) this.engine.toolDrag(point)
		// A cursor moving with nothing down is a hover, which on the stage is what puts the
		// transform tool's handles and push's dots under the fingertip before you commit.
		else this.engine.toolHover(point)
	}

	/**
	 * A tap on the paper puts the window where you tapped.
	 *
	 * The outline is dragged rather than aimed at — a press anywhere on the paper takes
	 * hold of it, which is forgiving and is what you want of a control the size of a
	 * postage stamp — so a press that goes nowhere would otherwise do nothing at all. A
	 * tap is the fast way across the page, and it costs a gesture that was already spent.
	 */
	private tapPaper(gesture: Gesture): void {
		const zoom = this.zoom
		if (!zoom) return
		if (gesture.travel > TAP_SLOP) return
		if (performance.now() - gesture.openedAt > TAP_TIME) return

		const at = paperPoint(gesture.x, gesture.y, this.boxOf('book'), this.engine.page)
		setViewport(centreViewport(zoom.view, at, this.engine.page, aspectOf(zoom.box)))
	}

	/**
	 * A second finger arriving, which turns whatever was happening into a pinch.
	 *
	 * **A stroke it interrupted is taken back off the page, but only if it had just
	 * started, and only if it actually put something there.** Three judgements, and the
	 * third was a bug before it was a rule. A second finger landing within a moment of the
	 * first is a pinch the browser delivered as two events — nobody puts two fingers down
	 * simultaneously — and the dot the first one left is not a mark anybody asked for. A
	 * second finger landing a second later is somebody who has finished a stroke and now
	 * wants to zoom, and throwing that away would be much the worse mistake. So the stroke
	 * is always *ended* and only sometimes undone.
	 *
	 * And the undo is aimed at this gesture's own step rather than at whatever is on top of
	 * the stack. **A two-finger tap can record nothing at all** — `History.commit` refuses
	 * a step for a gesture that left the page as it found it, which an eraser that bit
	 * nothing or a transform that grabbed nothing does — so an undo issued on the strength
	 * of `canUndo` spent itself on the *previous* stroke, and tapping the stage with two
	 * fingers wiped the last thing you drew. `recordedSteps` only ever goes up, so
	 * comparing it across the tick answers "did this gesture leave a step" exactly, where
	 * `canUndo` answered a different question that happened to be true. (The pencil was
	 * the case that found this and is no longer one of them — put down and lifted without
	 * moving it now leaves a dot, and a dot is a step — which is why the comparison stays:
	 * the other two tools still record nothing, and it is what makes the undo below always
	 * take back this gesture's mark and never the one before it.)
	 *
	 * Refusing the pinch until the hand comes off the glass was the other option and is
	 * worse than both: it is a mode you cannot zoom while you are drawing in it.
	 */
	private beginPinch(gesture: Gesture, second: Touch): void {
		if (gesture.engaged) {
			const brief = performance.now() - gesture.openedAt <= PINCH_GRACE
			const recorded = this.engine.recordedSteps
			this.disengage()

			/*
			 * A tick later, because that is when there is a step to take back — or not.
			 * `handlePointerUp` commits on a `setTimeout(0)` of its own — paper dispatches
			 * its own mouseup on the document and the stroke may not be finished when ours
			 * lands — so an undo issued here would find nothing recorded yet. Same delay,
			 * scheduled second, so it runs second and can see what the commit decided.
			 */
			if (brief) {
				window.setTimeout(() => {
					if (this.engine.recordedSteps > recorded) this.engine.undo()
				}, 0)
			}
		}

		const box = this.boxOf(this.surface)
		this.pinch = {
			a: { id: gesture.id, x: gesture.x, y: gesture.y },
			b: { id: second.identifier, x: second.clientX - box.left, y: second.clientY - box.top },
		}

		this.publish()
	}

	/**
	 * Two fingers, one frame: how much they spread and how far they carried.
	 *
	 * Incremental rather than measured against where the pinch began, which matters once
	 * the window hits a limit: an absolute pinch goes on accumulating scale against a
	 * window that has stopped moving, so the fingers have to travel all the way back
	 * before anything happens again. Frame by frame the clamp simply eats the surplus.
	 */
	private applyPinch(event: TouchEvent, pinch: Pinch, zoom: Zoom): void {
		const box = this.boxOf(this.surface)
		const before = spread(pinch)

		let moved = false
		for (const touched of Array.from(event.changedTouches)) {
			const point =
				touched.identifier === pinch.a.id
					? pinch.a
					: touched.identifier === pinch.b.id
						? pinch.b
						: null
			if (!point) continue

			point.x = touched.clientX - box.left
			point.y = touched.clientY - box.top
			moved = true
		}

		if (!moved) return

		event.stopPropagation()
		event.preventDefault()

		const view = stage().view
		if (!view) return

		const after = spread(pinch)
		const ratio = before.distance > 0 ? after.distance / before.distance : 1
		const aspect = aspectOf(zoom.box)
		const page = this.engine.page

		if (this.surface === 'stage' && stageOnPaper(this.mode)) {
			/*
			 * Handling the sheet: fingers apart makes the *paper* bigger and it grows out of
			 * its frame, over the strip and under the page bar and the tray. Nothing is
			 * cropped, because the window was never anything less than the whole page — what
			 * changes is how big the page is drawn and where its corner is.
			 *
			 * Both halves are measured against `.book`, which the transform does not move,
			 * and the anchor is the fingers' own midpoint: what is under them at the start of
			 * the frame is under them at the end of it, which is the only test a pinch has to
			 * pass. The drag is the same midpoint travelling, so two fingers moved together
			 * carry the sheet with them at exactly their own rate.
			 */
			const grown = zoomPage(zoom.page, zoom.box, ratio, { x: before.x, y: before.y })
			setPageZoom(panPage(grown, after.x - before.x, after.y - before.y, zoom.box))
		} else if (this.surface === 'stage') {
			// v11's band, where the thing being handled is the *window*: fingers apart is a
			// closer look, which is a smaller window, and the page under the fingers travels
			// with them — so the window goes the other way.
			const anchor = stagePoint(view, before.x, before.y, zoom.box)
			const zoomed = zoomViewport(view, page, aspect, 1 / ratio, anchor)
			setViewport(
				panViewport(
					zoomed,
					(-(after.x - before.x) * zoomed.w) / (zoom.box.width || 1),
					(-(after.y - before.y) * zoomed.h) / (zoom.box.height || 1),
					page,
					aspect,
				),
			)
		} else {
			// Handling the outline: fingers apart makes the rectangle bigger, which is a
			// wider view, and the rectangle follows the fingers rather than fleeing them.
			const anchor = paperPoint(before.x, before.y, box, page)
			const zoomed = zoomViewport(view, page, aspect, ratio, anchor)
			const from = paperPoint(before.x, before.y, box, page)
			const to = paperPoint(after.x, after.y, box, page)
			setViewport(panViewport(zoomed, to.x - from.x, to.y - from.y, page, aspect))
		}

		// The page has moved under v13's cursor, which is standing on the drawing rather
		// than on the glass and may now be off the side of the screen.
		this.clampCursor()
		this.publish()
	}

	/**
	 * The mouse, in v11, on whichever of the two canvases it is over.
	 *
	 * The stage is a phone control and the stylesheet hides it above the breakpoint, so
	 * this is the laptop with a touchscreen, the narrow window, and the person testing the
	 * mode without a phone in their hand. It borrows the touch path wholesale by
	 * synthesising a gesture with an impossible identifier — `Touch.identifier` is never
	 * negative — so `engage`, `disengage`, `tapPaper` and `publish` need to know nothing
	 * about it. What it hasn't got is a pinch: a mouse has one contact, and the wheel would
	 * be a control this mode doesn't otherwise have.
	 */
	private onStagePointerDown = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		if (!this.zoom || this.gesture) return

		const surface = this.surfaceOf(event.target)
		if (!surface) return
		// v13's aiming band is a finger's answer to a problem a mouse hasn't got, and this
		// is the same stand-down the relative modes make: a mouse has its own arrow, and
		// asking somebody to shove a cursor about with a device that already points at
		// things would be testing a different idea.
		if (surface === 'field') return

		event.stopPropagation()
		this.source = 'mouse'
		this.surface = surface

		const box = this.boxOf(surface)
		const x = event.clientX - box.left
		const y = event.clientY - box.top

		this.gesture = {
			id: MOUSE_GESTURE,
			intercepted: surface === 'stage',
			engaged: false,
			everEngaged: false,
			openedAt: performance.now(),
			travel: 0,
			x,
			y,
			inkX: x,
			inkY: y,
			anchorX: x,
			anchorY: y,
		}

		if (surface === 'stage') this.engage()
		this.publish()
	}

	private onStagePointerMove = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return

		const zoom = this.zoom
		if (!zoom) return

		const gesture = this.gesture
		if (!gesture) {
			// Hovering. Only the stage has a cursor to move; the paper's half of this mode
			// is an outline, and there is nothing up there to draw at an arrow.
			const on = this.surfaceOf(event.target) === 'stage'
			if (!on) {
				if (!this.stageOver) return
				this.stageOver = false
				this.publish()
				return
			}

			this.source = 'mouse'
			this.surface = 'stage'
			this.stageOver = true

			const box = this.boxOf('stage')
			this.hoverStage(event.clientX - box.left, event.clientY - box.top, zoom)
			return
		}

		if (gesture.id !== MOUSE_GESTURE) return

		const box = this.boxOf(this.surface)
		const x = event.clientX - box.left
		const y = event.clientY - box.top
		gesture.travel += Math.hypot(x - gesture.x, y - gesture.y)

		// Every sample the pointer produced since the last event, for the two tools that
		// mark. The last of them is this event's own point and is fed below.
		if (this.surface === 'stage' && gesture.engaged && this.marks) {
			for (const sample of samplesOf(event).slice(0, -1)) {
				this.workStageAt(sample.x - box.left, sample.y - box.top, true)
			}
		}

		if (this.surface === 'book') {
			const view = stage().view
			const page = this.engine.page
			const from = paperPoint(gesture.x, gesture.y, box, page)
			const to = paperPoint(x, y, box, page)
			if (view)
				setViewport(panViewport(view, to.x - from.x, to.y - from.y, page, aspectOf(zoom.box)))
		}

		gesture.x = x
		gesture.y = y
		gesture.inkX = x
		gesture.inkY = y

		if (this.surface === 'stage') this.workStage(gesture)

		this.publish()
	}

	private onStagePointerUp = (): void => {
		const gesture = this.gesture
		if (!gesture || gesture.id !== MOUSE_GESTURE) return

		if (this.surface === 'stage') this.disengage()
		else this.tapPaper(gesture)

		this.gesture = null
		this.publish()
	}

	/** A mouse over the stage with nothing pressed: a ring, and the tool's own hover. */
	private hoverStage(x: number, y: number, zoom: Zoom): void {
		this.mouseX = x
		this.mouseY = y

		const at = this.stagePointAt(x, y, zoom)
		this.engine.toolHover(this.engine.inProject(at.x, at.y))
		this.publish()
	}

	/**
	 * Drags the ink along behind the finger, at a fixed distance.
	 *
	 * Not a lerp towards the finger, which would trail further the faster you moved and
	 * settle onto the fingertip whenever you slowed down — the two moments it most needs
	 * to be somewhere you can see. The ink is simply not allowed to be more than
	 * `TRAIL_DISTANCE` away, and is pulled to exactly that distance when it would be.
	 */
	private trail(gesture: Gesture): void {
		const dx = gesture.x - gesture.inkX
		const dy = gesture.y - gesture.inkY
		const distance = Math.hypot(dx, dy)
		if (distance <= TRAIL_DISTANCE) return

		const pull = (distance - TRAIL_DISTANCE) / distance
		gesture.inkX += dx * pull
		gesture.inkY += dy * pull
	}

	// --- the changeover ------------------------------------------------------

	private armHold(): void {
		this.clearHold()
		this.holdTimer = window.setTimeout(this.onHold, HOLD_DELAY)
	}

	private clearHold(): void {
		if (this.holdTimer === null) return
		window.clearTimeout(this.holdTimer)
		this.holdTimer = null
	}

	/**
	 * Half a second of stillness, and the gesture changes over.
	 *
	 * One rule for both timed modes, because there is only one: whatever it is doing, stop
	 * doing that. v6 opens aiming and v7 opens marking, and from there they are the same
	 * mode read from two different starting points.
	 */
	private onHold = (): void => {
		this.holdTimer = null

		const gesture = this.gesture
		if (!gesture || !this.timed) return

		if (gesture.engaged) this.disengage()
		else this.engage()

		this.publish()
	}

	/**
	 * A tool's button in the tray going down or coming up.
	 *
	 * In the modes that hold, this is the same changeover a second finger makes, decided
	 * by a second hand instead — so it can happen part-way through a drag, which is the
	 * point: press to start working where the cursor already is, release to stop, without
	 * the finger positioning the cursor ever pausing or lifting. In every other mode
	 * holding means nothing and a press is only ever an ordinary tap, which is the branch
	 * at the bottom.
	 *
	 * **Which of the two a press was is decided on the way back up.** A press that did
	 * some work was the tool being used; a press that did none was a tap on the tray, and
	 * picks the tool up. It has to be settled on release rather than on the press, and
	 * that is not a detail: at the moment a button goes down there is no way to know
	 * whether a finger is about to land on the page.
	 *
	 * A press on the tool **already in hand** used to be ambiguous, because for transform
	 * it was also the switch into push, and with a finger aiming every press engages. That
	 * is gone: the fan's two halves are their own controls, so a press here only ever
	 * means "use this tool". See `engagePress`.
	 *
	 * The tray suppresses its own `onClick` for pointer-driven presses, so the tap lands
	 * here and exactly once. Keyboard activation still goes through the click.
	 */
	private onToolPressed = (): void => {
		const id = pressedTool()
		if (id !== null) {
			this.pressed = { id, used: false }
			// Held before the finger arrived: `onTouchStart` will ask again.
			if (this.holdsAtCursor && this.gesture?.intercepted) this.engagePress()
			return
		}

		const press = this.pressed
		this.pressed = null
		if (!press) return

		if (this.holdsAtCursor && this.gesture?.engaged) {
			this.releaseHold()
			this.publish()
			return
		}

		// Nothing happened while it was down, so it was an ordinary tap on the tray and
		// picks the tool up.
		if (!press.used) this.engine.selectTool(press.id)
	}

	/**
	 * Whether a tool held down in the tray works at the cursor right now.
	 *
	 * `holdsTool` for the modes that have one cursor, and in v13 only while the gesture in
	 * hand is the aiming one. A stroke on the stage is the finger's own from end to end,
	 * and a tool button pressed part-way through it must neither claim to have started it
	 * nor end it on the way back up — which is exactly what the release branch below would
	 * do, the stroke being `engaged` by then either way.
	 */
	private get holdsAtCursor(): boolean {
		if (!holdsTool(this.mode)) return false
		return !aimsOffStage(this.mode) || this.aiming || this.gesture === null
	}

	/**
	 * Stops the tool, unless something else is still holding it at work.
	 *
	 * v10 has two ways of saying "now" — a second finger on the page and a tool held down
	 * in the tray — and either will do, so either coming away has to check whether the
	 * other is still there. Letting go of the pencil while two fingers are on the glass
	 * shouldn't cut the stroke off, and neither should lifting the second finger while the
	 * pencil is held. The other modes have only one holder each, and for them this is
	 * `disengage` with a question that always answers the same way.
	 */
	private releaseHold(): void {
		if (this.pressed !== null) return
		if (this.multiTouch && this.others.size > 0) return
		this.disengage()
	}

	/**
	 * Puts the pressed tool to work at the cursor.
	 *
	 * Picks it up if it isn't already in hand, and then leaves it alone. A press means one
	 * thing now — *use this tool* — which it did not while the transform button also had
	 * to switch its own mode: that press had two readings, and with a finger on the page
	 * aiming, every press is also a press, so nothing about the press itself could
	 * separate them. Both inferences were tried on a real phone and both failed. Duration,
	 * because a deliberate press of a button by the other hand is slow and runs past any
	 * threshold worth picking. Distance, because Safari withholds a resting finger's
	 * movement and then delivers ten pixels of it in one event (`lib/zoom.ts`), so the
	 * aiming finger crosses any slop on its own. The fan came apart into two controls
	 * instead, and the question stopped being asked. See `CreateTray`.
	 */
	private engagePress(): void {
		const press = this.pressed
		if (!press) return

		press.used = true

		// Changing tool part-way through a gesture is much of the point of holding one,
		// and the tool in hand has to be put down before the next one picks the gesture
		// up: a stroke left open while the tool underneath it is swapped would be
		// finished by whichever tool happened to answer the release.
		if (this.engine.store.snapshot.tool !== press.id) {
			this.disengage()
			this.engine.selectTool(press.id)
		}

		this.engage()
		this.publish()
	}

	private engage(): void {
		const gesture = this.gesture
		if (!gesture || gesture.engaged) return
		if (!this.engine.store.snapshot.tool) return

		// A flipbook still arriving is being written to a page at a time, and a stroke
		// laid on a page that is about to be replaced is a stroke thrown away. The cursor
		// goes on moving; there is just nothing yet to work on. Adding, duplicating and
		// deleting a page are not this — they are done between one frame and the next.
		if (gesture.intercepted && this.engine.store.snapshot.loading) return

		// And a page being carried to another slot is a page sliding about under the
		// cursor, which is the one state where the mark and the paper genuinely aren't in
		// the same place. Refused here rather than at `touchstart` for the same reason a
		// load is: the layer keeps the gesture and the cursor goes on moving, so letting
		// go of the handle leaves a tool that works rather than one you have to re-arm.
		if (gesture.intercepted && this.engine.store.snapshot.reordering) return

		gesture.engaged = true
		gesture.everEngaged = true

		// v11 works in the stage's own coordinates, which are a window on the page rather
		// than a scaled copy of the whole of it — so the point is mapped through the
		// window and handed over in project units, not through the canvas.
		const zoom = this.zoom
		if (zoom && this.surface === 'stage') {
			const at = this.stagePointAt(gesture.inkX, gesture.inkY, zoom)
			this.engine.toolDown(this.engine.inProject(at.x, at.y))
			return
		}

		// And v13's band works from the cursor, which is already in those units — the
		// fingertip means nothing here, exactly as it means nothing in v10.
		if (zoom && this.surface === 'field') {
			this.engine.toolDown(this.engine.inProject(this.cursorPage.x, this.cursorPage.y))
			return
		}

		// The stroke starts wherever the *cursor* is standing in the relative modes,
		// which is the one place it can start there: the finger's position means nothing,
		// and a stroke that opened under the fingertip and then jumped to the ring would
		// draw a line between the two. A mouse is absolute in every mode — see
		// `publishMouse` — so its stroke starts under the arrow.
		const absolute = gesture.id === POINTER_GESTURE || !this.relative
		gesture.inkX = absolute ? gesture.x : this.cursorX
		gesture.inkY = absolute ? gesture.y : this.cursorY
		this.engine.toolDown(this.engine.toProject(gesture.inkX, gesture.inkY))
	}

	private disengage(): void {
		const gesture = this.gesture
		if (!gesture?.engaged) return

		gesture.engaged = false
		if (gesture.intercepted) this.engine.toolUp()
	}

	/** Ends whatever is in flight without leaving half a stroke on the page. */
	private abandon(): void {
		this.clearHold()
		this.disengage()
		this.gesture = null
		this.others.clear()
		this.pinch = null
		this.surface = 'book'
		this.pressed = null
		this.over = false
		this.held = false
		this.stageOver = false
		this.publish()
	}

	private open(touch: Touch, intercepted: boolean, engaged: boolean, against?: DOMRect): Gesture {
		const box = against ?? this.canvas.getBoundingClientRect()
		const x = touch.clientX - box.left
		const y = touch.clientY - box.top

		return {
			id: touch.identifier,
			intercepted,
			engaged,
			everEngaged: engaged,
			openedAt: performance.now(),
			travel: 0,
			x,
			y,
			// Touching down does not move the cursor in the relative modes — that is the
			// whole difference, and it has to hold from the very first event or the ring
			// would jump to the finger and back on every gesture.
			inkX: this.relative ? this.cursorX : x,
			inkY: this.relative
				? this.cursorY
				: !intercepted && this.mode === 'v4'
					? y - CURSOR_OFFSET
					: y,
			anchorX: x,
			anchorY: y,
		}
	}

	// --- mouse and pen -------------------------------------------------------

	/*
	 * Never one of the drawing modes: a mouse has a visible cursor, sits a pixel wide
	 * and occludes nothing, so every one of those is about a problem it doesn't have.
	 * What it takes from this file is the ring and the transform tool's four shapes,
	 * both of which are drawn at the pointer exactly where the tool is working.
	 *
	 * **The two marking tools are driven from here rather than by paper, though**, and
	 * the reason is the samples. paper listens for `mousemove` and reads one point per
	 * event; a browser delivers one `mousemove` a frame and quietly drops the rest, so a
	 * fast stroke from a 1000 Hz mouse or a 240 Hz pen arrives as sixty points a second
	 * and its curves as chords. `pointermove` carries the dropped ones —
	 * `getCoalescedEvents()`, which every engine has had since Safari 18.2 — so the
	 * pencil and the eraser are fed every sample the hardware produced. The mechanism
	 * is the one the finger already uses on the stage: paper is kept out of the gesture
	 * and the tool is driven through `engine.toolDown`/`toolDrag`/`toolUp`. Keeping
	 * paper out of a *mouse* gesture is one listener, `onMouseDown` below.
	 *
	 * The transform tool stays paper's on a desktop: it grabs rather than marks, so a
	 * dropped sample costs it nothing, and its hover is paper's `onMouseMove`. Only
	 * where there is no stage — with one, `onStagePointerDown` above is already the
	 * pointer-driven path and takes the same samples.
	 *
	 * A pen is a pointer, not a finger. On an iPad it also produces touch events, and
	 * those are swallowed for the length of a gesture this path is driving — see
	 * `swallowsTouch`. Touch pointers are dropped on the floor here, because the touch
	 * listeners above have already dealt with them. Both streams fire for the same
	 * finger.
	 */

	private onPointerDown = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.held = true
		this.over = true

		if (this.interceptsPointer(event)) {
			this.beginPointerStroke(event)
			return
		}

		this.publishMouse(event)
	}

	private onPointerMove = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.over = true

		const gesture = this.gesture
		if (gesture?.id === POINTER_GESTURE) {
			this.movePointerStroke(event, gesture)
			return
		}

		this.publishMouse(event)
	}

	private onPointerUp = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.held = false

		if (this.gesture?.id === POINTER_GESTURE) {
			this.endPointerStroke()
			return
		}

		if (this.over) this.publishMouse(event)
		else this.publish()
	}

	/**
	 * paper's own `mousedown` on the canvas, stopped for a stroke this layer is driving.
	 *
	 * paper binds it in the view's constructor and nothing inside the engine can talk it
	 * out of it, so it is stopped in the capture phase on the canvas's parent — before
	 * the target's listeners run — for exactly the gestures `onPointerDown` took. With
	 * no `mousedown` paper never starts a drag, and its `mousemove` on the document goes
	 * on delivering the hover the transform tool wants. The engine's own `mousedown`
	 * listener on the canvas is stopped with it, and rightly: `toolDown` does that job
	 * for a gesture that arrives this way.
	 *
	 * A pen's compatibility mouse events are prevented at `pointerdown` instead, which
	 * is the one place the spec allows it; this catches a real mouse, for which there is
	 * no such switch.
	 */
	private onMouseDown = (event: MouseEvent): void => {
		if (this.gesture?.id === POINTER_GESTURE) event.stopPropagation()
	}

	/**
	 * Whether a mouse or pen press is a stroke this layer drives, rather than paper's.
	 *
	 * The two marking tools, the main button, and no stage: with one, the stage's own
	 * pointer path is already in charge. Not while a page is being carried or a flipbook
	 * is arriving — `engage` refuses those too, but a press refused there would still
	 * have taken the gesture from paper, and here paper draws nothing either way.
	 */
	private interceptsPointer(event: PointerEvent): boolean {
		if (event.button !== 0 || this.zoom || this.gesture) return false
		if (!this.marks) return false

		const state = this.engine.store.snapshot
		return !state.loading && !state.reordering
	}

	/** Whether the tool in hand is one of the two that mark. Those take every sample. */
	private get marks(): boolean {
		const tool = this.engine.store.snapshot.tool
		return tool === 'pencil' || tool === 'eraser'
	}

	private beginPointerStroke(event: PointerEvent): void {
		// A pen also produces touch events, and cancelling its `pointerdown` is what stops
		// the browser synthesising mouse events out of them for paper to find. A real
		// mouse has no such switch; `onMouseDown` is its half.
		if (event.pointerType !== 'mouse') event.preventDefault()

		// Moves and the release keep coming here however far the stroke runs off the
		// paper — the same reason the engine listens for `mouseup` on the document.
		try {
			this.book.setPointerCapture(event.pointerId)
		} catch {
			// A pointer that has already gone, which the release will say.
		}

		this.source = 'mouse'
		this.surface = 'book'
		this.others.clear()

		const box = this.canvas.getBoundingClientRect()
		const x = event.clientX - box.left
		const y = event.clientY - box.top
		this.mouseX = x
		this.mouseY = y
		this.cursorX = x
		this.cursorY = y

		this.gesture = {
			id: POINTER_GESTURE,
			intercepted: true,
			engaged: false,
			everEngaged: false,
			openedAt: performance.now(),
			travel: 0,
			x,
			y,
			inkX: x,
			inkY: y,
			anchorX: x,
			anchorY: y,
		}

		this.engage()
		this.publish(box)
	}

	private movePointerStroke(event: PointerEvent, gesture: Gesture): void {
		const box = this.canvas.getBoundingClientRect()
		const samples = samplesOf(event)

		if (gesture.engaged) {
			for (const sample of samples) {
				this.engine.toolDrag(this.engine.toProject(sample.x - box.left, sample.y - box.top))
			}
		}

		const last = samples[samples.length - 1] ?? { x: event.clientX, y: event.clientY }
		const x = last.x - box.left
		const y = last.y - box.top
		gesture.travel += Math.hypot(x - gesture.x, y - gesture.y)
		gesture.x = x
		gesture.y = y
		gesture.inkX = x
		gesture.inkY = y
		this.mouseX = x
		this.mouseY = y
		this.cursorX = x
		this.cursorY = y

		this.publish(box)
	}

	private endPointerStroke(): void {
		this.disengage()
		this.gesture = null
		this.publish()
	}

	/**
	 * A touch that belongs to a pointer-driven gesture, which is a pen's.
	 *
	 * A pen fires both streams for one contact. The pointer path took it at
	 * `pointerdown`, which fires first, so by the time its touch events arrive there is
	 * a gesture with a synthetic id in hand — and everything about the contact is
	 * already being handled. Left alone, the touch path would read the pen's touchstart
	 * as a second finger and open a pinch against it. Stopped as well as ignored, so
	 * paper's own touch listeners never see it either.
	 */
	private swallowsTouch(event: TouchEvent): boolean {
		const gesture = this.gesture
		if (!gesture || gesture.id >= 0) return false

		event.stopPropagation()
		if (event.cancelable) event.preventDefault()
		return true
	}

	/**
	 * The samples a finger's `touchmove` doesn't carry.
	 *
	 * Touch events have no coalesced list; pointer events do, and a finger fires both,
	 * `pointermove` first. So the pointer event's samples are put aside here and
	 * `takeCoalesced` hands them to the `touchmove` that follows — matched by position,
	 * because a `Touch.identifier` and a `pointerId` are not promised to agree, and the
	 * last coalesced sample *is* the point the touch event carries. Only on the stage,
	 * only while a marking tool is at work: the aiming band and the relative modes
	 * measure deltas from the finger, and a stash of absolute positions is no use to
	 * them.
	 */
	private onCoalescedTouchMove = (event: PointerEvent): void => {
		if (event.pointerType !== 'touch') return

		const gesture = this.gesture
		if (!gesture?.engaged || this.surface !== 'stage' || !this.marks) {
			this.coalesced = null
			return
		}

		this.coalesced = { x: event.clientX, y: event.clientY, samples: samplesOf(event) }
	}

	/** Everything stashed for `touch` but its own point, or nothing. See above. */
	private takeCoalesced(touch: Touch): Point[] {
		const stash = this.coalesced
		this.coalesced = null
		if (!stash) return []
		if (Math.abs(stash.x - touch.clientX) > 0.5 || Math.abs(stash.y - touch.clientY) > 0.5) {
			return []
		}
		return stash.samples.slice(0, -1)
	}

	private coalesced: { x: number; y: number; samples: Point[] } | null = null

	private onPointerLeave = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.over = false
		// A drag that runs off the edge of the canvas is still a stroke, so the ring goes
		// with it. It stops being drawn when the pointer is neither on the paper nor
		// holding it — and in the relative modes not even then, because there the ring is
		// a thing standing on the page rather than a picture of where the pointer is.
		if (!this.held) this.publish()
	}

	private publishMouse(event: PointerEvent): void {
		// A finger is on the glass; a mouse moving during a touch gesture is not a thing
		// that happens, but a stale mouse cursor drawn over a live one is.
		if (this.gesture) return

		const box = this.canvas.getBoundingClientRect()
		this.source = 'mouse'
		this.mouseX = event.clientX - box.left
		this.mouseY = event.clientY - box.top

		// A mouse is absolute even in the relative modes: it has its own arrow, it is a
		// pixel wide, and asking somebody to shove a cursor around with a device that
		// already points at things would be testing a different idea. It picks the
		// standing cursor up and carries it rather than the two disagreeing — put the
		// mouse down and pick a finger up, and the cursor is where you last had the arrow.
		this.cursorX = this.mouseX
		this.cursorY = this.mouseY

		this.publish(box)
	}

	/**
	 * What the transform tool would grab has changed without the pointer moving.
	 *
	 * It usually changes *because* the pointer moved, and would be picked up by the
	 * publish that move makes — except that paper handles a mouse move on the document,
	 * which is above this layer's element, and pointer events fire ahead of the mouse
	 * events paper is listening for either way. So the affordance read at publish time is
	 * one event behind, which nothing notices while the mouse is moving and everything
	 * notices the moment it stops: park the arrow just inside a selection after crossing
	 * into it and the cursor sits there saying "nothing here" until you jog it.
	 *
	 * Hence a signal rather than a read. The equality check is what keeps it from
	 * doubling every publish a moving mouse already makes.
	 */
	/**
	 * v11's cursor, which is only ever on the stage.
	 *
	 * The paper's half of this mode is an outline rather than a pointer: a finger up
	 * there moves the window and makes no mark, so there is nothing to draw at the
	 * fingertip and drawing one would say there was. What the paper gets instead is
	 * `ZoomWindow`, which reads the same viewport out of the same store.
	 */
	private publishZoom(): void {
		const gesture = this.gesture

		// A pinch has two fingers on the drawing and is moving the page rather than marking
		// on it, so there is nothing to draw a pointer at.
		if (this.pinch) {
			this.store.set({ cursor: null })
			return
		}

		/*
		 * v13 under a finger, which is the whole of the mode's answer and takes the branch
		 * before either of the others.
		 *
		 * There is exactly one cursor here and it belongs to the band: it is on the page
		 * whether anything is touching the glass or not — that is what it takes from v10 —
		 * and it is nowhere at all while the hand is on the drawing, which is what `half`
		 * says. So drawing on the canvas is v12 with no cursor in it, and there is no
		 * moment where one arrives somewhere the hand hasn't been. Drawn on the stage,
		 * because in v13 the stage *is* the drawing: `stagePlace` puts a point of artwork
		 * back on the glass.
		 *
		 * What that gives up is v12's ring on the stage, which says how wide the mark will
		 * be. It says it under a fingertip, where a 6px ring is 40px of finger away from
		 * being visible, so there is nothing there to lose.
		 */
		const zoom = this.zoom

		if (aimsOffStage(this.mode) && this.source === 'touch') {
			if (!zoom || this.half !== 'field') {
				this.store.set({ cursor: null })
				return
			}

			const at = stagePlace(zoom.view, this.cursorPage, zoom.box)
			this.store.set({ cursor: this.stageCursor(at.x, at.y, gesture?.engaged ?? false, true) })
			return
		}

		/*
		 * A finger on the stage: the ring goes under the fingertip, which is v2's rule and
		 * what v11 and v12 take from it.
		 *
		 * In the stage's own pixels rather than the frame's, because that is where it is
		 * drawn: the cursor is a child of the element the pinch transforms, so a ring placed
		 * at the fingertip's distance from `.book` would be carried off by the same scale
		 * that is already taking it there.
		 */
		if (gesture && zoom && this.surface === 'stage') {
			const at = this.stageLocal(gesture.inkX, gesture.inkY, zoom)
			this.store.set({ cursor: this.stageCursor(at.x, at.y, gesture.engaged) })
			return
		}

		// A mouse resting on the stage still wants a ring: it is a pointer over a drawing
		// surface, which is the one thing these modes have in common with the rest. v13's
		// band is a finger's answer and a mouse never reaches this with one, so up here it
		// is v12 exactly.
		if (!gesture && zoom && this.source === 'mouse' && this.stageOver) {
			const at = this.stageLocal(this.mouseX, this.mouseY, zoom)
			this.store.set({ cursor: this.stageCursor(at.x, at.y, false) })
			return
		}

		this.store.set({ cursor: null })
	}

	private stageCursor(x: number, y: number, marking: boolean, standing = false): Cursor {
		const box = this.boxOf('stage')

		return {
			x,
			y,
			inkX: x,
			inkY: y,
			size: box.width,
			top: box.top,
			touching: this.source === 'touch',
			// Not a standing cursor in v11 or v12: it is under the fingertip, exactly as v2's
			// is, and the grey/black pair says "the tool is not working yet" where here it
			// always is. v13's aiming cursor is the exception and asks for it.
			standing,
			surface: 'stage',
			marking,
			affordance: this.engine.transformAffordance(),
		}
	}

	/**
	 * The window has changed shape or moved, with no finger of ours involved.
	 *
	 * Two things do that: the stage being measured for the first time, which is a frame or
	 * two after the page mounts, and a rotation or an address bar re-measuring it. Only
	 * v13 cares, and it cares twice — its cursor is drawn at a place on the *page*, so
	 * where that lands on the glass has just changed, and it has to be published for the
	 * cursor to appear at all before anything is touched.
	 *
	 * A pinch does it too and does not come through here: that path clamps and publishes
	 * for itself, so this stands down while a gesture is in flight rather than publishing
	 * twice a frame through the whole of one.
	 */
	private onStageChanged = (): void => {
		if (!aimsOffStage(this.mode) || this.gesture) return

		this.clampCursor()
		this.publish()
	}

	private onGrab = (): void => {
		const current = this.store.snapshot.cursor
		if (!current) return

		const next = this.engine.transformAffordance()
		if (next.kind === current.affordance.kind && next.angle === current.affordance.angle) return

		this.publish()
	}

	private publish(box?: DOMRect): void {
		if (this.zoom) {
			this.publishZoom()
			return
		}

		const rect = box ?? this.canvas.getBoundingClientRect()
		const gesture = this.gesture

		// A mouse or a pen, resting or drawing: the ring is where the pointer is, and it
		// is a picture of the pointer rather than a thing standing on the page.
		if (this.source === 'mouse' && (!gesture || gesture.id === POINTER_GESTURE)) {
			const shown = this.over || this.held
			this.store.set({
				cursor: shown
					? {
							x: this.mouseX,
							y: this.mouseY,
							inkX: this.mouseX,
							inkY: this.mouseY,
							size: rect.width,
							top: rect.top,
							touching: false,
							standing: false,
							surface: 'book',
							marking: gesture ? gesture.engaged : this.held,
							affordance: this.engine.transformAffordance(),
						}
					: null,
			})
			return
		}

		if (!gesture) {
			// Nothing is on the glass. In the relative modes there is still a cursor — it
			// is standing where it was left, waiting to be nudged — and everywhere else the
			// ring is a picture of a pointer that isn't there, so it goes.
			this.store.set({
				cursor: this.relative
					? {
							x: this.cursorX,
							y: this.cursorY,
							inkX: this.cursorX,
							inkY: this.cursorY,
							size: rect.width,
							top: rect.top,
							touching: false,
							standing: true,
							surface: 'book',
							marking: false,
							affordance: this.engine.transformAffordance(),
						}
					: null,
			})
			return
		}

		this.store.set({
			cursor: {
				// In the relative modes the cursor *is* the pointer as far as anything
				// downstream is concerned: the fingertip is an input to it, not a place on
				// the drawing, and nothing should be drawn at the fingertip.
				x: this.relative ? this.cursorX : gesture.x,
				y: this.relative ? this.cursorY : gesture.y,
				inkX: gesture.inkX,
				inkY: gesture.inkY,
				size: rect.width,
				top: rect.top,
				touching: true,
				standing: this.relative,
				surface: 'book',
				marking: gesture.engaged,
				affordance: this.engine.transformAffordance(),
			},
		})
	}
}

/**
 * Controls that own their own touches, and are therefore not places to aim from.
 *
 * Everything on this page that takes a press is one of these: the tray's six buttons,
 * the page bar's two arrows and its slider, every thumbnail in the page strip, and undo,
 * redo and save. What is left over is the drawing and the air around it.
 *
 * `[data-owns-touch]` is the same statement made by something that isn't a control: the
 * trace photo's placing field, which covers the whole sheet while a photograph is being
 * moved about on it and drives its own pinch. A gesture there is not aiming — the cursor
 * has nothing to do with it — so this layer stands down entirely and leaves the events
 * to bubble, propagation and default included. See `TraceLayer`.
 */
const CONTROLS = 'button, a, input, select, textarea, [role="slider"], [data-owns-touch]'

/**
 * What counts as a tap of a finger on the glass: a press that goes nowhere, quickly.
 *
 * Both halves are needed, and the time is the one doing the work. Safari withholds
 * movement until the finger has travelled several pixels (see `lib/zoom.ts`), so a small
 * deliberate nudge of the cursor reports *no* movement at all and is indistinguishable
 * from a tap by distance alone. It is not indistinguishable by duration: aiming happens
 * at around 9px a second, so a five-pixel nudge takes better than half a second, where a
 * tap is over in a tenth of one.
 *
 * The tray has no use for either number: its buttons say what they mean by *which* one
 * you pressed, not by how you pressed it. `engagePress` has the story.
 */
export const TAP_SLOP = 8
export const TAP_TIME = 400

/**
 * Which tool's button in the tray is being held down right now, if any.
 *
 * A module-level signal rather than a prop because of where its two ends are: the button
 * is in `CreateTray` and the thing that acts on it is a `PointerLayer` built inside
 * `InkCursor`, two branches of the tree apart with the page between them. Threading a
 * callback through both would put the mechanism in four files that have no other use
 * for it.
 *
 * The tool's *id* rather than a boolean, because the layer is what decides what a press
 * means — whether it is picking a tool up or using one — and it cannot decide that
 * without knowing which button went down. See `PointerLayer.onToolPressed`.
 */
const pressed = new Store<{ tool: ModalToolId | null }>({ tool: null })

export function setToolPressed(tool: ModalToolId | null): void {
	pressed.set({ tool })
}

export function pressedTool(): ModalToolId | null {
	return pressed.snapshot.tool
}

export const subscribeToolPressed = pressed.subscribe

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high)
}

/** Which of v11's two canvases something is measured against. See `Cursor.surface`. */
export type Surface = 'book' | 'stage'

/**
 * And where a gesture in one of the zoomed modes began, which is one more place than that.
 *
 * `field` is v13's band — everywhere on the page that isn't the drawing or a control — and
 * it is deliberately not a `Surface`: nothing is ever *drawn* down there, so no cursor is
 * ever measured against it and the two components that render one need never hear of it.
 */
type GestureSurface = Surface | 'field'

/** A box at the origin, for the band, which is measured in client coordinates. */
const ORIGIN = new DOMRect(0, 0, 0, 0)

/** The stage as `PointerLayer` needs it: a window, and the box it is being shown in. */
interface Zoom {
	/** The frame the paper sits in, at rest: the drawing's own box, life size. */
	box: Box
	view: Viewport
	/** Where the paper is standing in that frame, which only a pinch ever changes. */
	page: PageZoom
}

interface Pinch {
	a: { id: number; x: number; y: number }
	b: { id: number; x: number; y: number }
}

/**
 * How soon after a stroke starts a second finger is read as "I meant to pinch".
 *
 * Nobody puts two fingers down at the same instant, so the browser delivers a pinch as
 * two `touchstart`s a few tens of milliseconds apart and the first of them has already
 * drawn a dot. A quarter of a second is comfortably longer than that gap and comfortably
 * shorter than a stroke somebody meant. See `beginPinch`.
 */
const PINCH_GRACE = 250

/** A gesture the mouse is driving on the stage. `Touch.identifier` is never negative. */
const MOUSE_GESTURE = -1

/** A mouse or pen stroke on the paper itself, with no stage. See `onPointerDown`. */
const POINTER_GESTURE = -2

/**
 * Every position a pointer event stands for, oldest first and ending on its own.
 *
 * `getCoalescedEvents()` is the samples the browser folded into this one event to
 * keep to one dispatch a frame; the last of them is the event itself. Engines that
 * don't have it, or a `pointermove` that coalesced nothing, give the one point.
 */
function samplesOf(event: PointerEvent): Point[] {
	const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
	const source = coalesced.length > 0 ? coalesced : [event]
	const points = source
		.map((sample) => ({ x: sample.clientX, y: sample.clientY }))
		// A sample that isn't a position is dropped rather than drawn: a non-finite
		// coordinate fed to the pencil is a stroke of infinite length, and resampling one
		// of those is a loop that never ends.
		.filter((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y))
	return points.length > 0 ? points : [{ x: event.clientX, y: event.clientY }]
}

function aspectOf(box: Box): number {
	return box.height === 0 ? 1 : box.width / box.height
}

/** Two fingers as one thing: where they are between them, and how far apart. */
function spread(pinch: Pinch): { x: number; y: number; distance: number } {
	return {
		x: (pinch.a.x + pinch.b.x) / 2,
		y: (pinch.a.y + pinch.b.y) / 2,
		distance: Math.hypot(pinch.a.x - pinch.b.x, pinch.a.y - pinch.b.y),
	}
}

interface Press {
	id: ModalToolId
	/** Whether the tool has done any work. What tells a hold from a tap on the way up. */
	used: boolean
}

interface Gesture {
	/** `Touch.identifier`, which is what tells the steering finger from the others. */
	id: number
	/** Whether paper was cut out of this gesture, or is drawing it as usual. */
	intercepted: boolean
	engaged: boolean
	/** Whether a tool has worked at any point in this gesture. See `onTouchEnd`. */
	everEngaged: boolean
	/** When the first finger landed, and how far it has been since. Both for the tap. */
	openedAt: number
	travel: number
	x: number
	y: number
	inkX: number
	inkY: number
	/** Where the finger was when the current hold started counting. */
	anchorX: number
	anchorY: number
}

/** The middle of a page, in its own units. Where v13's standing cursor starts and returns to. */
function centreOf(page: PageSize): Point {
	return { x: page.width / 2, y: page.height / 2 }
}

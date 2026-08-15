import { isTouch } from '../lib/device'
import { Store } from '../lib/store'
import {
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
	TRAIL_DISTANCE,
} from './drawModes'
import type { FlipbookEngine } from './engine/FlipbookEngine'
import type { ModalToolId } from './engine/tools/types'
import {
	type Box,
	centreViewport,
	paperPoint,
	panViewport,
	setViewport,
	stage,
	stageElement,
	stagePoint,
	type Viewport,
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
	 * Which canvas the gesture in hand started on. v11's, and only ever `book` elsewhere.
	 *
	 * A gesture belongs to the surface it opened on for the whole of its life: a stroke
	 * that starts on the stage and wanders up over the paper is still a stroke, and a
	 * drag of the outline that wanders down over the stage is still a drag. Deciding it
	 * per event would mean a gesture that changed its mind halfway.
	 */
	private surface: Surface = 'book'

	/** Two fingers moving and resizing the window. v11 only; see `applyPinch`. */
	private pinch: Pinch | null = null

	/** Whether a mouse is over the stage, which is the only thing that draws its ring. */
	private stageOver = false

	/** Drops the two subscriptions. Assigned in the constructor. */
	private releaseTool: (() => void) | null = null
	private releaseGrab: (() => void) | null = null

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
	private get zoom(): { box: Box; view: Viewport } | null {
		if (!isZoomStageMode(this.mode)) return null

		const current = stage()
		return current.view ? { box: current.box, view: current.view } : null
	}

	/** Which of v11's two canvases a touch landed on, or null for neither. */
	private surfaceOf(target: EventTarget | null): Surface | null {
		if (!(target instanceof Element)) return null
		if (target.closest(CONTROLS)) return null

		const element = stageElement()
		if (element?.contains(target)) return 'stage'
		return this.book.contains(target) ? 'book' : null
	}

	/** Where a surface is on screen, which is what a touch has to be measured against. */
	private boxOf(surface: Surface): DOMRect {
		const element = surface === 'stage' ? stageElement() : this.book
		return (element ?? this.book).getBoundingClientRect()
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
	 * at all. Touching the canvas during the 750ms of a duplicate therefore dropped
	 * whatever was selected — a transform mousedown arriving somewhere near your thumb —
	 * and a marquee dragged from there was the few pixels the finger moved rather than the
	 * distance the cursor covered. And because interception is decided once, at
	 * `touchstart`, the gesture stayed paper's for as long as the finger was down: the
	 * animation ended and it still didn't work, which is why it read as having to lift and
	 * start again.
	 */
	private intercepts(): boolean {
		if (!this.relative && this.mode !== 'v5') return false

		const state = this.engine.store.snapshot
		if (!state.tool) return false
		return drivesAllTools(this.mode) || state.tool === 'pencil' || state.tool === 'eraser'
	}

	private onTouchStart = (event: TouchEvent): void => {
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
	 * v11, which is the one mode whose answer is a second canvas rather than a different
	 * gesture, and whose touch handling is therefore a different shape from every other
	 * mode's rather than a branch inside it.
	 *
	 * Two surfaces, and each does exactly one job. The **stage** — the magnified canvas in
	 * the band under the tools — is where you draw, one finger, directly under the
	 * fingertip, which is v2's rule; what makes it answer the occlusion problem is that
	 * the drawing under the finger is two to four times life size, so the tip covers
	 * proportionally less of it. The **paper** above is the whole page with an outline on
	 * it saying which part the stage is showing, and a finger up there moves that outline
	 * and makes no mark at all.
	 *
	 * Two fingers on either surface resize the window, and the two read in opposite
	 * senses on purpose: see `zoomViewport`. Nothing here goes near `others`, `holdTimer`
	 * or the standing cursor — v11 shares none of that machinery, and interleaving it
	 * with the code above would make both harder to follow than keeping them apart.
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
			// A second finger on the *other* canvas is not half of anything — the two
			// surfaces are separate controls — so it is swallowed rather than paired.
			if (surface !== this.surface) return

			const second = Array.from(event.changedTouches).find((t) => t.identifier !== gesture.id)
			if (second) this.beginPinch(gesture, second)
			return
		}

		const touch = event.changedTouches[0]
		if (!touch) return

		this.surface = surface
		this.gesture = this.open(touch, surface === 'stage', false, this.boxOf(surface))

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

		const box = this.boxOf(this.surface)
		let moved = false

		for (const touched of Array.from(event.changedTouches)) {
			if (touched.identifier !== gesture.id) continue

			const x = touched.clientX - box.left
			const y = touched.clientY - box.top
			gesture.travel += Math.hypot(x - gesture.x, y - gesture.y)

			if (this.surface === 'book') {
				// The outline goes where the finger goes: a delta on the paper is a delta on
				// the page, scaled by however small the paper is being shown. Read from the
				// store rather than from `zoom`, which is a frame old by now.
				const view = stage().view
				const from = paperPoint(gesture.x, gesture.y, box)
				const to = paperPoint(x, y, box)
				if (view) setViewport(panViewport(view, to.x - from.x, to.y - from.y, aspectOf(zoom.box)))
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
		if (!gesture || !ids.includes(gesture.id)) return

		event.stopPropagation()

		if (this.surface === 'stage') this.disengage()
		else this.tapPaper(gesture)

		this.gesture = null
		this.publish()
	}

	/** Puts the tool to work at the point on the page the finger is over on the stage. */
	private workStage(gesture: Gesture): void {
		const view = stage().view
		const zoom = this.zoom
		if (!view || !zoom) return

		const at = stagePoint(view, gesture.inkX, gesture.inkY, zoom.box)
		const point = this.engine.inProject(at.x, at.y)

		if (gesture.engaged) this.engine.toolDrag(point)
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

		const at = paperPoint(gesture.x, gesture.y, this.boxOf('book'))
		setViewport(centreViewport(zoom.view, at, aspectOf(zoom.box)))
	}

	/**
	 * A second finger arriving, which turns whatever was happening into a pinch.
	 *
	 * **A stroke it interrupted is taken back off the page, but only if it had just
	 * started.** The two halves of that are separate judgements. A second finger landing
	 * within a moment of the first is a pinch that the browser delivered as two events —
	 * nobody puts two fingers down simultaneously — and the dot the first one left is not
	 * a mark anybody asked for; the step exists by then, so undoing it is exact rather
	 * than approximate, and it costs one entry on the redo stack. A second finger landing
	 * a second later is somebody who has finished a stroke and now wants to zoom, and
	 * throwing that stroke away would be much the worse mistake. So the stroke is always
	 * *ended* and only sometimes undone.
	 *
	 * Refusing the pinch until the hand comes off the glass was the other option and is
	 * worse than both: it is a mode you cannot zoom while you are drawing in it.
	 */
	private beginPinch(gesture: Gesture, second: Touch): void {
		if (gesture.engaged) {
			const brief = performance.now() - gesture.openedAt <= PINCH_GRACE
			this.disengage()

			/*
			 * A tick later, because that is when there is a step to take back.
			 * `handlePointerUp` commits on a `setTimeout(0)` of its own — paper dispatches
			 * its own mouseup on the document and the stroke may not be finished when ours
			 * lands — so an undo issued here reads `canUndo: false`, does nothing at all,
			 * and the mark stays. Same delay, scheduled second, so it runs second.
			 */
			if (brief) {
				window.setTimeout(() => {
					if (this.engine.store.snapshot.canUndo) this.engine.undo()
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

		if (this.surface === 'stage') {
			// Handling the drawing: fingers apart is a closer look, which is a *smaller*
			// window, and the page under the fingers travels with them — so the window goes
			// the other way.
			const anchor = stagePoint(view, before.x, before.y, zoom.box)
			const zoomed = zoomViewport(view, aspect, 1 / ratio, anchor)
			setViewport(
				panViewport(
					zoomed,
					(-(after.x - before.x) * zoomed.w) / (zoom.box.width || 1),
					(-(after.y - before.y) * zoomed.h) / (zoom.box.height || 1),
					aspect,
				),
			)
		} else {
			// Handling the outline: fingers apart makes the rectangle bigger, which is a
			// wider view, and the rectangle follows the fingers rather than fleeing them.
			const anchor = paperPoint(before.x, before.y, box)
			const zoomed = zoomViewport(view, aspect, ratio, anchor)
			const from = paperPoint(before.x, before.y, box)
			const to = paperPoint(after.x, after.y, box)
			setViewport(panViewport(zoomed, to.x - from.x, to.y - from.y, aspect))
		}

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

		if (this.surface === 'book') {
			const view = stage().view
			const from = paperPoint(gesture.x, gesture.y, box)
			const to = paperPoint(x, y, box)
			if (view) setViewport(panViewport(view, to.x - from.x, to.y - from.y, aspectOf(zoom.box)))
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

		const at = stagePoint(zoom.view, x, y, zoom.box)
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
			if (holdsTool(this.mode) && this.gesture?.intercepted) this.engagePress()
			return
		}

		const press = this.pressed
		this.pressed = null
		if (!press) return

		if (holdsTool(this.mode) && this.gesture?.engaged) {
			this.releaseHold()
			this.publish()
			return
		}

		// Nothing happened while it was down, so it was an ordinary tap on the tray and
		// picks the tool up.
		if (!press.used) this.engine.selectTool(press.id)
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
		// goes on moving; there is just nothing yet to work on. A page *animation* is not
		// this — the scene is already in its final shape by the time anything moves, and
		// drawing through one has been allowed since 2013.
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
			const at = stagePoint(zoom.view, gesture.inkX, gesture.inkY, zoom.box)
			this.engine.toolDown(this.engine.inProject(at.x, at.y))
			return
		}

		// The stroke starts wherever the *cursor* is standing in the relative modes,
		// which is the one place it can start there: the finger's position means nothing,
		// and a stroke that opened under the fingertip and then jumped to the ring would
		// draw a line between the two.
		gesture.inkX = this.relative ? this.cursorX : gesture.x
		gesture.inkY = this.relative ? this.cursorY : gesture.y
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
	 * Never intercepted, and never even considered: a mouse has a visible cursor, sits a
	 * pixel wide and occludes nothing, so every one of these modes is about a problem it
	 * doesn't have. What it takes from this file is the ring and the transform tool's four
	 * shapes, both of which are drawn at the pointer exactly where paper is already
	 * working.
	 *
	 * Touch pointers are dropped on the floor here, because the touch listeners above
	 * have already dealt with them. Both streams fire for the same finger.
	 */

	private onPointerDown = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.held = true
		this.over = true
		this.publishMouse(event)
	}

	private onPointerMove = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.over = true
		this.publishMouse(event)
	}

	private onPointerUp = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.held = false
		if (this.over) this.publishMouse(event)
		else this.publish()
	}

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

		if (!gesture) {
			// A mouse resting on the stage still wants a ring: it is a pointer over a
			// drawing surface, which is the one thing this mode has in common with the rest.
			if (this.source === 'mouse' && this.stageOver) {
				this.store.set({ cursor: this.stageCursor(this.mouseX, this.mouseY, false) })
				return
			}

			this.store.set({ cursor: null })
			return
		}

		if (this.pinch || this.surface !== 'stage') {
			this.store.set({ cursor: null })
			return
		}

		this.store.set({ cursor: this.stageCursor(gesture.inkX, gesture.inkY, gesture.engaged) })
	}

	private stageCursor(x: number, y: number, marking: boolean): Cursor {
		const box = this.boxOf('stage')

		return {
			x,
			y,
			inkX: x,
			inkY: y,
			size: box.width,
			top: box.top,
			touching: this.source === 'touch',
			// Not a standing cursor: it is under the fingertip, exactly as v2's is. The
			// grey/black pair says "the tool is not working yet", and here it always is.
			standing: false,
			surface: 'stage',
			marking,
			affordance: this.engine.transformAffordance(),
		}
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

		if (this.source === 'mouse' && !gesture) {
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
							marking: this.held,
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

/** The stage as `PointerLayer` needs it: a window, and the box it is being shown in. */
interface Zoom {
	box: Box
	view: Viewport
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

/** A gesture the mouse is driving. `Touch.identifier` is never negative. */
const MOUSE_GESTURE = -1

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

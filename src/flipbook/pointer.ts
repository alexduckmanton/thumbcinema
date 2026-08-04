import { Store } from '../lib/store'
import {
	CURSOR_OFFSET,
	type DrawMode,
	HOLD_DELAY,
	HOLD_SLOP,
	drivesAllTools,
	isMultiTouchMode,
	isRelativeMode,
	isTimedMode,
	pressedTool,
	TAP_SLOP,
	TAP_TIME,
	subscribeToolPressed,
	TRAIL_DISTANCE,
} from './drawModes'
import type { FlipbookEngine } from './engine/FlipbookEngine'
import type { ModalToolId } from './engine/tools/types'

/**
 * Where the pointer is and what it is doing, in the terms the cursor is drawn in.
 *
 * All four coordinates are CSS pixels from the top left of the canvas, which is what
 * `InkCursor` positions against — see the note at the top of `InkCursor.module.css`
 * for why that box and not the window.
 */
export interface Cursor {
	/** The pointer itself: the fingertip, or the mouse. */
	x: number
	y: number
	/**
	 * Where the mark actually lands.
	 *
	 * The same point as the pointer in most modes. `offset` lifts it clear of the
	 * finger; `steady` lets it trail behind. The ring is drawn here rather than at the
	 * pointer, because the ring's whole job is to say where the ink will be.
	 */
	inkX: number
	inkY: number
	/** How wide the canvas is being shown, which is what maps these onto the artwork. */
	size: number
	/** And how far down the window it starts, which is what stops the loupe leaving it. */
	top: number
	/** True when a finger put it there rather than a mouse. The loupe's condition. */
	touching: boolean
	/** True while ink is being laid down. In the hold modes this is what colours the ring. */
	marking: boolean
	/**
	 * What a drag from here would do to a selection, and along which axis.
	 *
	 * Only ever anything but `none` for the transform tool in `holdTool`, which is the
	 * one place the cursor is doing the pointing rather than a fingertip — so it is
	 * also the one place the tool's own hover cursors describe the wrong thing and
	 * something has to be drawn here instead. `angle` is degrees clockwise from
	 * horizontal, and matters for `scale`.
	 */
	affordance: { kind: 'none' | 'move' | 'scale' | 'rotate'; angle: number }
}

/**
 * The one place a pointer becomes a mark, for as long as there is more than one
 * candidate answer to how a finger should draw.
 *
 * Six of the ten modes cannot be built on top of paper.js, and it is worth being
 * precise about why. paper 0.12 is single-pointer by construction: on a touch device
 * it listens for `touchstart` on the canvas and `touchmove`/`touchend` on the
 * document, and `DomEvent.getPoint` reads `event.targetTouches[0]` — there is one
 * drag in flight and no notion of a pointer id anywhere in it. A gesture that has to
 * start without drawing (`holdToDraw`), stop halfway through (`holdToMove`), put the
 * ink somewhere other than under the finger (`steady`), wait for the other hand
 * (`holdTool`) or watch a *second finger* (`secondFinger`, `twoFinger`) has nowhere
 * to say so. The last two are the plainest case: paper cannot see a second contact
 * at all, so a mode built on one cannot be built on paper.
 *
 * So those six are taken away from paper entirely. This layer listens on `.book`
 * in the **capture** phase, which runs before the canvas's own listeners and before
 * anything can bubble as far as the document, and calls `stopPropagation()` — paper
 * then sees no part of the gesture, and the tool in hand is driven directly through
 * `engine.toolDown`/`toolDrag`/`toolUp` instead. It is touch events that are
 * intercepted rather than pointer events, and that is not a detail: the two are
 * separate streams, and stopping a `pointerdown` does nothing at all to the
 * `touchstart` paper is actually listening for.
 *
 * The other five modes don't need any of that — paper draws as it always has, and
 * this layer only watches, so that the ring and the loupe have somewhere to read the
 * pointer from. Watching is why it owns the mouse as well: one source of truth for
 * where the cursor is beats two sets of listeners that have to agree.
 */
export class PointerLayer {
	private readonly store = new Store<{ cursor: Cursor | null }>({ cursor: null })

	private readonly surface: HTMLElement
	private readonly canvas: HTMLCanvasElement
	private readonly engine: FlipbookEngine

	private mode: DrawMode

	/** The touch steering the cursor, if any. */
	private gesture: Gesture | null = null

	/**
	 * Every other finger on the glass, by `Touch.identifier`.
	 *
	 * Empty in all but two modes, where these are the gesture's on-switch: two or more
	 * fingers down means the tool is working. `twoFinger` also lets them steer, which
	 * is why their positions are kept rather than merely counted — a delta needs
	 * somewhere to be measured from.
	 */
	private readonly others = new Map<number, { x: number; y: number }>()
	private holdTimer: number | null = null

	/** Drops the `holdTool` subscription. Assigned in the constructor. */
	private releaseTool: (() => void) | null = null

	/**
	 * The tool button that is down in `holdTool`, and whether it has done any work.
	 *
	 * `used` is what tells a hold from a tap on the way back up. See `onToolPressed`.
	 */
	private pressed: { id: ModalToolId; used: boolean } | null = null

	/** The mouse, which has states a finger doesn't: it can be over without being down. */
	private over = false
	private held = false

	/**
	 * Where the cursor is standing, in the two modes that have one of its own.
	 *
	 * `holdToDraw` and `holdToMove` are **relative**: a drag moves this by however far
	 * the finger moved, from wherever it already was, and never to where the finger
	 * is. That is the whole point of them — a cursor that jumped to the contact point
	 * would put the mark back under the hand on the first touch of every gesture, and
	 * the modes would be answering nothing. Drag near the left edge and draw in the
	 * middle; the finger and the ink never have to be in the same place again.
	 *
	 * It survives the gesture that moved it, because a cursor you have carefully
	 * placed and then lost by lifting your finger is worse than no cursor. So this is
	 * the layer's state rather than the gesture's, and it is what gets published when
	 * nothing is touching the glass at all.
	 */
	private cursorX = 0
	private cursorY = 0

	constructor(
		surface: HTMLElement,
		canvas: HTMLCanvasElement,
		engine: FlipbookEngine,
		mode: DrawMode,
	) {
		this.surface = surface
		this.canvas = canvas
		this.engine = engine
		this.mode = mode

		// Capture, and non-passive: the first is what puts this in front of paper, the
		// second is what allows `preventDefault()` on an intercepted gesture — which is
		// what stops the browser synthesising a compatibility mouse event out of it.
		const options = { capture: true, passive: false }
		surface.addEventListener('touchstart', this.onTouchStart, options)
		surface.addEventListener('touchmove', this.onTouchMove, options)
		surface.addEventListener('touchend', this.onTouchEnd, options)
		surface.addEventListener('touchcancel', this.onTouchEnd, options)

		surface.addEventListener('pointerdown', this.onPointerDown)
		surface.addEventListener('pointermove', this.onPointerMove)
		surface.addEventListener('pointerenter', this.onPointerMove)
		surface.addEventListener('pointerleave', this.onPointerLeave)
		// On the document, because a drag can be released anywhere — the same reason
		// the engine listens for mouseup there rather than on the canvas.
		document.addEventListener('pointerup', this.onPointerUp)
		document.addEventListener('pointercancel', this.onPointerUp)

		// `holdTool`'s other hand. The button is in the tray, which is nowhere near
		// this element, so it arrives as a signal rather than as an event.
		this.releaseTool = subscribeToolPressed(this.onToolPressed)

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
		// `holdToDraw` and ended in `steady` would be neither.
		this.abandon()
		this.mode = mode
		this.applyMode()
	}

	destroy(): void {
		this.abandon()

		const options = { capture: true }
		this.surface.removeEventListener('touchstart', this.onTouchStart, options)
		this.surface.removeEventListener('touchmove', this.onTouchMove, options)
		this.surface.removeEventListener('touchend', this.onTouchEnd, options)
		this.surface.removeEventListener('touchcancel', this.onTouchEnd, options)

		this.surface.removeEventListener('pointerdown', this.onPointerDown)
		this.surface.removeEventListener('pointermove', this.onPointerMove)
		this.surface.removeEventListener('pointerenter', this.onPointerMove)
		this.surface.removeEventListener('pointerleave', this.onPointerLeave)
		document.removeEventListener('pointerup', this.onPointerUp)
		document.removeEventListener('pointercancel', this.onPointerUp)

		this.releaseTool?.()
		this.releaseTool = null

		this.engine.setTouchOffset(0)
		this.store.set({ cursor: null })
	}

	/**
	 * The one thing a mode changes outside this file.
	 *
	 * The offset is applied inside the scene rather than here, because in that mode
	 * paper is still doing the drawing and `Scene.pinCoordinates` already owns the one
	 * place a pointer becomes a project point.
	 */
	private applyMode(): void {
		this.engine.setTouchOffset(this.mode === 'offset' ? CURSOR_OFFSET : 0)

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

	// --- touch ---------------------------------------------------------------

	/**
	 * Whether this mode has to take the gesture away from paper.
	 *
	 * The marking tools everywhere, and every tool in the three modes whose changeover
	 * is a button press in all but name — a held tray button, or a second finger. The
	 * difference is what each mode's changeover *is*: the timed ones and `steady` gate
	 * ink, and there is no sensible way to half-press a rotation, but a press is
	 * exactly what selecting, marqueeing, moving, scaling and rotating are made of. So
	 * in those three it works, by handing the tool the three events it would have had.
	 *
	 * Where transform is *not* intercepted it keeps paper's own event handling, and
	 * behaves as it always has — with one exception, `offset`, which is applied inside
	 * the scene rather than here, so up there a transform gesture grabs 40px above the
	 * fingertip too. Deliberate: that mode's claim is that the contact point and the
	 * working point are different things, and a tool that quietly disagreed would be
	 * the one place it stopped being true.
	 */
	private intercepts(): boolean {
		if (!this.relative && this.mode !== 'steady') return false

		const state = this.engine.store.snapshot
		if (state.busy || state.loading || !state.tool) return false
		return drivesAllTools(this.mode) || state.tool === 'pencil' || state.tool === 'eraser'
	}

	private onTouchStart = (event: TouchEvent): void => {
		const touch = event.changedTouches[0]
		if (!touch) return

		if (!this.intercepts()) {
			// Paper's gesture, watched rather than taken: `engaged` is true from the
			// first frame because paper is already working.
			this.gesture = this.open(touch, false, true)
			this.publish()
			return
		}

		event.stopPropagation()
		event.preventDefault()

		/*
		 * A finger arriving on top of a gesture already in flight.
		 *
		 * In two modes that is the control itself — the second finger is the button,
		 * and putting it down is what sets the tool working at the cursor. Everywhere
		 * else it is swallowed: one drag, one cursor, and nothing to say about a
		 * second contact.
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
		 * Which state a gesture opens in is most of what separates these six.
		 * `steady` and `holdToMove` are marking from the frame they are touched;
		 * `holdToDraw` opens with nothing but a cursor; `holdTool` asks the other
		 * hand; and the two-finger modes open with one finger down, which by
		 * definition is not yet two.
		 */
		if (this.mode === 'steady' || this.mode === 'holdToMove') this.engage()
		else if (this.mode === 'holdTool') this.engagePress()

		// Only the two with a changeover on a timer. `steady` draws for the whole
		// gesture and `holdTool` is told when to start, so neither has anything for a
		// timer to do.
		if (this.timed) this.armHold()

		this.publish()
	}

	private onTouchMove = (event: TouchEvent): void => {
		const gesture = this.gesture
		if (!gesture) return

		if (gesture.intercepted) {
			event.stopPropagation()
			event.preventDefault()
		}

		const box = this.canvas.getBoundingClientRect()

		/*
		 * How far the cursor should travel, from however many fingers moved.
		 *
		 * The steering finger always counts. In `twoFinger` so does every other one,
		 * and the answer is their *average*: one finger moving gives its own delta and
		 * two moving give the mean of the pair.
		 *
		 * "Moved" is whatever the browser says moved. `changedTouches` carries only the
		 * contacts that actually changed in this event, so a resting finger is usually
		 * absent from it and drops out of the average on its own. There was a floor
		 * here for the case where it isn't — a contact that jitters a fraction of a
		 * pixel and halves the mean — and it did more harm than good: a slow, careful
		 * drag is *made* of sub-pixel deltas, so the floor swallowed exactly the
		 * movement this mode exists to make possible.
		 */
		let sumX = 0
		let sumY = 0
		let movers = 0
		let sawSteering = false

		for (const touched of Array.from(event.changedTouches)) {
			const x = touched.clientX - box.left
			const y = touched.clientY - box.top

			if (touched.identifier === gesture.id) {
				const dx = x - gesture.x
				const dy = y - gesture.y
				gesture.x = x
				gesture.y = y
				gesture.travel += Math.hypot(dx, dy)
				sawSteering = true
				sumX += dx
				sumY += dy
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
			if (this.mode === 'twoFinger') {
				sumX += dx
				sumY += dy
				movers++
			}
		}

		if (!sawSteering && movers === 0) return

		// The relative modes take the *difference* and leave the cursor where it was,
		// which is what lets the finger work in one corner while the ink lands in
		// another. Everywhere else the finger is the cursor and this is a no-op.
		if (this.relative && movers > 0) {
			this.cursorX = clamp(this.cursorX + sumX / movers, 0, box.width)
			this.cursorY = clamp(this.cursorY + sumY / movers, 0, box.height)
		}

		if (gesture.intercepted) {
			/*
			 * The hold is a hold, not a delay: dragging restarts it, so a finger on its
			 * way somewhere never trips the changeover, and one that has arrived and
			 * settled always does.
			 *
			 * And it can trip any number of times, in both modes. A gesture is a run of
			 * alternating states — aim, draw, aim, draw — and one finger that never
			 * leaves the glass can place several separate strokes with the ring
			 * repositioned between each. What the mode name says is only which state
			 * the gesture opens in.
			 *
			 * The cost, and it is a real one: pausing mid-stroke to think about where
			 * the line goes next lifts the pencil off the page. Half a second is not
			 * long. Whether that is worse than having no way back once you have started
			 * is the thing these two modes are here to find out.
			 */
			if (
				this.timed &&
				Math.hypot(gesture.x - gesture.anchorX, gesture.y - gesture.anchorY) > HOLD_SLOP
			) {
				gesture.anchorX = gesture.x
				gesture.anchorY = gesture.y
				this.armHold()
			}

			if (gesture.engaged && this.mode === 'steady') this.trail(gesture)
			else if (this.relative) {
				gesture.inkX = this.cursorX
				gesture.inkY = this.cursorY
			} else {
				gesture.inkX = gesture.x
				gesture.inkY = gesture.y
			}

			const point = this.engine.toProject(gesture.inkX, gesture.inkY)

			if (gesture.engaged) this.engine.toolDrag(point)
			// A cursor moving with nothing held down is a *hover*, and on a phone there
			// has never been such a thing. It is what shows the transform tool's handles
			// before you commit to one and what puts push's dots under the cursor, both
			// of which a mouse has always got for free.
			else if (this.relative) this.engine.toolHover(point)
		} else if (this.relative) {
			// A relative mode with a tool this layer doesn't intercept — the transform
			// tool, or a page animation holding everything. paper is driving, but the
			// standing cursor still belongs to the finger, so it still moves with it.
			gesture.inkX = this.cursorX
			gesture.inkY = this.cursorY
		} else {
			gesture.inkX = gesture.x
			gesture.inkY = this.mode === 'offset' ? gesture.y - CURSOR_OFFSET : gesture.y
		}

		this.publish(box)
	}

	/**
	 * A finger leaving, which is three different events depending on which finger.
	 *
	 * One of the extras going is the tool being released. The steering finger going
	 * *hands the cursor over* to whichever extra is still down rather than ending the
	 * gesture — lifting the first of two fingers should not pull the rug out from
	 * under the second — and only when nothing is left does the gesture end.
	 */
	private onTouchEnd = (event: TouchEvent): void => {
		const gesture = this.gesture
		if (!gesture) return

		if (gesture.intercepted) event.stopPropagation()

		let steeringLeft = false
		for (const touched of Array.from(event.changedTouches)) {
			if (touched.identifier === gesture.id) steeringLeft = true
			else this.others.delete(touched.identifier)
		}

		if (steeringLeft) {
			const next = this.others.entries().next()
			if (next.done) {
				this.clearHold()
				this.disengage()

				/*
				 * A tap on the canvas puts the selection down.
				 *
				 * In these modes a bare finger only ever moves the cursor, so a press
				 * that went nowhere and never put a tool to work had no other meaning at
				 * all — and there was no way to let go of a selection without engaging
				 * something that would change the drawing. Now there is.
				 *
				 * Both halves of `tap` are needed and the time is the one earning its
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

		// Down to one finger: whatever the second one was switching on is over.
		if (this.multiTouch && this.others.size === 0) this.disengage()

		this.publish()
	}

	/**
	 * Drags the ink along behind the finger, at a fixed distance.
	 *
	 * Not a lerp towards the finger, which would trail further the faster you moved
	 * and settle onto the fingertip whenever you slowed down — the two moments it most
	 * needs to be somewhere you can see. The ink is simply not allowed to be more than
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
	 * One rule for both hold modes, because there is only one: whatever it is doing,
	 * stop doing that. `holdToDraw` opens aiming and `holdToMove` opens marking, and
	 * from there they are the same mode read from two different starting points.
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
	 * A tool's button in the tray going down or coming up, in `holdTool`.
	 *
	 * The same changeover the timer makes in the other two, decided by a second hand
	 * instead of by half a second of stillness — so it can happen part-way through a
	 * drag, which is the point: press to start working where the cursor already is,
	 * release to stop, without the finger positioning the cursor ever pausing or
	 * lifting.
	 *
	 * **One button does two jobs, and which one is decided on the way back up.** A
	 * press that did some work was the tool being used; a press that did none was an
	 * ordinary tap on the tray, and gets what a tap has always got — including cycling
	 * transform into push, which is the only way to reach it.
	 *
	 * It has to be settled on release rather than on the press, and that is not a
	 * detail: at the moment a button goes down there is no way to know whether a
	 * finger is about to land on the canvas. Deciding early meant that reaching for
	 * transform a second time — to move a selection you had just made — read as a
	 * second tap and dropped you into push mode without asking.
	 *
	 * The tray suppresses its own `onClick` for pointer-driven presses in this mode,
	 * so the tap lands here and exactly once. Keyboard activation still goes through
	 * the click.
	 */
	private onToolPressed = (): void => {
		if (this.mode !== 'holdTool') return

		const id = pressedTool()
		if (id !== null) {
			this.pressed = { id, used: false }
			// Held before the finger arrived: `onTouchStart` will ask again.
			if (this.gesture?.intercepted) this.engagePress()
			return
		}

		const press = this.pressed
		this.pressed = null

		if (this.gesture?.engaged) {
			this.disengage()
			this.publish()
			return
		}

		if (press && !press.used) this.engine.selectTool(press.id)
	}

	/**
	 * Puts the pressed tool to work at the cursor.
	 *
	 * Picks it up if it isn't already in hand, and then leaves it alone: a hold must
	 * never *cycle*, or holding transform twice in a row would land you in push mode.
	 */
	private engagePress(): void {
		const press = this.pressed
		if (!press) return

		press.used = true

		// Changing tool part-way through a gesture is the point of this mode, and the
		// tool in hand has to be put down before the next one picks the gesture up: a
		// stroke left open while the tool underneath it is swapped would be finished by
		// whichever tool happened to answer the release.
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

		gesture.engaged = true
		gesture.everEngaged = true
		// The stroke starts wherever the *cursor* is standing in the relative modes,
		// which is the one place it must start: the finger's position means nothing
		// there, and a stroke that opened under the fingertip and then jumped to the
		// ring would draw a line between the two.
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
		this.pressed = null
		this.over = false
		this.held = false
		this.publish()
	}

	private open(touch: Touch, intercepted: boolean, engaged: boolean): Gesture {
		const box = this.canvas.getBoundingClientRect()
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
			// Touching down does not move the cursor in the relative modes — that is
			// the difference, and it has to hold from the very first event or the ring
			// would jump to the finger and back on every gesture.
			inkX: this.relative ? this.cursorX : x,
			inkY: this.relative
				? this.cursorY
				: !intercepted && this.mode === 'offset'
					? y - CURSOR_OFFSET
					: y,
			anchorX: x,
			anchorY: y,
		}
	}

	// --- mouse and pen -------------------------------------------------------

	/*
	 * Never intercepted, and never even considered: a mouse has a visible cursor, sits
	 * a pixel wide and occludes nothing, so every one of these modes is about a
	 * problem it doesn't have. What it needs from this file is the ring, which is the
	 * cursor on a desktop.
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
		// A drag that runs off the edge of the canvas is still a stroke, so the ring
		// goes with it. It only stops being drawn when the pointer is neither on the
		// paper nor holding it — and in the relative modes not even then, because
		// there the ring is a thing standing on the page rather than a picture of
		// where the pointer is.
		if (!this.held) this.publish()
	}

	private publishMouse(event: PointerEvent): void {
		// A finger is on the glass; a mouse moving during a touch gesture is not a
		// thing that happens, but a stale mouse cursor drawn over a live one is.
		if (this.gesture) return

		const box = this.canvas.getBoundingClientRect()
		const x = event.clientX - box.left
		const y = event.clientY - box.top

		// A mouse is absolute even in the relative modes: it has its own arrow, it is
		// a pixel wide, and asking somebody to shove a cursor around with a device
		// that already points at things would be testing a different idea. It picks
		// the standing cursor up and carries it, rather than the two disagreeing.
		if (this.relative) {
			this.cursorX = x
			this.cursorY = y
		}

		this.store.set({
			cursor: {
				x,
				y,
				inkX: x,
				inkY: y,
				size: box.width,
				top: box.top,
				touching: false,
				marking: this.held,
				affordance: this.engine.transformAffordance(),
			},
		})
	}

	private publish(box?: DOMRect): void {
		const rect = box ?? this.canvas.getBoundingClientRect()
		const gesture = this.gesture

		if (!gesture) {
			// Nothing is on the glass. In the relative modes there is still a cursor —
			// it is standing where it was left, waiting to be nudged — and everywhere
			// else the ring is a picture of a pointer that isn't there, so it goes.
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
							marking: false,
							affordance: this.engine.transformAffordance(),
						}
					: null,
			})
			return
		}

		this.store.set({
			cursor: {
				// In the relative modes the ring *is* the pointer as far as anything
				// downstream is concerned: the fingertip is an input to it, not a place
				// on the drawing, and nothing should be drawn at the fingertip.
				x: this.relative ? this.cursorX : gesture.x,
				y: this.relative ? this.cursorY : gesture.y,
				inkX: gesture.inkX,
				inkY: gesture.inkY,
				size: rect.width,
				top: rect.top,
				touching: true,
				marking: gesture.engaged,
				affordance: this.engine.transformAffordance(),
			},
		})
	}
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high)
}

interface Gesture {
	/** `Touch.identifier`, which is what makes a second finger ignorable. */
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

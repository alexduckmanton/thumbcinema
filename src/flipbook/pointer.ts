import { Store } from '../lib/store'
import { CURSOR_OFFSET, type DrawMode, HOLD_DELAY, HOLD_SLOP, TRAIL_DISTANCE } from './drawModes'
import type { FlipbookEngine } from './engine/FlipbookEngine'

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
}

/**
 * The one place a pointer becomes a mark, for as long as there is more than one
 * candidate answer to how a finger should draw.
 *
 * Three of the eight modes cannot be built on top of paper.js, and it is worth being
 * precise about why. paper 0.12 is single-pointer by construction: on a touch device
 * it listens for `touchstart` on the canvas and `touchmove`/`touchend` on the
 * document, and `DomEvent.getPoint` reads `event.targetTouches[0]` — there is one
 * drag in flight and no notion of a pointer id anywhere in it. A gesture that has to
 * start without drawing (`holdToDraw`), stop drawing halfway through (`holdToMove`)
 * or put the ink somewhere other than under the finger (`steady`) has nowhere to say
 * so.
 *
 * So those three are taken away from paper entirely. This layer listens on `.book`
 * in the **capture** phase, which runs before the canvas's own listeners and before
 * anything can bubble as far as the document, and calls `stopPropagation()` — paper
 * then sees no part of the gesture, and the marking tool is driven directly through
 * `engine.markBegin`/`markExtend`/`markEnd` instead. It is touch events that are
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

	/** The touch in flight, if any. At most one — a second finger is swallowed. */
	private gesture: Gesture | null = null
	private holdTimer: number | null = null

	/** The mouse, which has states a finger doesn't: it can be over without being down. */
	private over = false
	private held = false

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

		this.engine.setTouchOffset(0)
		this.canvas.style.removeProperty('touch-action')
		this.store.set({ cursor: null })
	}

	/**
	 * The two things a mode changes outside this file.
	 *
	 * The offset is applied inside the scene rather than here, because in that mode
	 * paper is still doing the drawing and `Scene.pinCoordinates` already owns the one
	 * place a pointer becomes a project point.
	 *
	 * `touch-action` is written on the element rather than in the stylesheet for the
	 * same reason `InkCursor` writes `cursor` there: it is a property of the mode, and
	 * the mode is not something CSS can see.
	 */
	private applyMode(): void {
		this.engine.setTouchOffset(this.mode === 'offset' ? CURSOR_OFFSET : 0)

		// `none` is the stylesheet's, and means a drag here is a stroke and never a
		// scroll. `pinch-zoom` gives the browser two-finger gestures back and keeps
		// one-finger ones, which is exactly the trade that mode is testing.
		if (this.mode === 'zoom') this.canvas.style.touchAction = 'pinch-zoom'
		else this.canvas.style.removeProperty('touch-action')
	}

	// --- touch ---------------------------------------------------------------

	/**
	 * Whether this mode has to take the gesture away from paper.
	 *
	 * Only the marking tools. The transform tool has its own hit tests, its own
	 * cursors and four handles to tell apart, and none of that is what these modes are
	 * about, so it keeps paper's own event handling at every setting.
	 *
	 * That leaves it *almost* the same tool in all eight. The exception is `offset`,
	 * which is applied inside the scene rather than here — so up there a transform
	 * gesture grabs 40px above the fingertip too. Deliberate: that mode's claim is
	 * that the contact point and the working point are different things, and a tool
	 * that quietly disagreed would be the one place it stopped being true.
	 */
	private intercepts(): boolean {
		if (this.mode !== 'holdToDraw' && this.mode !== 'holdToMove' && this.mode !== 'steady') {
			return false
		}

		const state = this.engine.store.snapshot
		if (state.busy || state.loading) return false
		return state.tool === 'pencil' || state.tool === 'eraser'
	}

	private onTouchStart = (event: TouchEvent): void => {
		const touch = event.changedTouches[0]
		if (!touch) return

		if (!this.intercepts()) {
			// Paper's gesture, watched rather than taken: `drawing` is true from the
			// first frame because paper is already marking.
			this.gesture = this.open(touch, false, true)
			this.publish()
			return
		}

		event.stopPropagation()
		event.preventDefault()

		// A second finger during a gesture is swallowed rather than acted on. Two
		// fingers mean something in exactly one mode and it isn't one of these three.
		if (this.gesture) return

		// `holdToMove` and `steady` are drawing from the moment they are touched;
		// `holdToDraw` is the one that starts with nothing but a cursor.
		this.gesture = this.open(touch, true, false)
		if (this.mode !== 'holdToDraw') this.startInk()
		this.armHold()
		this.publish()
	}

	private onTouchMove = (event: TouchEvent): void => {
		const gesture = this.gesture
		if (!gesture) return

		const touch = find(event.changedTouches, gesture.id)
		if (!touch) return

		if (gesture.intercepted) {
			event.stopPropagation()
			event.preventDefault()
		}

		const box = this.canvas.getBoundingClientRect()
		gesture.x = touch.clientX - box.left
		gesture.y = touch.clientY - box.top

		if (gesture.intercepted) {
			/*
			 * The hold is a hold, not a delay: dragging restarts it, so a finger on its
			 * way somewhere never trips the changeover, and one that has arrived and
			 * settled always does.
			 *
			 * Whether it can trip twice is the difference between the two hold modes,
			 * and it falls out of what each one is for. `holdToDraw` commits once —
			 * having aimed and started drawing, pausing to think about the next bit of
			 * the line must not silently lift the pencil off the page. `holdToMove` is
			 * a toggle by definition: it stops to let you reposition, so it has to be
			 * able to start again, and a gesture there can lay down several separate
			 * strokes without the finger ever leaving the glass.
			 */
			if (
				(this.mode === 'holdToMove' || !gesture.switched) &&
				Math.hypot(gesture.x - gesture.anchorX, gesture.y - gesture.anchorY) > HOLD_SLOP
			) {
				gesture.anchorX = gesture.x
				gesture.anchorY = gesture.y
				this.armHold()
			}

			if (gesture.drawing && this.mode === 'steady') this.trail(gesture)
			else {
				gesture.inkX = gesture.x
				gesture.inkY = gesture.y
			}

			if (gesture.drawing) {
				this.engine.markExtend(this.engine.toProject(gesture.inkX, gesture.inkY))
			}
		} else {
			gesture.inkX = gesture.x
			gesture.inkY = this.mode === 'offset' ? gesture.y - CURSOR_OFFSET : gesture.y
		}

		this.publish(box)
	}

	private onTouchEnd = (event: TouchEvent): void => {
		const gesture = this.gesture
		if (!gesture) return

		if (gesture.intercepted) event.stopPropagation()
		if (!find(event.changedTouches, gesture.id)) return

		this.clearHold()
		this.stopInk()
		this.gesture = null
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

	private onHold = (): void => {
		this.holdTimer = null

		const gesture = this.gesture
		if (!gesture) return

		if (this.mode === 'holdToDraw') {
			// Once. See the note in `onTouchMove`.
			if (gesture.switched) return
			gesture.switched = true
			this.startInk()
			this.publish()
			return
		}

		if (this.mode !== 'holdToMove') return

		gesture.switched = true
		if (gesture.drawing) this.stopInk()
		else this.startInk()

		this.publish()
	}

	private startInk(): void {
		const gesture = this.gesture
		if (!gesture || gesture.drawing) return

		gesture.drawing = true
		gesture.inkX = gesture.x
		gesture.inkY = gesture.y
		this.engine.markBegin(this.engine.toProject(gesture.inkX, gesture.inkY))
	}

	private stopInk(): void {
		const gesture = this.gesture
		if (!gesture?.drawing) return

		gesture.drawing = false
		if (gesture.intercepted) this.engine.markEnd()
	}

	/** Ends whatever is in flight without leaving half a stroke on the page. */
	private abandon(): void {
		this.clearHold()
		this.stopInk()
		this.gesture = null
		this.over = false
		this.held = false
		this.store.set({ cursor: null })
	}

	private open(touch: Touch, intercepted: boolean, drawing: boolean): Gesture {
		const box = this.canvas.getBoundingClientRect()
		const x = touch.clientX - box.left
		const y = touch.clientY - box.top

		return {
			id: touch.identifier,
			intercepted,
			drawing,
			switched: false,
			x,
			y,
			inkX: x,
			inkY: !intercepted && this.mode === 'offset' ? y - CURSOR_OFFSET : y,
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
		else this.store.set({ cursor: null })
	}

	private onPointerLeave = (event: PointerEvent): void => {
		if (event.pointerType === 'touch') return
		this.over = false
		// A drag that runs off the edge of the canvas is still a stroke, so the ring
		// goes with it. It only stops being drawn when the pointer is neither on the
		// paper nor holding it.
		if (!this.held) this.store.set({ cursor: null })
	}

	private publishMouse(event: PointerEvent): void {
		// A finger is on the glass; a mouse moving during a touch gesture is not a
		// thing that happens, but a stale mouse cursor drawn over a live one is.
		if (this.gesture) return

		const box = this.canvas.getBoundingClientRect()
		const x = event.clientX - box.left
		const y = event.clientY - box.top

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
			},
		})
	}

	private publish(box?: DOMRect): void {
		const gesture = this.gesture
		if (!gesture) {
			this.store.set({ cursor: null })
			return
		}

		const rect = box ?? this.canvas.getBoundingClientRect()
		this.store.set({
			cursor: {
				x: gesture.x,
				y: gesture.y,
				inkX: gesture.inkX,
				inkY: gesture.inkY,
				size: rect.width,
				top: rect.top,
				touching: true,
				marking: gesture.drawing,
			},
		})
	}
}

interface Gesture {
	/** `Touch.identifier`, which is what makes a second finger ignorable. */
	id: number
	/** Whether paper was cut out of this gesture, or is drawing it as usual. */
	intercepted: boolean
	drawing: boolean
	/** Whether the hold has already fired. It fires at most once per gesture. */
	switched: boolean
	x: number
	y: number
	inkX: number
	inkY: number
	/** Where the finger was when the current hold started counting. */
	anchorX: number
	anchorY: number
}

function find(touches: TouchList, id: number): Touch | null {
	for (let i = 0; i < touches.length; i++) {
		const touch = touches[i]
		if (touch && touch.identifier === id) return touch
	}
	return null
}

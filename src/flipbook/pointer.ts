import { isTouch } from '../lib/device'
import { Store } from '../lib/store'
import type { FlipbookEngine } from './engine/FlipbookEngine'
import type { ModalToolId } from './engine/tools/types'

/**
 * Where the pointer is and what it is doing, in the terms the cursor is drawn in.
 *
 * Both coordinates are CSS pixels from the top left of the canvas, which is what
 * `InkCursor` positions against — see the note at the top of `InkCursor.module.css`
 * for why that box and not the window.
 */
export interface Cursor {
	x: number
	y: number
	/**
	 * True when this is the standing cursor rather than a picture of a mouse.
	 *
	 * The two are different objects. A mouse's cursor is where the mouse is, it exists
	 * only while the mouse is over the drawing, and it says nothing about what is
	 * happening because you can see your own hand on the desk. The standing cursor is a
	 * thing a finger pushes around, it is on the page whether anything is touching the
	 * glass or not, and it has to say for itself whether the tool is working — which is
	 * what greys and blackens it. See `.waiting` and `.inking`.
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
 * The one place a finger becomes a mark.
 *
 * A finger is opaque, so the thing you are aiming at on a phone is underneath the thing
 * you are aiming with. Ten answers to that were built and drawn with side by side; the
 * one that survived stops aiming with the finger at all. **The cursor is a thing
 * standing on the page, and a finger anywhere nudges it by however far the finger
 * moved.** It never travels to the contact point — that is the whole idea, and it has to
 * hold from the first event of every gesture or the cursor would jump under the hand and
 * back — and it survives the gesture that moved it, because a cursor you have carefully
 * placed and then lost by lifting your finger is worse than no cursor at all. So the
 * hand and the mark are never in the same place, which is the occlusion problem answered
 * rather than worked around.
 *
 * What sets the tool *working* is a second contact, and there are two of them because
 * they are the same thing: a second finger anywhere on the page, or a tool held down in
 * the tray by the other hand. Both are a mouse button, and which one is to hand depends
 * on how the phone is being held rather than on which is better — so either will do it,
 * and a gesture can have both at once. That is why letting go asks whether the *other*
 * holder is still there; see `releaseHold`.
 *
 * Either finger steers. The cursor follows whichever contacts the browser reports as
 * having moved, and the average of them when more than one has, so a two-finger gesture
 * can be aimed with either hand without the pair having to agree about which is in
 * charge.
 *
 * **None of this can be built on paper.js.** paper 0.12 is single-pointer by
 * construction: on a touch device it listens for `touchstart` on the canvas and
 * `touchmove`/`touchend` on the document, and `DomEvent.getPoint` reads
 * `event.targetTouches[0]` — one drag in flight, and no notion of a pointer id anywhere
 * in it. It cannot see a second contact at all, and it works at the fingertip, which
 * here is not the cursor and is not on the drawing. So touch is taken away from it
 * outright: this layer listens in the **capture** phase, which runs before the canvas's
 * own listeners and before anything can bubble as far as the document, and calls
 * `stopPropagation()`. paper sees no part of a gesture, and the tool in hand is driven
 * directly through `engine.toolDown`/`toolDrag`/`toolUp` instead. It is touch events
 * that are intercepted rather than pointer events, and that is not a detail: the two are
 * separate streams, and stopping a `pointerdown` does nothing at all to the `touchstart`
 * paper is actually listening for.
 *
 * **The field is the whole page, not the drawing.** A cursor that is nudged rather than
 * placed doesn't care where the nudge comes from, and a phone's create page is a column
 * of drawing with a band of empty white under it — which is where a thumb already is,
 * and which nothing else on the page wants. Dragging there aims; the other hand holds a
 * tool, or a second finger lands anywhere, and the tool works up on the paper. Controls
 * keep their own touches: see `ownsTouch`.
 *
 * The mouse is a different question and gets a different surface. It has a visible
 * cursor, sits a pixel wide and occludes nothing, so every part of the above is about a
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

	/** The touch steering the cursor, if any. */
	private gesture: Gesture | null = null

	/**
	 * Every other finger on the glass, by `Touch.identifier`.
	 *
	 * These are the gesture's on-switch: two or more fingers down means the tool is
	 * working. They steer as well, which is why their positions are kept rather than
	 * merely counted — a delta needs somewhere to be measured from.
	 */
	private readonly others = new Map<number, { x: number; y: number }>()

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

	/** Where the cursor is standing. The layer's state, not the gesture's — see above. */
	private cursorX = 0
	private cursorY = 0

	constructor(
		field: HTMLElement,
		book: HTMLElement,
		canvas: HTMLCanvasElement,
		engine: FlipbookEngine,
	) {
		this.field = field
		this.book = book
		this.canvas = canvas
		this.engine = engine

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

		// The middle of the page: somewhere known beats wherever it happened to be left,
		// and the middle is the one place on a 16:9 sheet that is a short drag from
		// anywhere.
		const box = canvas.getBoundingClientRect()
		this.cursorX = box.width / 2
		this.cursorY = box.height / 2

		this.publish()
	}

	get subscribe(): (listener: () => void) => () => void {
		return this.store.subscribe
	}

	get snapshot(): Cursor | null {
		return this.store.snapshot.cursor
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
		document.removeEventListener('pointerup', this.onPointerUp)
		document.removeEventListener('pointercancel', this.onPointerUp)

		this.releaseTool?.()
		this.releaseTool = null
		this.releaseGrab?.()
		this.releaseGrab = null

		this.store.set({ cursor: null })
	}

	// --- touch ---------------------------------------------------------------

	/**
	 * Whether a touch landing here is the drawing's or the control's it landed on.
	 *
	 * The field is the whole page, so most of what is in it is a button: three tools,
	 * three page actions, the page bar and its two arrows, every thumbnail in the strip,
	 * undo, redo and save. Those own their touches outright — this returns false and the
	 * event is left entirely alone, propagation and all, which is what lets the tray's
	 * own touch handlers see a finger arriving on a tool while another one is already
	 * aiming.
	 *
	 * A press on the tray is still felt here, just not as a *finger*: it arrives through
	 * `onToolPressed` as the other hand, which is a different thing and is counted
	 * differently. Letting it be both would have the same press engage the tool twice and
	 * leave it engaged when only one of the two was released.
	 */
	private ownsTouch(target: EventTarget | null): boolean {
		return !(target instanceof Element && target.closest(CONTROLS))
	}

	private onTouchStart = (event: TouchEvent): void => {
		const touch = event.changedTouches[0]
		if (!touch) return
		if (!this.ownsTouch(event.target)) return

		this.source = 'touch'

		event.stopPropagation()
		event.preventDefault()

		/*
		 * A finger arriving on top of a gesture already in flight, which is the control
		 * itself: the second finger is the button, and putting it down is what sets the
		 * tool working at the cursor.
		 */
		if (this.gesture) {
			const box = this.canvas.getBoundingClientRect()
			for (const touched of Array.from(event.changedTouches)) {
				if (touched.identifier === this.gesture.id) continue
				this.others.set(touched.identifier, {
					x: touched.clientX - box.left,
					y: touched.clientY - box.top,
				})
			}

			if (this.others.size > 0) this.engage()
			this.publish()
			return
		}

		this.others.clear()
		this.gesture = this.open(touch)

		// One finger is by definition not yet two — but the other hand still counts, and
		// may have been holding a tool down before this one landed.
		this.engagePress()

		this.publish()
	}

	private onTouchMove = (event: TouchEvent): void => {
		const gesture = this.gesture
		if (!gesture) return

		const box = this.canvas.getBoundingClientRect()

		/*
		 * How far the cursor should travel, from however many fingers moved.
		 *
		 * The steering finger counts and so does every other one, and the answer is their
		 * *average*: one finger moving gives its own delta and two moving give the mean of
		 * the pair.
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

		for (const touched of Array.from(event.changedTouches)) {
			const x = touched.clientX - box.left
			const y = touched.clientY - box.top

			if (touched.identifier === gesture.id) {
				sumX += x - gesture.x
				sumY += y - gesture.y
				gesture.travel += Math.hypot(x - gesture.x, y - gesture.y)
				gesture.x = x
				gesture.y = y
				movers++
				continue
			}

			const other = this.others.get(touched.identifier)
			if (!other) continue

			sumX += x - other.x
			sumY += y - other.y
			other.x = x
			other.y = y
			movers++
		}

		// Nothing of ours moved — a finger that started on a control, which owns its own
		// gesture. Left alone entirely, propagation included.
		if (movers === 0) return

		event.stopPropagation()
		event.preventDefault()

		// The *difference*, leaving the cursor where it was: this is what lets the finger
		// work at the bottom of the page while the ink lands at the top of the drawing.
		this.cursorX = clamp(this.cursorX + sumX / movers, 0, box.width)
		this.cursorY = clamp(this.cursorY + sumY / movers, 0, box.height)

		const point = this.engine.toProject(this.cursorX, this.cursorY)

		if (gesture.engaged) this.engine.toolDrag(point)
		// A cursor moving with nothing held down is a *hover*, and on a phone there has
		// never been such a thing. It is what shows the transform tool's handles before
		// you commit to one and what puts push's dots under the cursor, both of which a
		// mouse has always got for free.
		else this.engine.toolHover(point)

		this.publish()
	}

	/**
	 * A finger leaving, which is two different things depending on which finger.
	 *
	 * One of the extras going is the tool being released, unless the other hand is still
	 * holding it. The steering finger going *hands the cursor over* to whichever extra is
	 * still down rather than ending the gesture — lifting the first of two fingers should
	 * not pull the rug out from under the second — and only when nothing is left does the
	 * gesture end.
	 */
	private onTouchEnd = (event: TouchEvent): void => {
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
		event.stopPropagation()

		if (steeringLeft) {
			const next = this.others.entries().next()
			if (next.done) {
				this.disengage()

				/*
				 * A tap on the page puts the selection down.
				 *
				 * A bare finger only ever moves the cursor, so a press that went nowhere
				 * and never put a tool to work had no other meaning at all — and without
				 * this there is no way to let go of a selection except by doing something
				 * that changes the drawing.
				 *
				 * Both halves of the test are needed and the time is the one earning its
				 * keep: Safari withholds movement until the finger has travelled several
				 * pixels, so a small deliberate nudge of the cursor reports *no* movement
				 * and is a tap by distance alone. It is not a tap by duration. See
				 * `TAP_TIME`.
				 */
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

		// Down to one finger: whatever the second one was switching on is over, unless
		// the other hand is holding a tool down as well.
		this.releaseHold()
		this.publish()
	}

	// --- the changeover ------------------------------------------------------

	/**
	 * A tool's button in the tray going down or coming up.
	 *
	 * The same changeover a second finger makes, decided by a second hand instead — so it
	 * can happen part-way through a drag, which is the point: press to start working
	 * where the cursor already is, release to stop, without the finger positioning the
	 * cursor ever pausing or lifting.
	 *
	 * **One button does two jobs, and which one is decided on the way back up.** A press
	 * that did some work was the tool being used; a press that did none was an ordinary
	 * tap on the tray, and gets what a tap has always got — including cycling transform
	 * into push, which is the only way to reach it.
	 *
	 * It has to be settled on release rather than on the press, and that is not a detail:
	 * at the moment a button goes down there is no way to know whether a finger is about
	 * to land on the canvas. Deciding early meant that reaching for transform a second
	 * time — to move a selection you had just made — read as a second tap and dropped you
	 * into push mode without asking.
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
			if (this.gesture) this.engagePress()
			return
		}

		const press = this.pressed
		this.pressed = null
		if (!press) return

		if (this.gesture?.engaged) {
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
	 * There are two ways of saying "now" — a second finger on the page and a tool held
	 * down in the tray — and either will do, so either coming away has to check whether
	 * the other is still there. Letting go of the pencil while two fingers are on the
	 * glass shouldn't cut the stroke off, and neither should lifting the second finger
	 * while the pencil is held.
	 */
	private releaseHold(): void {
		if (this.pressed !== null) return
		if (this.others.size > 0) return
		this.disengage()
	}

	/**
	 * Puts the pressed tool to work at the cursor.
	 *
	 * Picks it up if it isn't already in hand, and then leaves it alone. A press means
	 * one thing now — *use this tool* — which it did not while the transform button also
	 * had to switch its own mode: that press had two readings, and with a finger on the
	 * page aiming, every press is also a press, so nothing about the press itself could
	 * separate them. Both inferences were tried on a real phone and both failed.
	 * Duration, because a deliberate press of a button by the other hand is slow and runs
	 * past any threshold worth picking. Distance, because Safari withholds a resting
	 * finger's movement and then delivers ten pixels of it in one event (`lib/zoom.ts`),
	 * so the aiming finger crosses any slop on its own. The fan came apart into two
	 * controls instead, and the question stopped being asked. See `CreateTray`.
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
		if (this.engine.store.snapshot.loading) return

		gesture.engaged = true
		gesture.everEngaged = true
		// The stroke starts wherever the *cursor* is standing, which is the one place it
		// can start: the finger's position means nothing here, and a stroke that opened
		// under the fingertip and then jumped to the ring would draw a line between the
		// two.
		this.engine.toolDown(this.engine.toProject(this.cursorX, this.cursorY))
	}

	private disengage(): void {
		const gesture = this.gesture
		if (!gesture?.engaged) return

		gesture.engaged = false
		this.engine.toolUp()
	}

	/** Ends whatever is in flight without leaving half a stroke on the page. */
	private abandon(): void {
		this.disengage()
		this.gesture = null
		this.others.clear()
		this.pressed = null
		this.over = false
		this.held = false
		this.publish()
	}

	private open(touch: Touch): Gesture {
		const box = this.canvas.getBoundingClientRect()

		return {
			id: touch.identifier,
			engaged: false,
			everEngaged: false,
			openedAt: performance.now(),
			travel: 0,
			// Touching down does not move the cursor — that is the whole difference, and
			// it has to hold from the very first event or the ring would jump to the
			// finger and back on every gesture.
			x: touch.clientX - box.left,
			y: touch.clientY - box.top,
		}
	}

	// --- mouse and pen -------------------------------------------------------

	/*
	 * Never intercepted, and never even considered: a mouse has a visible cursor, sits a
	 * pixel wide and occludes nothing, so all of the above is about a problem it doesn't
	 * have. What it takes from this file is the ring and the transform tool's four
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
		// holding it.
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

		// The standing cursor is picked up and carried rather than left somewhere else to
		// disagree: put the mouse down and pick a finger up, and the cursor is where you
		// last had the arrow.
		this.cursorX = this.mouseX
		this.cursorY = this.mouseY

		this.publish()
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
	private onGrab = (): void => {
		const current = this.store.snapshot.cursor
		if (!current) return

		const next = this.engine.transformAffordance()
		if (next.kind === current.affordance.kind && next.angle === current.affordance.angle) return

		this.publish()
	}

	private publish(): void {
		const gesture = this.gesture

		if (this.source === 'mouse' && !gesture) {
			this.store.set({
				cursor:
					this.over || this.held
						? {
								x: this.mouseX,
								y: this.mouseY,
								standing: false,
								marking: this.held,
								affordance: this.engine.transformAffordance(),
							}
						: null,
			})
			return
		}

		// The standing cursor, which is always somewhere: it is a thing on the page
		// waiting to be nudged, not a picture of where a pointer happens to be, so it is
		// published whether anything is touching the glass or not.
		this.store.set({
			cursor: {
				x: this.cursorX,
				y: this.cursorY,
				standing: true,
				marking: gesture?.engaged ?? false,
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
 */
const CONTROLS = 'button, a, input, select, textarea, [role="slider"]'

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

interface Press {
	id: ModalToolId
	/** Whether the tool has done any work. What tells a hold from a tap on the way up. */
	used: boolean
}

interface Gesture {
	/** `Touch.identifier`, which is what tells the steering finger from the others. */
	id: number
	engaged: boolean
	/** Whether a tool has worked at any point in this gesture. See `onTouchEnd`. */
	everEngaged: boolean
	/** When the first finger landed, and how far it has been since. Both for the tap. */
	openedAt: number
	travel: number
	x: number
	y: number
}

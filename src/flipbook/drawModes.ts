import { Store, useStore } from '../lib/store'
import type { ModalToolId } from './engine/tools/types'

/**
 * The drawing modes, which exist to be compared against each other.
 *
 * A finger is opaque, and the thing you are aiming at on a phone is underneath the
 * thing you are aiming with. There is no settled answer to that — the survey of what
 * other drawing tools do turned up four separate families of answer and no consensus
 * — so rather than pick one blind, all of them are here behind a switch, and the one
 * that survives being drawn with wins.
 *
 * This is a testbed. When a mode is chosen, the rest go, along with the switch, this
 * file and most of `engine/pointer.ts`.
 *
 * Where each one comes from:
 *
 *  - `loupe` is what the tool shipped with, and is the one the others have to beat.
 *  - `ring` is the control: the same tool with the magnifier taken away.
 *  - `corner` is TouchRetouch's, and photo retouching's generally — the magnified
 *    view is pinned in a corner instead of following, so it never sits under the
 *    hand and never jumps, at the cost of having to look away from the mark.
 *  - `offset` is the oldest answer there is (Potter's "take-off", 1988): the mark
 *    lands a fixed distance from the contact point, so the finger is never on it.
 *  - `holdToDraw` and `holdToMove` are the two halves of the same idea, and the two
 *    that give up on direct manipulation altogether. The ring is a thing standing on
 *    the page; a finger anywhere on the glass *nudges* it by however far the finger
 *    moved, and never carries it to the contact point. So the hand and the mark are
 *    never in the same place, which is the occlusion problem answered rather than
 *    worked around. Half a second of stillness changes the gesture over, as often as
 *    you like, so one finger that never leaves the glass can aim, draw, re-aim and
 *    draw again — and the *only* thing that differs between the two is which of the
 *    two states a gesture opens in. Nothing shipping does this on a canvas; the
 *    nearest relative is a phone keyboard's trackpad mode, which places a text cursor
 *    exactly this way and is the reason iOS's magnifier was arguably never the
 *    better answer.
 *  - `holdTool` is the same relative cursor with the timer taken out and a second
 *    hand put in: you press and hold a tool in the tray, and it works at the cursor
 *    for exactly as long as you hold it. Two hands, and nothing to wait for. This is
 *    the family Adobe Fresco's Touch Shortcut belongs to — a modifier held somewhere
 *    other than the canvas, by the hand that isn't drawing — and it is the only mode
 *    here where starting and stopping are a decision rather than an inference.
 *
 *    It is also the only one that covers all three tools rather than the two that
 *    mark, which falls out of the mechanism: a held button is a mouse button, and a
 *    mouse button is what selecting, marqueeing, moving, scaling and rotating have
 *    always been made of. The others gate *ink*, and there is no sensible way to
 *    half-press a rotation.
 *  - `secondFinger` and `twoFinger` move the modifier off the tray and onto the page.
 *    Two fingers down means the tool is working; one means you are only aiming. They
 *    differ in who steers: `secondFinger` keeps the cursor on the first finger and
 *    treats every other one as a button, `twoFinger` lets either finger steer and
 *    averages whichever ones the browser reports as having moved. `twoFinger` also
 *    takes `holdTool`'s button, so either hand can be the one that starts the work —
 *    see `holdsTool`. Both are only
 *    possible because this layer takes the touch stream away from paper — paper has
 *    one drag in flight and reads `targetTouches[0]`, so a second finger is invisible
 *    to it.
 *  - `steady` is Autodesk Sketchbook's Steady Stroke, whose documentation names
 *    finger drawing as the case it was built for: the ink is dragged along behind
 *    the finger like a brush with long bristles, which both smooths the line and
 *    leaves it somewhere you can see it.
 */
export type DrawMode =
	| 'loupe'
	| 'ring'
	| 'corner'
	| 'offset'
	| 'holdToDraw'
	| 'holdToMove'
	| 'holdTool'
	| 'secondFinger'
	| 'twoFinger'
	| 'steady'

export interface DrawModeInfo {
	id: DrawMode
	/** What the picker says. Kept short enough to read in a native select on a phone. */
	label: string
	/** What to expect, for the moment a mode is picked and its rules aren't obvious. */
	hint: string
}

export const DRAW_MODES: readonly DrawModeInfo[] = [
	{
		id: 'loupe',
		label: 'Loupe (current)',
		hint: 'A magnifier floats above your finger while you draw.',
	},
	{
		id: 'ring',
		label: 'Ring only',
		hint: 'No magnifier. The ring, and nothing else.',
	},
	{
		id: 'corner',
		label: 'Corner magnifier',
		hint: 'The magnifier is pinned in a corner instead of following your finger.',
	},
	{
		id: 'offset',
		label: 'Offset cursor (40px up)',
		hint: 'The line lands 40px above your fingertip.',
	},
	{
		id: 'holdToDraw',
		label: 'Move, hold to draw',
		hint: 'The ring stays put and your finger nudges it, from anywhere on the page. Hold still for half a second to start drawing, and again to stop and reposition.',
	},
	{
		id: 'holdToMove',
		label: 'Draw, hold to move',
		hint: 'Your finger nudges the ring from anywhere on the page, and it draws straight away. Hold still for half a second to stop and reposition, and again to carry on.',
	},
	{
		id: 'holdTool',
		label: 'Move, hold the tool to use it',
		hint: 'Your finger nudges the cursor from anywhere on the page. Hold a tool in the tray with your other hand and it works at the cursor — the pencil draws, the eraser rubs out, transform selects and moves.',
	},
	{
		id: 'secondFinger',
		label: 'Move, second finger to use the tool',
		hint: 'One finger nudges the cursor. Put a second finger anywhere on the page and the tool works at the cursor for as long as you keep it there.',
	},
	{
		id: 'twoFinger',
		label: 'Two fingers, either one steers',
		hint: 'Two fingers down means the tool is working. Move either one and the cursor follows it; move both and it follows the average. Holding a tool in the tray does the same job, so one finger on the page and the other hand on the pencil works too.',
	},
	{
		id: 'steady',
		label: 'Trailing ink (steady stroke)',
		hint: 'The line follows your finger from a short distance behind it.',
	},
]

/**
 * `holdTool`, which is the one winning so far.
 *
 * The default matters more than it looks: it is what somebody arriving on the create
 * page for the first time gets, and what every measurement of "is this any good" is
 * taken against. `loupe` held it while it was the only thing that had shipped.
 */
export const DEFAULT_DRAW_MODE: DrawMode = 'holdTool'

/**
 * How far above the fingertip the mark lands in `offset`, in CSS pixels.
 *
 * Asked for as 40. Worth knowing what that is in the units the drawing thinks in:
 * a phone shows the 640-unit canvas about 343px wide, so 40px is roughly 75 units,
 * or an eighth of the width of the page.
 */
export const CURSOR_OFFSET = 40

/** How long a finger has to be still before `holdToDraw`/`holdToMove` change over. */
export const HOLD_DELAY = 500

/**
 * How far a finger may drift during that half second without restarting it.
 *
 * A finger resting on glass is never still — it rolls a pixel or two with the pulse
 * in it — so a hold measured as "no movement at all" never fires. Eight pixels is
 * comfortably more than that and comfortably less than a deliberate move.
 */
export const HOLD_SLOP = 8

/**
 * How far the ink lags the finger in `steady`, in CSS pixels.
 *
 * The ink is not interpolated towards the finger, it is *dragged* by it: the point
 * is pulled along whenever the finger gets further away than this, which is what
 * makes the trailing distance constant rather than a function of how fast you moved.
 */
export const TRAIL_DISTANCE = 32

/**
 * What counts as a tap on the canvas: a press that goes nowhere, quickly.
 *
 * Both halves are needed, and the time is the one doing the work. Safari withholds
 * movement until the finger has travelled several pixels (see `lib/zoom.ts`), so a
 * small deliberate nudge of the cursor reports *no* movement at all and is
 * indistinguishable from a tap by distance alone. It is not indistinguishable by
 * duration: aiming happens at around 9px a second, so a five-pixel nudge takes better
 * than half a second, where a tap is over in a tenth of one.
 */
export const TAP_SLOP = 8
export const TAP_TIME = 400

/**
 * Whether every tool is driven from the cursor, rather than just the two that mark.
 *
 * The three modes where a gesture is gated by something other than the ink itself —
 * a held tool button, or a second finger — and where that gate is a *button press* in
 * everything but name. A button press is what selecting, marqueeing, moving, scaling
 * and rotating are made of, so in these three the transform tool comes along for the
 * ride; in the timed modes there is no sensible way to half-press a rotation, and it
 * is left to paper.
 */
export function drivesAllTools(mode: DrawMode): boolean {
	return mode === 'holdTool' || mode === 'secondFinger' || mode === 'twoFinger'
}

/** Whether a gesture is opened and closed by fingers other than the steering one. */
export function isMultiTouchMode(mode: DrawMode): boolean {
	return mode === 'secondFinger' || mode === 'twoFinger'
}

/**
 * Whether holding a tool down in the tray sets it working at the cursor.
 *
 * `holdTool`'s whole mechanism, and `twoFinger` has it as well as its own. The two
 * answers to "how does the tool know to start" are not exclusive — a held button and a
 * second finger are both a mouse button, and which one is to hand depends on how the
 * phone is being held rather than on which is better. So in `twoFinger` either will do
 * it, and `secondFinger` is left with only its own, which is what keeps a control in
 * the comparison.
 *
 * What a press *means* is still decided in `PointerLayer.onToolPressed`, and what stops
 * the tool is whichever holder is left: see `releaseHold`.
 */
export function holdsTool(mode: DrawMode): boolean {
	return mode === 'holdTool' || mode === 'twoFinger'
}

/**
 * Whether the cursor moves by the finger's delta rather than standing under it.
 *
 * Five of the eleven. Named here rather than in `pointer.ts` because the ring is
 * drawn differently in these — it says which state the gesture is in, and it is on
 * the page whether anything is touching the glass or not — so `InkCursor` has to ask
 * the same question, and two lists of mode ids would drift.
 *
 * `steady` is not one of them: it puts the ink somewhere other than the fingertip,
 * but it still takes its lead from where the finger actually is.
 */
export function isRelativeMode(mode: DrawMode): boolean {
	return mode === 'holdToDraw' || mode === 'holdToMove' || drivesAllTools(mode)
}

/** Whether a still finger changes the gesture over. The two with a timer in them. */
export function isTimedMode(mode: DrawMode): boolean {
	return mode === 'holdToDraw' || mode === 'holdToMove'
}

/**
 * Which tool's button in the tray is being held down right now, if any.
 *
 * `holdTool`'s whole mechanism, and it is a module-level signal rather than a prop
 * because of where its two ends are: the button is in `CreateTray` and the thing
 * that acts on it is a `PointerLayer` built inside `InkCursor`, two branches of the
 * tree apart with the page between them. Threading a callback through both, for a
 * mode that is scheduled for deletion, would leave more behind it than it is worth.
 *
 * The tool's *id* rather than a boolean, because the layer is what decides what a
 * press means — whether it is picking a tool up or using one — and it cannot decide
 * that without knowing which button went down. See `PointerLayer.onToolPressed`.
 */
const pressed = new Store<{ tool: ModalToolId | null }>({ tool: null })

export function setToolPressed(tool: ModalToolId | null): void {
	pressed.set({ tool })
}

export function pressedTool(): ModalToolId | null {
	return pressed.snapshot.tool
}

export const subscribeToolPressed = pressed.subscribe

const KEY = 'tc:drawMode'

function read(): DrawMode {
	if (typeof localStorage === 'undefined') return DEFAULT_DRAW_MODE

	try {
		const stored = localStorage.getItem(KEY)
		return DRAW_MODES.some((mode) => mode.id === stored) ? (stored as DrawMode) : DEFAULT_DRAW_MODE
	} catch {
		// Private browsing on old Safari throws on read as well as write.
		return DEFAULT_DRAW_MODE
	}
}

const store = new Store<{ mode: DrawMode }>({ mode: read() })

export function setDrawMode(mode: DrawMode): void {
	store.set({ mode })

	try {
		localStorage.setItem(KEY, mode)
	} catch {
		// Not being able to remember the choice is not a reason to refuse to make it.
	}
}

/** The mode, for React. One switch and one canvas read it, so there is no selector. */
export function useDrawMode(): DrawMode {
	return useStore(store).mode
}

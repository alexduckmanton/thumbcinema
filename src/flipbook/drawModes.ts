import { Store, useStore } from '../lib/store'

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
 *    hand put in: you press and hold the pencil in the tray, and the ring marks for
 *    exactly as long as you hold it. Two hands, and nothing to wait for. This is the
 *    family Adobe Fresco's Touch Shortcut belongs to — a modifier held somewhere
 *    other than the canvas, by the hand that isn't drawing — and it is the only mode
 *    here where starting and stopping are a decision rather than an inference.
 *  - `steady` is Autodesk Sketchbook's Steady Stroke, whose documentation names
 *    finger drawing as the case it was built for: the ink is dragged along behind
 *    the finger like a brush with long bristles, which both smooths the line and
 *    leaves it somewhere you can see it.
 *  - `zoom` gives up on seeing past the finger and does what every large drawing app
 *    actually does — lets you magnify the whole page and work bigger.
 */
export type DrawMode =
	| 'loupe'
	| 'ring'
	| 'corner'
	| 'offset'
	| 'holdToDraw'
	| 'holdToMove'
	| 'holdTool'
	| 'steady'
	| 'zoom'

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
		label: 'Move, hold the tool to draw',
		hint: 'Your finger nudges the ring from anywhere on the page. Press and hold the pencil in the tray with your other hand, and it draws for as long as you hold it.',
	},
	{
		id: 'steady',
		label: 'Trailing ink (steady stroke)',
		hint: 'The line follows your finger from a short distance behind it.',
	},
	{
		id: 'zoom',
		label: 'Pinch to zoom',
		hint: 'No magnifier. Pinch the page to magnify it and draw bigger.',
	},
]

export const DEFAULT_DRAW_MODE: DrawMode = 'loupe'

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
 * Whether the cursor moves by the finger's delta rather than standing under it.
 *
 * Three of the nine. Named here rather than in `pointer.ts` because the ring is
 * drawn differently in these — it says which state the gesture is in, and it is on
 * the page whether anything is touching the glass or not — so `InkCursor` has to ask
 * the same question, and two lists of mode ids would drift.
 *
 * `steady` is not one of them: it puts the ink somewhere other than the fingertip,
 * but it still takes its lead from where the finger actually is.
 */
export function isRelativeMode(mode: DrawMode): boolean {
	return mode === 'holdToDraw' || mode === 'holdToMove' || mode === 'holdTool'
}

/** Whether a still finger changes the gesture over. The two with a timer in them. */
export function isTimedMode(mode: DrawMode): boolean {
	return mode === 'holdToDraw' || mode === 'holdToMove'
}

/**
 * Whether a marking tool's button in the tray is being held down right now.
 *
 * `holdTool`'s whole mechanism, and it is a module-level signal rather than a prop
 * because of where its two ends are: the button is in `CreateTray` and the thing
 * that acts on it is a `PointerLayer` built inside `InkCursor`, two branches of the
 * tree apart with the page between them. Threading a callback through both to carry
 * one boolean, for a mode that is scheduled for deletion, would leave more behind it
 * than it is worth.
 */
const pressed = new Store<{ tool: boolean }>({ tool: false })

export function setToolPressed(held: boolean): void {
	pressed.set({ tool: held })
}

export function isToolPressed(): boolean {
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

export function getDrawMode(): DrawMode {
	return store.snapshot.mode
}

export function setDrawMode(mode: DrawMode): void {
	store.set({ mode })
	applyZoomPolicy(mode)

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

/**
 * Whether the page may be pinched right now.
 *
 * `lib/zoom.ts` asks this before cancelling Safari's gesture events, which is the
 * only thing standing between an iPhone and page zoom — iOS has ignored
 * `user-scalable=no` since iOS 10. Everything else honours the viewport tag, which
 * is what `applyZoomPolicy` rewrites.
 */
export function zoomAllowed(): boolean {
	return store.snapshot.mode === 'zoom'
}

/**
 * The viewport tag, rewritten to match the mode.
 *
 * `index.html` ships the locked-down version, because that is right for seven modes
 * out of nine and for every other page on the site. Android and desktop honour it;
 * relaxing it is the whole of what `zoom` needs from them.
 *
 * Applied globally rather than per page, and left applied when you leave the create
 * page. Restoring it on unmount would be tidier and would also mean the gallery
 * behaved differently depending on which mode you last drew in, which is a stranger
 * thing to explain than a site you can pinch.
 */
function applyZoomPolicy(mode: DrawMode): void {
	if (typeof document === 'undefined') return

	const tag = document.querySelector('meta[name="viewport"]')
	if (!tag) return

	const base = 'width=device-width, initial-scale=1, viewport-fit=cover'
	tag.setAttribute('content', mode === 'zoom' ? base : `${base}, maximum-scale=1, user-scalable=no`)
}

// The stored mode is only honoured once the tag agrees with it: a reload in `zoom`
// would otherwise come back up unable to zoom, which reads as the setting not sticking.
applyZoomPolicy(store.snapshot.mode)

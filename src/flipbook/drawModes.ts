import { Store, useStore } from '../lib/store'

/**
 * The drawing modes, which exist to be compared against each other.
 *
 * A finger is opaque, and the thing you are aiming at on a phone is underneath the thing
 * you are aiming with. There is no settled answer to that — the survey of what other
 * drawing tools do turned up four separate families of answer and no consensus — so every
 * candidate is here behind a switch, and drawing with them side by side is how one of them
 * is chosen.
 *
 * **They are numbered rather than named, and the numbers are the point.** These differ
 * from each other by a *rule* rather than by a picture, and half of them look identical
 * until you touch the glass — so "the one where you hold the tool" and "the one with the
 * second finger" are a slow and error-prone way to say which is which. The numbers are
 * stable handles: one never changes, whatever happens to the ordering or to which one
 * wins, and a new candidate takes the next one rather than displacing anybody. Each entry keeps the name it went under while the testbed first ran, so a
 * note written then still resolves to a mode now.
 *
 * The ordering is by family rather than by history, so neighbouring numbers are related
 * and the list reads as a progression:
 *
 *  - **v1–v5 keep the finger as the pointer.** The mark is at or near the contact point,
 *    and what differs is what you are shown or how far off the fingertip the ink lands.
 *    v1 is what the tool shipped with and is the one the rest have to beat; v2 is the
 *    control, the same tool with the magnifier taken away. v3 is TouchRetouch's, and
 *    photo retouching's generally — the magnified view is pinned in a corner instead of
 *    following, so it never sits under the hand and never jumps, at the cost of having to
 *    look away from the mark. v4 is the oldest answer there is (Potter's "take-off",
 *    1988): the mark lands a fixed distance from the contact point, so the finger is
 *    never on it. v5 is Autodesk Sketchbook's Steady Stroke, whose documentation names
 *    finger drawing as the case it was built for — the ink is dragged along behind the
 *    finger like a brush with long bristles, which both smooths the line and leaves it
 *    somewhere you can see it.
 *
 *  - **v11 and v12 stand apart from both**, and are the only two that change the page
 *    rather than the gesture. The finger is still the pointer and the mark is still under
 *    the fingertip — that is v2 exactly — but the drawing is *bigger* than the fingertip,
 *    so the tip covers proportionally less of it. It is the answer photo editors and CAD
 *    tools reached for long before anybody tried a magnifier: don't move the cursor, move
 *    the canvas.
 *
 *    **v11 shows both at once.** The paper is the whole page with a rectangle on it saying
 *    which part is magnified, and a second canvas in the empty band under the tools shows
 *    the inside of that rectangle blown up and is the one you draw on. The rectangle's
 *    shape is *measured* rather than stated, because the band's is: whatever the column
 *    has left over once the strip, the paper, the page bar and the tray have taken theirs.
 *
 *    **v12 is the same window with the overview taken away.** One canvas, in the place the
 *    drawing has always been: two fingers pinch and pan it, one finger draws in it. What
 *    it gives up is the view that shows everything; what it buys is a drawing surface the
 *    full size of the paper rather than whatever was left over, which on a phone is nearly
 *    twice the height. It starts at the whole page rather than magnified — with nothing
 *    else to see the drawing in, arriving already zoomed would be arriving somewhere you
 *    didn't ask to be — so until you pinch, v12 *is* v2. See `zoomStage.ts`.
 *
 *  - **v6–v10 give up on direct manipulation altogether**, and are the answer rather
 *    than a workaround: the cursor is a thing standing on the page, a finger anywhere
 *    *nudges* it by however far the finger moved, and it never travels to the contact
 *    point. So the hand and the mark are never in the same place. What differs between
 *    the five is only how the tool is told to start working. v6 and v7 use half a second
 *    of stillness, as often as you like, so one finger that never leaves the glass can
 *    aim, draw, re-aim and draw again — and the *only* thing that separates the two is
 *    which state a gesture opens in. Nothing shipping does this on a canvas; the nearest
 *    relative is a phone keyboard's trackpad mode, which places a text cursor exactly
 *    this way. v8 takes the timer out and puts a second hand in: press and hold a tool in
 *    the tray and it works at the cursor for as long as you hold it — the family Adobe
 *    Fresco's Touch Shortcut belongs to, and the only one where starting and stopping are
 *    a decision rather than an inference. v9 and v10 move that modifier off the tray and
 *    onto the page: two fingers down means the tool is working, one means you are only
 *    aiming. They differ in who steers — v9 keeps the cursor on the first finger and
 *    treats every other one as a button, v10 lets either finger steer and averages
 *    whichever ones the browser reports as having moved. v10 also takes v8's held button,
 *    so either hand can be the one that starts the work; see `holdsTool`.
 *
 * v6 onwards are only possible because `PointerLayer` takes the touch stream away from
 * paper — paper has one drag in flight and reads `targetTouches[0]`, so a second finger
 * is invisible to it.
 */
export type DrawMode =
	| 'v1'
	| 'v2'
	| 'v3'
	| 'v4'
	| 'v5'
	| 'v6'
	| 'v7'
	| 'v8'
	| 'v9'
	| 'v10'
	| 'v11'
	| 'v12'

export interface DrawModeInfo {
	id: DrawMode
	/** What this mode is, in three or four words. */
	name: string
	/** What it was called while the testbed first ran, so old notes still resolve. */
	was: string
	/** What to expect, for the moment a mode is picked and its rules aren't obvious. */
	hint: string
}

export const DRAW_MODES: readonly DrawModeInfo[] = [
	{
		id: 'v1',
		name: 'Loupe',
		was: 'loupe',
		hint: 'A magnifier floats above your finger while you draw.',
	},
	{
		id: 'v2',
		name: 'Ring only',
		was: 'ring',
		hint: 'No magnifier. The ring, and nothing else.',
	},
	{
		id: 'v3',
		name: 'Corner magnifier',
		was: 'corner',
		hint: 'The magnifier is pinned in a corner instead of following your finger.',
	},
	{
		id: 'v4',
		name: 'Offset cursor',
		was: 'offset',
		hint: 'The line lands 40px above your fingertip.',
	},
	{
		id: 'v5',
		name: 'Trailing ink',
		was: 'steady',
		hint: 'The line follows your finger from a short distance behind it.',
	},
	{
		id: 'v6',
		name: 'Move, hold to draw',
		was: 'holdToDraw',
		hint: 'The cursor stays put and your finger nudges it, from anywhere on the page. Hold still for half a second to start drawing, and again to stop and reposition.',
	},
	{
		id: 'v7',
		name: 'Draw, hold to move',
		was: 'holdToMove',
		hint: 'Your finger nudges the cursor from anywhere on the page, and it draws straight away. Hold still for half a second to stop and reposition, and again to carry on.',
	},
	{
		id: 'v8',
		name: 'Hold the tool to use it',
		was: 'holdTool',
		hint: 'Your finger nudges the cursor from anywhere on the page. Hold a tool in the tray with your other hand and it works at the cursor — the pencil draws, the eraser rubs out, transform selects and moves.',
	},
	{
		id: 'v9',
		name: 'Second finger to use it',
		was: 'secondFinger',
		hint: 'One finger nudges the cursor. Put a second finger anywhere on the page and the tool works at the cursor for as long as you keep it there.',
	},
	{
		id: 'v10',
		name: 'Two fingers, either steers',
		was: 'twoFinger',
		hint: 'Two fingers down means the tool is working. Move either one and the cursor follows it; move both and it follows the average. Holding a tool in the tray does the same job, so one finger on the page and the other hand on the pencil works too.',
	},
	{
		id: 'v11',
		name: 'Zoom stage',
		was: 'zoomStage',
		hint: 'You draw in the second canvas under the tools, magnified. The rectangle on the paper says which part of it that is: drag it to move, or pinch either canvas to zoom.',
	},
	{
		id: 'v12',
		name: 'Pinch the page itself',
		was: 'zoomPage',
		hint: 'One finger draws. Two fingers pinch to zoom into the page and drag to pan around it. No second canvas — the drawing you are looking at is the one you are working in.',
	},
]

/**
 * v10, which is the one the tool ships with.
 *
 * The default matters more than it looks: it is what somebody arriving on the create page
 * for the first time gets, and what every measurement of "is this any good" is taken
 * against. It is stated here rather than being "whichever is last in the list", so
 * reordering the list can't quietly change what the site does.
 */
export const DEFAULT_DRAW_MODE: DrawMode = 'v10'

/** What the switch and the caption call a mode: `v4 — Offset cursor`, and `(current)`. */
export function label(info: DrawModeInfo): string {
	return `${info.id} — ${info.name}${info.id === DEFAULT_DRAW_MODE ? ' (current)' : ''}`
}

/**
 * How far above the fingertip the mark lands in v4, in CSS pixels.
 *
 * Asked for as 40. Worth knowing what that is in the units the drawing thinks in: a phone
 * shows the 640-unit canvas about 343px wide, so 40px is roughly 75 units, or an eighth
 * of the width of the page.
 */
export const CURSOR_OFFSET = 40

/** How long a finger has to be still before v6/v7 change over. */
export const HOLD_DELAY = 500

/**
 * How far a finger may drift during that half second without restarting it.
 *
 * A finger resting on glass is never still — it rolls a pixel or two with the pulse in it
 * — so a hold measured as "no movement at all" never fires. Eight pixels is comfortably
 * more than that and comfortably less than a deliberate move.
 */
export const HOLD_SLOP = 8

/**
 * How far the ink lags the finger in v5, in CSS pixels.
 *
 * The ink is not interpolated towards the finger, it is *dragged* by it: the point is
 * pulled along whenever the finger gets further away than this, which is what makes the
 * trailing distance constant rather than a function of how fast you moved.
 */
export const TRAIL_DISTANCE = 32

/**
 * Whether every tool is driven from the cursor, rather than just the two that mark.
 *
 * The three modes where a gesture is gated by something other than the ink itself — a
 * held tool button, or a second finger — and where that gate is a *button press* in
 * everything but name. A button press is what selecting, marqueeing, moving, scaling and
 * rotating are made of, so in these three the transform tool comes along for the ride; in
 * the timed modes there is no sensible way to half-press a rotation, and it is left to
 * paper.
 */
export function drivesAllTools(mode: DrawMode): boolean {
	return mode === 'v8' || mode === 'v9' || mode === 'v10'
}

/** Whether a gesture is opened and closed by fingers other than the steering one. */
export function isMultiTouchMode(mode: DrawMode): boolean {
	return mode === 'v9' || mode === 'v10'
}

/**
 * Whether the page carries a second, magnified canvas to draw in.
 *
 * v11 alone, and it is the one mode whose answer is a *layout* rather than a gesture —
 * so it is also the one that can find itself without the room to be what it says it is.
 * Where the band under the tools is too short, or the layout hides it outright (which is
 * every window above the breakpoint: a mouse has a precise pointer and no occlusion
 * problem, so the whole mode is answering a question it hasn't got), there is no stage
 * and v11 falls back to v2. `stageView()` returning null is that condition, and it is
 * asked of the stage rather than of the mode — one question, one answer, and nothing
 * here has to know what the media query says.
 */
export function isZoomStageMode(mode: DrawMode): boolean {
	return mode === 'v11' || mode === 'v12'
}

/**
 * Whether the zoomed view *is* the paper, rather than a second canvas below it.
 *
 * v12, which is v11 with the overview taken away: the same window on the same page and
 * the same gestures on it, drawn in the place the drawing has always been. What that
 * costs is the view that shows everything — there is no second canvas saying where you
 * are — and what it buys is that the surface you draw on is the full size of the paper
 * rather than whatever the column had left, which on a phone is nearly twice the height.
 *
 * It also starts where every other mode does, at the whole page: with nothing else to
 * see the drawing in, arriving already magnified would be arriving somewhere you didn't
 * ask to be. Until you pinch, v12 *is* v2. See `DEFAULT_ZOOM` and `startingZoom`.
 */
export function stageOnPaper(mode: DrawMode): boolean {
	return mode === 'v12'
}

/** How far in a mode's stage starts. v11 has the paper above it; v12 has nothing else. */
export function startingZoom(mode: DrawMode): number {
	return stageOnPaper(mode) ? 1 : 2
}

/**
 * Whether holding a tool down in the tray sets it working at the cursor.
 *
 * v8's whole mechanism, and v10 has it as well as its own. The two answers to "how does
 * the tool know to start" are not exclusive — a held button and a second finger are both
 * a mouse button, and which one is to hand depends on how the phone is being held rather
 * than on which is better. So in v10 either will do it, and v9 is left with only its own,
 * which is what keeps a control in the comparison.
 *
 * What a press *means* is still decided in `PointerLayer.onToolPressed`, and what stops
 * the tool is whichever holder is left: see `releaseHold`.
 */
export function holdsTool(mode: DrawMode): boolean {
	return mode === 'v8' || mode === 'v10'
}

/**
 * Whether the cursor moves by the finger's delta rather than standing under it.
 *
 * Five of them. Named here rather than in `pointer.ts` because the cursor is drawn
 * differently in these — it says which state the gesture is in, and it is on the page
 * whether anything is touching the glass or not — so `InkCursor` has to ask the same
 * question, and two lists of mode ids would drift.
 *
 * v5 is not one of them: it puts the ink somewhere other than the fingertip, but it still
 * takes its lead from where the finger actually is.
 */
export function isRelativeMode(mode: DrawMode): boolean {
	return mode === 'v6' || mode === 'v7' || drivesAllTools(mode)
}

/** Whether a still finger changes the gesture over. The two with a timer in them. */
export function isTimedMode(mode: DrawMode): boolean {
	return mode === 'v6' || mode === 'v7'
}

/**
 * Whether the whole page is somewhere to aim from, or only the drawing.
 *
 * A cursor that is nudged rather than placed doesn't care where the nudge comes from, and
 * a phone's create page is a column of drawing with a band of empty white under it —
 * which is where a thumb already is. But a mode that puts the mark *at* the fingertip has
 * nothing to say about a finger that isn't on the paper, so those keep the drawing as
 * their field and leave the rest of the page alone.
 */
export function aimsFromWholePage(mode: DrawMode): boolean {
	return isRelativeMode(mode)
}

/**
 * Where the choice is remembered, which is per browser and not per flipbook.
 *
 * The same key the first testbed used. Its values were names rather than numbers, so a
 * `localStorage` left over from then reads as unrecognised and falls back to the default
 * — which is the same thing that happens to a mode that has since been deleted, and is
 * why `read` validates against the list rather than casting.
 */
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

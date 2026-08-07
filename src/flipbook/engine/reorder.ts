/**
 * Dragging a page to a different place in the flipbook, as arithmetic.
 *
 * Five pure functions, and between them they are the whole of what the reorder gesture
 * knows: how far the page is allowed to travel, which slot it would land in if it were
 * let go now, where every *other* page has to stand to leave room for it, whether the
 * flipbook can keep running underneath it, and how fast.
 *
 * Separate from the component that calls them for the reason `pages.ts` is separate
 * from the engine — this is where being wrong by one page would look like a subtle
 * animation bug rather than an error, so it is tested on its own. Nothing here knows
 * about the DOM, and every distance is in the same units: pixels, at the pitch the
 * strip is currently laid out at. See `PageStrip`, which measures it.
 */

/**
 * Where the page is being carried, while it is being carried.
 *
 * Three indices into the flipbook, not pixels — the pixels are written straight onto
 * the DOM and never come back through React. See `usePageReorder`.
 *
 *  - `from` is the slot it was picked up from, and does not change.
 *  - `anchor` is the slot the strip's row is lined up on: where the *flipbook* is
 *    standing, which is not the same thing as where the page is. It starts at `from` and
 *    advances a page at a time while the page is held out to one side — that is the
 *    whole of the hold-to-slide, and it is why the row and the page can be measured
 *    against each other at all.
 *  - `to` is the slot the page would land in if it were let go now, and is where the
 *    strip opens a gap. Always `anchor` plus however many slots the page is held out by.
 */
export interface Reorder {
	from: number
	anchor: number
	to: number
	/** True once the pointer has gone and the flipbook is closing up round the page. */
	settling: boolean
	/**
	 * How long the flipbook is currently taking to move one page under the held page, or
	 * null if it has never started. Handed to the stylesheet as `--slide`; see `.sliding`.
	 */
	slide: number | null
}

/**
 * How long the flipbook takes to close up round a page that has been dropped.
 *
 * Stated once, here, and handed to the stylesheets as `--settle`: the settle is three
 * transitions on three different elements — the strip's `left`, each thumbnail's
 * `transform` and the drawing's own — and they compose into one movement only for
 * exactly as long as they agree about the duration. A number in a stylesheet and a
 * `setTimeout` next to it is the classic way for that to stop being true.
 */
export const SETTLE_MS = 300

/**
 * How long the page has to be held out to one side before the flipbook starts running
 * underneath it.
 *
 * The whole point of the dwell. Holding the page one slot over is *also* how you move it
 * exactly one place, and that is by far the commoner thing to want — so a gesture that
 * crosses the halfway line and is released promptly must never turn into a run through
 * the flipbook. Long enough to be a decision, short enough that "hold it over there" is
 * answered while you are still expecting it to be.
 */
export const SLIDE_DWELL_MS = 400

/**
 * How long one page takes to pass under the held page: about one a second where the run
 * starts, and five times that held out at the edge of the window.
 *
 * A rate rather than a speed, and that is the point of it. The two things this is asked
 * for are very different sizes — nudging a frame two or three places, and taking a page
 * from the end of a forty-page flipbook to the front — and one rate is either too fast to
 * stop on the page you wanted or too slow to be worth holding. So the *distance* the page
 * is held out is the throttle: barely past the point where the run starts is a page at a
 * time you can count, and out at the edge is as fast as the flipbook is worth watching.
 *
 * Distance rather than how long it has been running, which is what this was first. A ramp
 * on time is a control you can only push: it winds up whether you meant it to or not, and
 * the only way to slow it down is to let go and start again. On distance it goes both
 * ways — pull the page back towards the middle of the column and the flipbook eases off
 * under it — which is what makes stopping on the page you wanted a thing you can aim at
 * rather than a thing you have to catch.
 *
 * The top speed is a readability floor rather than a performance one, and it is the
 * number to change if this ever feels wrong. Six pages a second is quick, but each one is
 * on screen long enough to be recognised — which is the whole point of running the
 * flipbook past you rather than jumping to an index. A page every two frames, which is
 * where an unbounded ramp ends up, is a blur you have to stop and read afterwards.
 *
 * **The curve is squared, and that is what makes the throttle legible.** Straight-line
 * was the first version and it was almost impossible to tell from no throttle at all,
 * for a reason that is obvious once measured: half a page out is where a hand naturally
 * rests when it has just moved the page one slot, and on a straight line from the gate to
 * the window edge that is already a third of the way open. So the rate you actually
 * *held* was never the slow one. Squared keeps the whole middle of the travel at very
 * nearly the slow rate and spends the difference in the last quarter, next to the edge —
 * which is both what "hold it closer to the edge" describes and where there is a hard
 * stop to aim at.
 */
export const SLIDE_SLOW_MS = 850
export const SLIDE_FAST_MS = 170

/** The interval for the next page, `reach` being 0 at the gate and 1 at full tilt. */
export function slideInterval(reach: number): number {
	const open = Math.min(1, Math.max(0, reach)) ** 2
	return SLIDE_SLOW_MS + (SLIDE_FAST_MS - SLIDE_SLOW_MS) * open
}

/**
 * How far out the page has to be held for the flipbook to start running underneath it.
 *
 * A third of a page, which is deliberately *less* than the half it takes to claim the
 * next slot outright — so "held over there" starts before "swapped with the next one"
 * finishes, and a hold can begin from a drag that hasn't moved anything yet.
 *
 * That gap is a phone measurement rather than a matter of taste. The pitch there is
 * nearly the width of the window and the handle starts in the middle of it, so a finger
 * has about half a page of travel before it runs out of screen: at a half-page gate the
 * run could only be started by a swipe that ended on the very edge of the glass, which
 * is the one gesture a phone is worst at. A third of a page is a comfortable swipe on
 * both layouts, and the run walks the page a slot at a time from there — so every slot
 * in the flipbook, the first one included, is reachable without ever asking for a swipe
 * wider than the screen.
 */
const SLIDE_REACH = 1 / 3

/**
 * Where full speed is, if the window is wide enough to reach it: a page and a half out
 * from where the page was picked up.
 *
 * The throttle runs from the gate to the edge of the window, because "held out at the
 * edge" is a statement about the screen rather than about the flipbook — it is the same
 * gesture on a phone, where the edge is 190px from the handle, and on a laptop, where it
 * is 600. What this cap is for is the window that is wider than the gesture: on an
 * ultrawide the edge is nearly two thousand pixels away, and a throttle you have to drag
 * a metre of desk to open is one nobody ever finds the top of. A page and a half is past
 * the window edge on every ordinary one, so on those this does nothing at all.
 */
const SLIDE_FULL = 1.5

/**
 * How far open the throttle is: 0 where the run starts, 1 held out at the edge.
 *
 * `room` is how much screen there was between the press and the edge it is being dragged
 * towards, measured once, at the press — so the answer is "how far through the travel
 * you actually had", which is the same question on both layouts and needs no breakpoint
 * to ask it.
 */
export function slideReach(drag: number, room: number, step: number): number {
	const gate = step * SLIDE_REACH
	const full = Math.min(room, step * SLIDE_FULL)
	if (full <= gate) return 0

	return Math.min(1, Math.max(0, (Math.abs(drag) - gate) / (full - gate)))
}

/**
 * How far the page can be dragged, which is as far as there is flipbook to drag it
 * through, and half a page past either end.
 *
 * Measured from the *anchor* rather than from where the page was picked up, so that it
 * moves with the flipbook: once the book has run three pages under the page, three more
 * pages' worth of travel has opened up behind it and three has closed up ahead.
 *
 * The half page past the ends is not decoration, and half is exactly the right amount.
 * A run ends with the anchor as far along as it can go while the page it is carrying is
 * still over a slot — and `Math.round` puts that at up to half a step out. Without the
 * slack the clamp would tighten under a finger that hasn't moved and snatch the drawing
 * sideways at the very end of a run, which is the one snap this whole mechanism is
 * built to avoid. What it costs is that a page can be dragged half a page past the front
 * or the back of the flipbook, where it hangs over nothing and slides home on release —
 * which is a fair picture of there being nothing out there.
 */
const OVERHANG = 0.5

export function clampDrag(drag: number, anchor: number, pages: number, step: number): number {
	const back = (anchor + OVERHANG) * step
	const forward = (pages - 1 - anchor + OVERHANG) * step
	return Math.max(-back, Math.min(drag, forward))
}

/**
 * Which slot the page would take if it were let go now: the nearest one, so the swap
 * happens as the page passes the halfway line rather than when it fully clears its
 * neighbour.
 *
 * Guarded on `step`, which is measured off a laid-out strip and is zero for the frame
 * before there is one — a division by it would hand `NaN` to the scene.
 */
export function targetIndex(drag: number, anchor: number, pages: number, step: number): number {
	if (step <= 0 || pages < 2) return anchor

	const slot = anchor + Math.round(drag / step)
	return Math.max(0, Math.min(slot, pages - 1))
}

/**
 * Whether the flipbook can move one more page under the page being held, and which way.
 *
 * Two questions in one number. The page is being held to one side at all if it is
 * `SLIDE_REACH` of a page out — and it stays that way as the row advances, because the
 * offset is measured against the anchor and the run moves them both, which is what lets
 * a hold go on being a hold. And there is somewhere to run *to* only while the
 * destination still has a slot in front of it, so the run ends with the page over the
 * first or last slot rather than past it.
 */
export function slideDirection(drag: number, to: number, pages: number, step: number): -1 | 0 | 1 {
	if (step <= 0 || Math.abs(drag) < step * SLIDE_REACH) return 0

	const direction = drag < 0 ? -1 : 1
	const next = to + direction
	return next >= 0 && next <= pages - 1 ? direction : 0
}

/**
 * Where page `index` has to stand while the page from slot `from` is being carried to
 * slot `to`: one step aside if the carried page has to pass through it, and nowhere at
 * all otherwise.
 *
 * Only ever one step, whatever the distance dragged — a page three slots along is
 * displaced by exactly one, because the two pages either side of it are moving too and
 * what they are all doing is closing up a gap and opening another one.
 *
 * The carried page gets an answer as well, and it is the whole of the way. Nothing can
 * see it — the live canvas is standing in front of the page being dragged, and the
 * canvas is what actually follows the pointer — but it has to be *left* in the slot it
 * is being dropped into, or handing the flipbook back to the strip at the end of the
 * gesture would move it.
 */
export function pageShift(index: number, from: number, to: number, step: number): number {
	if (index === from) return (to - from) * step
	if (index > from && index <= to) return -step
	if (index >= to && index < from) return step
	return 0
}

import { PENCIL_COLOR } from './constants'
import type { Scene } from './scene'

/**
 * Undo and redo.
 *
 * 2013 had one step of it, and the port kept that: a snapshot taken on mouse-down by
 * whichever tool was about to change something, spent by the next ⌘Z, and swapped
 * rather than replaced so that undo was its own redo. This is the same idea with a
 * stack under it, and three things that weren't true before.
 *
 * **A step is a whole gesture, recorded by the engine rather than by the tools.**
 * Every edit on this canvas begins with a pointer going down on it and ends with the
 * pointer coming up, so that is where the before and after are taken — which is why
 * the transform tool, which never took a snapshot at all and whose moves were
 * therefore permanent, is undoable now without a line in it changing. Selecting is
 * not: see `capture`.
 *
 * **A step can span pages.** There is one stack for the flipbook, not one per page,
 * so undo has to be able to say which page it belongs to and take you there. Steps
 * are keyed by page *id* rather than index, because inserting a page renumbers every
 * index after it and a history that holds indices starts pointing at the wrong pages
 * the moment you use it.
 *
 * **A page is a state, not a diff.** Each op holds one page's ink as JSON, and
 * applying it swaps that string with what is on the page — so the op that was the
 * undo becomes the redo, exactly as the one-step version did. Deltas would be smaller
 * and would have to be right about every operation the four tools perform; a string
 * that is simply the page cannot be subtly wrong.
 */

/** One page's ink, as `Layer#exportJSON` writes it. */
type Ink = string

export type Op =
	/** The page's contents changed: a stroke, an erase, a transform, a deletion. */
	| { kind: 'content'; pageId: number; ink: Ink }
	/**
	 * A page joined or left the flipbook. `added` describes the *forward* direction,
	 * so undo reverses it and redo replays it; `index` is where the page sat, and
	 * `ink` is what was on it.
	 *
	 * Indices are safe here where they aren't in a `content` op, because the stack is
	 * spent last-in-first-out: by the time a step is applied, the flipbook is in
	 * exactly the shape it was in when the step was recorded.
	 */
	| { kind: 'page'; added: boolean; pageId: number; index: number; ink: Ink }
	/**
	 * A page changed places. `from` and `to` describe the *forward* direction, so undo
	 * runs them the other way round.
	 *
	 * The only op that carries no ink, because reordering is the one page operation that
	 * doesn't touch what is drawn on anything: the layers are the same layers in a
	 * different order, and a state to restore would be fifty copies of a drawing nobody
	 * changed. Indices are safe for the reason the op above gives.
	 */
	| { kind: 'move'; pageId: number; from: number; to: number }

/**
 * One press of undo.
 *
 * Usually one op. Deleting the only page in a flipbook is two — the page leaves and a
 * blank one takes its place — and they have to travel together or the first undo
 * leaves a flipbook with no pages in it at all.
 *
 * `forward` and `back` are the page to be standing on afterwards, one for each
 * direction, and they differ more often than not: undoing a blank page puts you back
 * on the page you asked for it from, and redoing it puts you on the blank one.
 * They're page ids, so a step that names a page it has just taken away simply doesn't
 * find it — which is the signal to stand in the slot the page left.
 */
export interface Step {
	ops: Op[]
	forward: number
	back: number
}

/**
 * How many steps are kept.
 *
 * Well past the ten to twenty that is any use, and short of the point where the cost
 * of holding them is worth thinking about: a step is one page's ink, and a page big
 * enough to matter here is already near the ~2.5 MB the save is capped at. `BUDGET`
 * is the real limit and this is the one that is easy to reason about.
 */
export const MAX_STEPS = 50

/**
 * How much ink the history will hold, in characters of JSON, before it starts
 * dropping the oldest steps.
 *
 * Roughly 12 MB of string — a few times the largest flipbook the server will accept,
 * and small next to the ~900 KB *per page* the strip's thumbnails already cost. What
 * it protects against is fifty steps on a page dense enough that fifty copies of it
 * are worth noticing.
 */
export const BUDGET = 12_000_000

export class History {
	private readonly scene: Scene

	private readonly undoStack: Step[] = []
	private readonly redoStack: Step[] = []

	/** The page as it stood when the current gesture started. See `begin`. */
	private pending: { pageId: number; ink: Ink } | null = null

	private listener: (() => void) | null = null

	constructor(scene: Scene) {
		this.scene = scene
	}

	/** The engine subscribes, so `canUndo` and `canRedo` can reach a toolbar. */
	onChange(listener: () => void): void {
		this.listener = listener
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0
	}

	// --- recording -----------------------------------------------------------

	/**
	 * Takes the page as it stands, in case the gesture about to start changes it.
	 *
	 * Nothing is pushed here. A press that turns out to have drawn nothing — a tap
	 * with the pencil, a click on empty canvas with the transform tool, an eraser that
	 * caught no line — must not cost a step, or undo spends several presses doing
	 * nothing visible before it reaches the thing you wanted back.
	 */
	begin(pageIndex: number, pageId: number): void {
		this.pending = { pageId, ink: this.capture(pageIndex) }
	}

	/**
	 * Ends the gesture, and records it if it changed anything.
	 *
	 * The comparison is the whole reason `capture` normalises what it writes: a press
	 * that only selected a stroke moves it from the page's layer into the selection
	 * layer without altering a single point of it, and the two have to come out as the
	 * same string or every click on a drawing is a step in the history.
	 */
	commit(pageIndex: number): boolean {
		const started = this.pending
		this.pending = null
		if (!started) return false

		if (this.capture(pageIndex) === started.ink) return false

		this.push({
			ops: [{ kind: 'content', pageId: started.pageId, ink: started.ink }],
			forward: started.pageId,
			back: started.pageId,
		})
		return true
	}

	/** Drops a gesture without recording it — the page went away underneath it. */
	abandon(): void {
		this.pending = null
	}

	/** Records a step assembled by the caller: the page actions, which aren't gestures. */
	record(step: Step): void {
		this.push(step)
	}

	/** One page's ink, for a caller building a `page` op. */
	inkOf(pageIndex: number): Ink {
		return this.capture(pageIndex)
	}

	private push(step: Step): void {
		this.undoStack.push(step)
		// Anything undone is unreachable the moment something new is done, which is
		// what every undo stack does and what stops the two histories disagreeing.
		this.redoStack.length = 0
		this.trim()
		this.listener?.()
	}

	/**
	 * Drops the oldest steps until the history is within both limits.
	 *
	 * Both, rather than whichever is hit first, because they are guarding different
	 * things: the count is what makes undo predictable, and the budget is what stops a
	 * page with a lot on it being held fifty times over.
	 */
	private trim(): void {
		while (this.undoStack.length > MAX_STEPS) this.undoStack.shift()

		let held = this.weigh()
		while (held > BUDGET && this.undoStack.length > 1) {
			const dropped = this.undoStack.shift()
			held -= weighStep(dropped)
		}
	}

	private weigh(): number {
		let total = 0
		for (const step of this.undoStack) total += weighStep(step)
		for (const step of this.redoStack) total += weighStep(step)
		return total
	}

	// --- spending ------------------------------------------------------------

	/**
	 * Hands back the step to apply, already moved to the other stack.
	 *
	 * The caller applies it and hands back what the flipbook looked like *before* it
	 * did, by mutating the ops in place — a `content` op's ink is swapped for the ink
	 * it replaced, so the step on the redo stack undoes the undo. It is the one-step
	 * version's swap, kept, because a stack of states that each describe the other
	 * direction is a stack that can't drift.
	 */
	takeUndo(): Step | null {
		const step = this.undoStack.pop()
		if (!step) return null

		this.redoStack.push(step)
		this.listener?.()
		return step
	}

	takeRedo(): Step | null {
		const step = this.redoStack.pop()
		if (!step) return null

		this.undoStack.push(step)
		this.listener?.()
		return step
	}

	clear(): void {
		this.undoStack.length = 0
		this.redoStack.length = 0
		this.pending = null
		this.listener?.()
	}

	// --- the page, as a string -----------------------------------------------

	/**
	 * One page's ink: everything drawn on it, whether or not it happens to be selected.
	 *
	 * Selected strokes are not flagged, they are physically moved into the selection
	 * layer (see `Selection`), so a page's contents are spread across two layers
	 * whenever anything is picked up. Both are read, and the result is normalised hard:
	 * ordered by paper's own item ids, painted the ink colour, and set back to full
	 * opacity. That is what makes selecting invisible to the history — the same
	 * drawing, selected or not, comes out as the same string — and it is also what
	 * makes restoring a step deselect: what goes back on the page is a drawing, with
	 * nothing held.
	 *
	 * Ids rather than z-order because selecting appends to a different layer and would
	 * otherwise reorder the page. Every stroke here is the same opaque black line, so
	 * ordering them by age instead of by stacking is a difference nothing can see.
	 */
	private capture(pageIndex: number): Ink {
		const page = this.scene.pageLayer(pageIndex)
		const held = this.scene.selectionLayer.children

		const items = [...page.children, ...held].sort((a, b) => a.id - b.id)

		// Written through the scene's staging layer rather than exported item by item:
		// one string is one comparison, and it is a `Layer` that reads it back. Emptied
		// on the way in as well as out — anything left here would be saved with the
		// flipbook, since `exportSVG` writes every layer in the project.
		const staging = this.scene.stagingLayer
		staging.removeChildren()

		for (const item of items) {
			const copy = item.clone({ insert: false })

			/*
			 * The three things that say where a stroke has *been* rather than what it is.
			 *
			 * Colour and opacity are the selection's doing — a picked-up stroke is
			 * repainted blue and the page behind it faded to a fifth — and both have to
			 * come back to the ink the drawing is made of, because what a step restores
			 * is a drawing rather than a drawing with something held in it.
			 *
			 * The name is subtler and it is what made this necessary. paper keeps names
			 * unique within a parent, so every time a stroke moves between the page and
			 * the selection layer it comes back as "4_5 1", then "4_5 1 1", then
			 * "4_5 1 1 1". Serialised, that made *clicking on a drawing* look like an
			 * edit: same points, same style, different string. Nothing reads a stroke's
			 * name — the pencil writes it and `exportSVG` turns it into an id — so the
			 * history simply doesn't hold one.
			 */
			copy.name = ''
			copy.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
			copy.opacity = 1

			staging.addChild(copy)
		}

		const ink = staging.exportJSON()
		staging.removeChildren()

		return ink
	}

	/**
	 * Puts `ink` on page `pageIndex` and hands back what was there.
	 *
	 * Returning the old state rather than taking a second call is what lets a step be
	 * its own inverse: the caller writes it straight back into the op it came from.
	 */
	swap(pageIndex: number, ink: Ink): Ink {
		const previous = this.capture(pageIndex)
		this.write(pageIndex, ink)
		return previous
	}

	/**
	 * Replaces a page's contents outright. Used by `swap` and by restoring a page.
	 *
	 * Read into the staging layer and then moved across, and it has to be *that* layer
	 * it is named at. `Project#importJSON` looks like the call to make and is a trap:
	 * it imports into the active layer if that layer happens to be empty, and otherwise
	 * makes a new one — so the obvious version, which cleared the page and then asked
	 * the project to import, handed paper an empty active layer, got the page itself
	 * back, and removed it. A flipbook one page shorter, and the exception that
	 * followed came from somewhere else entirely.
	 *
	 * `Item#importJSON` has no such heuristic: it deserialises into the item it is
	 * called on, whatever state that item is in.
	 */
	write(pageIndex: number, ink: Ink): void {
		const staging = this.scene.stagingLayer

		// Before the page is cleared, not after: if the string were somehow unreadable,
		// a throw here should cost the step rather than the drawing.
		staging.removeChildren()
		staging.importJSON(ink)

		const layer = this.scene.pageLayer(pageIndex)
		layer.removeChildren()
		for (const child of [...staging.children]) layer.addChild(child)

		staging.removeChildren()
	}
}

function weighStep(step: Step | undefined): number {
	if (!step) return 0

	let total = 0
	// A move carries no ink — see `Op`. It is the one step the budget can ignore.
	for (const op of step.ops) if (op.kind !== 'move') total += op.ink.length
	return total
}

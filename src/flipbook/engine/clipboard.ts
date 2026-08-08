import { CANVAS_HEIGHT, CANVAS_WIDTH, PENCIL_COLOR } from './constants'
import type { Scene } from './scene'

/**
 * Copy and paste.
 *
 * What it holds is a set of strokes, detached from the project — clones taken at the
 * moment Copy was pressed, so editing or deleting the original afterwards doesn't
 * change what is on the clipboard, and neither does turning the page. Paste hands back
 * fresh clones of those, so pasting the same thing five times gives five drawings
 * rather than five references to one.
 *
 * Held as paper items rather than as JSON, which is what the history does: the history
 * needs one comparable string per page and pays a serialise for it, and this needs
 * neither. A clone is what a paste is going to have to make anyway.
 *
 * There is no cut, and no system clipboard. Cut is delete-then-copy and the Delete key
 * already exists; the system clipboard would mean asking for permission, handling a
 * paste of somebody's holiday photo, and a second artwork format to read — for a
 * feature whose whole job is moving a stroke from one frame of your own flipbook to
 * the next.
 */

/**
 * How far from the middle of the frame a pasted drawing lands, on each axis.
 *
 * Pasting into the exact middle every time is what makes a paste invisible: press it
 * twice and the second copy lands squarely on the first, and what you see is one
 * drawing and a flipbook that has quietly gained a second. Every paste is therefore
 * thrown a little way off centre, and each one differently — the offset is what says
 * something arrived.
 *
 * `MIN` is why it is a *ring* rather than a square around the middle: an offset drawn
 * uniformly from ±10 is sometimes half a pixel, which is the case this exists to avoid.
 * So the distance is drawn from the outer half of the range and the sign separately,
 * and a paste is never exactly centred and never exactly on top of the last one.
 */
export const PASTE_JITTER = 10
export const PASTE_JITTER_MIN = 4

/** Where the middle of a pasted drawing goes: the middle of the frame, thrown off it. */
export function pasteCentre(random: () => number = Math.random): { x: number; y: number } {
	return {
		x: CANVAS_WIDTH / 2 + jitter(random),
		y: CANVAS_HEIGHT / 2 + jitter(random),
	}
}

function jitter(random: () => number): number {
	const distance = PASTE_JITTER_MIN + random() * (PASTE_JITTER - PASTE_JITTER_MIN)
	return random() < 0.5 ? -distance : distance
}

export class Clipboard {
	private readonly scene: Scene

	/** Detached, and never handed out — `take` clones them again. */
	private items: paper.Item[] = []

	constructor(scene: Scene) {
		this.scene = scene
	}

	get isEmpty(): boolean {
		return this.items.length === 0
	}

	/**
	 * Takes a copy of what is currently held.
	 *
	 * Normalised on the way in, the same three fields `History.capture` normalises and
	 * for the same reason: what is copied is a *drawing*, and the blue, the fade and the
	 * uniquified name are the selection's dressing rather than anything about the
	 * strokes. Without it a stroke would arrive back on the page still wearing the
	 * highlight it happened to be copied in.
	 */
	hold(items: readonly paper.Item[]): void {
		this.items = items.map((item) => {
			const copy = item.clone({ insert: false })
			copy.name = ''
			copy.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
			copy.opacity = 1
			return copy
		})
	}

	/**
	 * Fresh copies, standing in the middle of the frame.
	 *
	 * They keep their positions relative to each other — several strokes copied together
	 * are one drawing, and the box that lands is that drawing's box — so the whole set is
	 * moved by one delta rather than each stroke being centred on its own.
	 *
	 * Detached: the caller decides where they go, which is the selection layer.
	 */
	take(random: () => number = Math.random): paper.Item[] {
		const copies = this.items.map((item) => item.clone({ insert: false }))
		if (copies.length === 0) return copies

		let box: paper.Rectangle | null = null
		for (const copy of copies) box = box ? box.unite(copy.bounds) : copy.bounds
		if (!box) return copies

		const target = pasteCentre(random)
		const delta = new this.scene.scope.Point(target.x - box.center.x, target.y - box.center.y)
		for (const copy of copies) copy.translate(delta)

		return copies
	}
}

import type { Scene } from '../scene'
import type { Selection } from '../selection'
import type { ModalTool } from './types'

/**
 * Grabs the nearest *point* on a stroke, not the stroke itself. That's why the
 * eraser feels like rubbing rather than deleting: it takes a bite out of a line
 * where you touched it, and leaves the rest.
 */
const HIT_ERASE: Parameters<paper.Item['hitTest']>[1] = {
	segments: true,
	fill: false,
	stroke: false,
	tolerance: 10,
}

/** A safety net on the recursive erase below, not a design limit. */
const MAX_ERASURES_PER_EVENT = 200

export class EraserTool implements ModalTool {
	readonly tool: paper.Tool

	private readonly scene: Scene
	private readonly selection: Selection

	constructor(scene: Scene, selection: Selection) {
		this.scene = scene
		this.selection = selection

		this.tool = new scene.scope.Tool()
		this.tool.onMouseDown = (event: paper.ToolEvent) => {
			this.scene.snapshot(this.scene.activeLayer)
			this.eraseAt(event.point)
		}
		this.tool.onMouseDrag = (event: paper.ToolEvent) => this.eraseAt(event.point)
	}

	init(): boolean {
		this.selection.clear()
		this.scene.activeLayer.activate()
		return true
	}

	activate(): void {
		this.tool.activate()
	}

	deactivate(): void {
		// Nothing to tear down.
	}

	/**
	 * Erases everything within tolerance of `point`, one hit at a time.
	 *
	 * Re-tests after each removal because splitting a line creates two new paths,
	 * either of which may still be under the cursor. The original did this with
	 * unbounded recursion; the loop is the same thing without the stack.
	 */
	eraseAt(point: paper.Point): void {
		for (let i = 0; i < MAX_ERASURES_PER_EVENT; i++) {
			const hit = this.scene.activeLayer.hitTest(point, HIT_ERASE)
			if (hit?.type !== 'segment') return

			const path = hit.item as paper.Path

			// A two-point path is a single dash; take a point out of it and there's
			// nothing left worth keeping.
			if (path.segments.length <= 2) {
				path.remove()
				continue
			}

			if (hit.segment.index === 0) hit.segment.remove()
			else this.splitAt(path, hit.segment.index)
		}
	}

	/**
	 * Replaces `path` with the run before the erased point and the run after it.
	 *
	 * Either side is only rebuilt if it would have enough points to be a line —
	 * one leftover point is a stray dot, and a run of two is a dash you didn't draw.
	 */
	private splitAt(path: paper.Path, index: number): void {
		const points = path.segments.map((segment) => segment.point)

		if (index > 1) this.rebuild(path, points.slice(0, index))
		if (points.length - index > 2) this.rebuild(path, points.slice(index + 1))

		path.remove()
	}

	private rebuild(source: paper.Path, points: paper.Point[]): void {
		const path = new this.scene.scope.Path()
		path.style = source.style
		for (const point of points) path.add(point)
	}
}

import { oppositeIndex, sweepAngle } from '../geometry'
import type { Scene } from '../scene'
import type { Selection } from '../selection'
import type { ModalTool } from './types'

/**
 * Select and transform.
 *
 * One paper tool for the whole gesture. The 2013 version had five — it switched
 * `paper.tool` mid-mouse-down so that the drag events landed on a different tool
 * object — which worked, but left four tools carrying stale `downPoint` state
 * between gestures. Choosing a drag handler on mouse-down does the same job with
 * one tool and no shared state.
 */

interface DragHandler {
	drag(event: paper.ToolEvent): void
	end(): void
}

export interface TransformCallbacks {
	/** True while alt is held — a drag would leave a copy behind. */
	isDuplicating(): boolean
	/** True while shift is held — a drag adds to the selection instead of replacing it. */
	isExtending(): boolean
	/** Respaces the points of a stroke that's been squashed or stretched. */
	respace(path: paper.Path): void
}

export class TransformTool implements ModalTool {
	readonly tool: paper.Tool

	private readonly selection: Selection
	private readonly callbacks: TransformCallbacks

	private drag: DragHandler | null = null

	constructor(scene: Scene, selection: Selection, callbacks: TransformCallbacks) {
		this.selection = selection
		this.callbacks = callbacks

		this.tool = new scene.scope.Tool()
		this.tool.onMouseMove = (event: paper.ToolEvent) => this.handleMove(event)
		this.tool.onMouseDown = (event: paper.ToolEvent) => this.handleDown(event)
		this.tool.onMouseDrag = (event: paper.ToolEvent) => this.handleDrag(event)
		this.tool.onMouseUp = () => this.handleUp()
	}

	init(): boolean {
		// Coming back from push mode, which hid the box and recoloured the strokes.
		this.selection.reset()
		return true
	}

	activate(): void {
		this.tool.activate()
	}

	deactivate(): void {
		// Nothing to tear down.
	}

	private handleMove(event: paper.ToolEvent): void {
		this.selection.updateTransformType(event.point, this.callbacks.isExtending())
	}

	private handleDown(event: paper.ToolEvent): void {
		if (this.callbacks.isDuplicating() && this.selection.type !== 'push') {
			this.selection.duplicate()
		}

		const type = this.selection.updateTransformType(event.point, this.callbacks.isExtending())

		if (type !== 'none') {
			this.drag = this.createHandler(type, event.point)
			return
		}

		// Nothing grabbed: this is a new selection.
		this.drag = null
		if (!this.callbacks.isExtending()) this.selection.clear()

		// Clicking a selected stroke takes it back out of the selection.
		if (!this.selection.removeAt(event.point)) this.selection.addAt(event.point)

		this.selection.startMarquee(event.point)
	}

	private handleDrag(event: paper.ToolEvent): void {
		if (this.drag) {
			this.drag.drag(event)
			return
		}

		// Marquee select. Rebuilt from the down point every frame rather than
		// resized, because the drag can go in any direction from where it started.
		if (!this.callbacks.isExtending()) this.selection.clear()

		const rectangle = this.selection.dragMarquee(event.downPoint, event.point)
		this.selection.selectWithin(rectangle)
	}

	private handleUp(): void {
		this.drag?.end()
		this.drag = null

		this.selection.reset()
	}

	private createHandler(
		type: Exclude<ReturnType<Selection['updateTransformType']>, 'none'>,
		point: paper.Point,
	): DragHandler | null {
		switch (type) {
			case 'translate':
				return this.translateHandler(point)
			case 'rotate':
				return this.rotateHandler(point)
			case 'scale':
				return this.resizeHandler(false)
			case 'stretch':
				return this.resizeHandler(true)
			default:
				return null
		}
	}

	// --- drag handlers -------------------------------------------------------

	private translateHandler(start: paper.Point): DragHandler {
		let previous = start

		return {
			drag: (event) => {
				const delta = event.point.subtract(previous)
				for (const child of this.selection.layer.children) child.translate(delta)
				this.selection.bounds?.translate(delta)
				previous = event.point
			},
			end: () => {},
		}
	}

	private rotateHandler(start: paper.Point): DragHandler {
		let previous = start

		return {
			drag: (event) => {
				const bounds = this.selection.bounds
				if (!bounds) return

				const centre = bounds.position
				const angle = sweepAngle(previous, event.point, centre)

				this.selection.layer.rotate(angle, centre)
				bounds.rotate(angle, centre)
				previous = event.point
			},
			end: () => {},
		}
	}

	/**
	 * Corner drags scale both axes; edge drags stretch one.
	 *
	 * The pivot is the opposite handle, taken from the box path's own segments —
	 * so as the box is scaled the pivot stays where it is and the drag compounds
	 * frame by frame rather than being recomputed from the original size.
	 */
	private resizeHandler(stretching: boolean): DragHandler {
		return {
			drag: (event) => {
				const box = this.selection.bounds
				if (!box) return

				const dragged = stretching ? this.selection.draggedEdge() : this.selection.draggedCorner()
				if (dragged === null) return

				const pivotSegment = box.segments[oppositeIndex(dragged)]
				const draggedSegment = box.segments[dragged]
				if (!pivotSegment || !draggedSegment) return

				const pivot = pivotSegment.point
				const offset = event.point.subtract(pivot)

				let scaleX = Math.abs(offset.x) / box.bounds.width || 1
				let scaleY = Math.abs(offset.y) / box.bounds.height || 1

				// Left and right edges are even; top and bottom odd.
				if (stretching) {
					if (dragged % 2 === 0) scaleY = 1
					else scaleX = 1
				}

				for (const child of this.selection.layer.children) child.scale(scaleX, scaleY, pivot)
				box.scale(scaleX, scaleY, pivot)

				// Dragged past the pivot: mirror rather than collapse through zero.
				const crossed = event.point.subtract(draggedSegment.point)
				if (Math.abs(crossed.y) > 1 && scaleY !== 1) {
					this.selection.layer.scale(1, -1, pivot)
					box.scale(1, -1, pivot)
				} else if (Math.abs(crossed.x) > 1 && scaleX !== 1) {
					this.selection.layer.scale(-1, 1, pivot)
					box.scale(-1, 1, pivot)
				}
			},

			// Scaling moves points without adding any, so a stroke stretched to twice
			// its length ends up with points twice as far apart. Respace them.
			end: () => {
				for (const child of this.selection.layer.children) {
					if ('segments' in child) this.callbacks.respace(child as paper.Path)
				}
			},
		}
	}
}

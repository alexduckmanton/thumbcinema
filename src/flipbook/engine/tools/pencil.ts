import { FLATTEN_DISTANCE, PENCIL_COLOR } from '../constants'
import { resamplePolyline } from '../geometry'
import type { Scene } from './../scene'
import type { Selection } from './../selection'
import type { ModalTool } from './types'

export const MIN_PENCIL_WIDTH = 1
export const MAX_PENCIL_WIDTH = 10
export const DEFAULT_PENCIL_WIDTH = 3

export interface PencilOptions {
	/**
	 * Off for the pencil that redraws 2012 flipbooks on the playback page: it isn't a
	 * tool anyone is holding, so it mustn't be listening for the pointer.
	 */
	interactive?: boolean
	width?: number
}

/**
 * The pencil.
 *
 * A stroke is collected raw — one point per pointer event — and resampled to even
 * spacing when it finishes. See `resamplePolyline` for why that's a hand-rolled
 * step rather than paper's `flatten()`.
 */
export class PencilTool implements ModalTool {
	readonly tool: paper.Tool

	private readonly scene: Scene
	private readonly selection: Selection
	private readonly interactive: boolean

	private path: paper.Path | null = null
	private strokeWidth: number

	constructor(scene: Scene, selection: Selection, options: PencilOptions = {}) {
		this.scene = scene
		this.selection = selection
		this.interactive = options.interactive ?? true
		this.strokeWidth = options.width ?? DEFAULT_PENCIL_WIDTH

		this.tool = new scene.scope.Tool()

		if (this.interactive) {
			this.tool.onMouseDown = () => this.begin()
			this.tool.onMouseDrag = (event: paper.ToolEvent) => this.extend(event.point)
			this.tool.onMouseUp = () => this.end()
		}
	}

	get width(): number {
		return this.strokeWidth
	}

	setWidth(width: number): void {
		this.strokeWidth = Math.min(MAX_PENCIL_WIDTH, Math.max(MIN_PENCIL_WIDTH, Math.round(width)))
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
		// Nothing to tear down: paper deactivates the tool when another activates.
	}

	// --- drawing -------------------------------------------------------------

	begin(): void {
		this.path = new this.scene.scope.Path()
		this.path.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
		this.path.strokeWidth = this.strokeWidth
		this.path.strokeJoin = 'round'
		this.path.strokeCap = 'round'
	}

	extend(point: paper.Point): void {
		this.path?.add(point)
	}

	/** A tap that never moved leaves a one-point path, which is nothing. Drop it. */
	end(): void {
		const path = this.path
		this.path = null
		if (!path) return

		if (path.segments.length <= 1) {
			path.remove()
			return
		}

		this.finish(path)
	}

	/**
	 * Resamples a finished stroke and gives it a stable name.
	 *
	 * Also called by the scale, stretch and push tools: those move segments around
	 * without changing how many there are, so a stroke that's been stretched to
	 * twice its length ends up with points twice as far apart until it's respaced.
	 */
	finish(path: paper.Path): void {
		const resampled = resamplePolyline(
			path.segments.map((segment) => ({ x: segment.point.x, y: segment.point.y })),
			FLATTEN_DISTANCE,
		)

		path.removeSegments()
		path.addSegments(
			resampled.map((p) => new this.scene.scope.Segment(new this.scene.scope.Point(p.x, p.y))),
		)

		path.name = `${path.layer.id}_${path.id}`
	}
}

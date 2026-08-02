import { HIGHLIGHT_COLOR, PENCIL_COLOR } from '../constants'
import type { Scene } from '../scene'
import type { Selection } from '../selection'
import type { ModalTool } from './types'

/**
 * Push — the second mode of the transform button.
 *
 * Instead of moving a selection as a whole it shoves individual points around,
 * weighted by how close they are to the cursor, so a line bends rather than
 * travels. The blue dots are the weighting made visible: dot size *is* the
 * influence each point will feel.
 *
 * It only exists while something is selected, which is what `init()` returning
 * false is for — the transform button then cycles back to plain transform rather
 * than switching to a mode with nothing to act on.
 */

/** The square of influence around the cursor, in canvas pixels. */
const RADIUS = 100

/** Full-strength dot radius. Also the divisor that turns dot size back into weight. */
const DOT_RADIUS = 5

/** Above this the falloff curve flattens, so the very centre isn't disproportionately strong. */
const MAX_INFLUENCE = 0.75

export class PushTool implements ModalTool {
	readonly tool: paper.Tool

	private readonly scene: Scene
	private readonly selection: Selection
	private readonly showDots: boolean
	private readonly respace: (path: paper.Path) => void
	private readonly onExit: () => void

	private radius: paper.Path | null = null
	private dots: paper.Group | null = null

	/** Points currently under the cursor, two per dot: the sampled one and its neighbour. */
	private segments: paper.Segment[] = []

	private pointer: paper.Point | null = null

	constructor(
		scene: Scene,
		selection: Selection,
		options: {
			/** Dots are pointless on touch — there's a finger where the cursor would be. */
			showDots: boolean
			respace: (path: paper.Path) => void
			/** Called when a click on empty space should drop out of push mode. */
			onExit: () => void
		},
	) {
		this.scene = scene
		this.selection = selection
		this.showDots = options.showDots
		this.respace = options.respace
		this.onExit = options.onExit

		this.tool = new scene.scope.Tool()
		this.tool.onMouseDown = (event: paper.ToolEvent) => this.handleDown(event)
		this.tool.onMouseMove = (event: paper.ToolEvent) => this.handleMove(event)
		this.tool.onMouseDrag = (event: paper.ToolEvent) => this.handleDrag(event)
		this.tool.onMouseUp = (event: paper.ToolEvent) => this.handleUp(event)
	}

	init(): boolean {
		if (this.selection.isEmpty) return false

		this.selection.type = 'push'
		if (this.selection.bounds) this.selection.bounds.visible = false
		this.selection.layer.strokeColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)

		this.scene.guideLayer.activate()

		// Parked off-canvas until the pointer first moves, so it can't flash at 0,0.
		this.radius = new this.scene.scope.Path.Rectangle(
			new this.scene.scope.Point(-999, -999),
			new this.scene.scope.Size(RADIUS, RADIUS),
		)
		this.radius.visible = false

		this.dots = new this.scene.scope.Group()

		this.scene.redraw()
		return true
	}

	activate(): void {
		this.tool.activate()
	}

	deactivate(): void {
		this.selection.type = 'none'
		this.selection.layer.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)

		this.radius?.remove()
		this.radius = null
		this.dots?.remove()
		this.dots = null
		this.segments = []
		this.pointer = null

		this.selection.reset()
	}

	// --- pointer -------------------------------------------------------------

	private handleDown(event: paper.ToolEvent): void {
		this.pointer = event.point
		this.update()
	}

	private handleMove(event: paper.ToolEvent): void {
		this.pointer = event.point
		this.selection.setCursor('move')
		this.update()
	}

	private handleDrag(event: paper.ToolEvent): void {
		if (!this.dots) return

		// The dots are the *before* picture; hide them while the points are moving.
		this.dots.opacity = 0

		const delta = event.point.subtract(event.lastPoint)

		for (let i = 0; i < this.segments.length; i++) {
			const weight = this.weightFor(i)
			if (!weight) continue

			const segment = this.segments[i]!
			segment.point.x += delta.x * weight
			segment.point.y += delta.y * weight
		}
	}

	private handleUp(event: paper.ToolEvent): void {
		for (const child of this.selection.layer.children) {
			if ('segments' in child) this.respace(child as paper.Path)
		}

		this.update()

		// A click that didn't move, with nothing under the cursor, means "done".
		const moved = !event.lastPoint.equals(event.point)
		if (!moved && this.dots?.children.length === 0) {
			this.selection.clear()
			this.onExit()
		}
	}

	/**
	 * The influence a point feels, from the size of the dot drawn over it.
	 *
	 * Points come in pairs — the sampled one and the neighbour that came with it —
	 * so odd entries take the average of their own dot and the next one, which is
	 * what stops a stroke kinking at every other point.
	 */
	private weightFor(index: number): number {
		const dots = this.dots?.children
		if (!dots) return 0

		const dotIndex = Math.floor(index / 2)
		const dot = dots[dotIndex]
		if (!dot) return 0

		let width = dot.bounds.width
		if (index % 2 === 1 && dotIndex < dots.length - 1) {
			width = (width + dots[dotIndex + 1]!.bounds.width) / 2
		}
		if (!width) return 0

		// Undo the dot's own scaling to get back to the 0–1 falloff, then square it
		// so influence drops away sharply rather than linearly.
		const weight = width / 2 / DOT_RADIUS
		return weight * weight
	}

	/** Recomputes which points are in range and redraws the dots over them. */
	private update(): void {
		if (!this.radius || !this.dots || !this.pointer) return

		this.dots.opacity = this.showDots ? 1 : 0
		this.radius.visible = false
		this.radius.position = this.pointer

		this.dots.removeChildren()
		this.segments = []

		const area = this.radius.bounds
		const reach = area.width / 2

		for (const child of this.selection.layer.children) {
			if (!('segments' in child)) continue
			if (!area.intersects(child.bounds)) continue

			const segments = (child as paper.Path).segments

			// Every second point: one dot covers a point and its neighbour, which
			// halves the work without visibly coarsening the deformation.
			for (let i = 0; i < segments.length; i += 2) {
				const segment = segments[i]!
				if (!area.contains(segment.point)) continue

				this.segments.push(segment)
				const next = segments[i + 1]
				if (next) this.segments.push(next)

				// Clamped before the square root, not after: the region is a square, so
				// a point in a corner is further away than `reach` and would otherwise
				// take the root of a negative number and give the dot a radius of NaN.
				const nearness = Math.max(0, 1 - segment.point.getDistance(this.pointer) / reach)
				const falloff = Math.min(MAX_INFLUENCE, Math.sqrt(nearness))

				const dot = new this.scene.scope.Path.Circle(segment.point, DOT_RADIUS * falloff)
				dot.fillColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)
				this.dots.addChild(dot)
			}
		}
	}
}

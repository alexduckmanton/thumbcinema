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
 * **It is a tool in its own right, and used to be a mode of one.** It refused to
 * switch on unless something was already selected — `init()` returned false and the
 * transform button cycled straight back — so reaching it meant selecting with the
 * other tool first, and a click on empty space dropped you back out of it again.
 * Neither is true now: it selects the same way transform does (tap a stroke, or drag
 * a marquee) and stays switched on until you switch away. What decides between
 * pushing and selecting is simply whether there are points within reach of the
 * cursor, which is the same question the dots are already answering on screen.
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
	private readonly respace: (path: paper.Path) => void

	private radius: paper.Path | null = null
	private dots: paper.Group | null = null

	/** Points currently under the cursor, two per dot: the sampled one and its neighbour. */
	private segments: paper.Segment[] = []

	private pointer: paper.Point | null = null

	/** Whether the press in flight is bending points or drawing a marquee. */
	private pushing = false

	constructor(
		scene: Scene,
		selection: Selection,
		options: {
			respace: (path: paper.Path) => void
		},
	) {
		this.scene = scene
		this.selection = selection
		this.respace = options.respace

		this.tool = new scene.scope.Tool()
		this.tool.onMouseDown = (event: paper.ToolEvent) => this.handleDown(event)
		this.tool.onMouseMove = (event: paper.ToolEvent) => this.handleMove(event)
		this.tool.onMouseDrag = (event: paper.ToolEvent) => this.handleDrag(event)
		this.tool.onMouseUp = () => this.handleUp()
	}

	/** Always. There is nothing left for this tool to need before it can switch on. */
	init(): boolean {
		this.refresh()
		return true
	}

	/**
	 * The selection as this tool dresses it, and the two guides it works through.
	 *
	 * Called on the way in and after every change to what is selected. The rebuild is
	 * not optional: `Selection.reset` empties the guide layer, and the radius and the
	 * dot group live in it — so a marquee that went through `reset` would leave this
	 * tool holding two detached objects and drawing its dots into nothing.
	 */
	private refresh(): void {
		this.selection.reset()

		this.selection.setType('push')
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

		this.selection.layer.activate()
		this.scene.redraw()
	}

	activate(): void {
		this.tool.activate()
	}

	deactivate(): void {
		this.pushing = false
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

	/**
	 * Bend what is under the cursor, or — when nothing is — select.
	 *
	 * The test is the one already on screen: `update` has just worked out which points
	 * are in reach and drawn a dot over each, so "are there any dots" and "would a
	 * drag bend anything" are the same question, and the answer is visible before you
	 * press. Out of reach, this behaves exactly as the transform tool does — tap a
	 * stroke to take it, tap nothing to let go, drag to marquee.
	 */
	private handleDown(event: paper.ToolEvent): void {
		this.pointer = event.point
		this.update()

		this.pushing = this.segments.length > 0
		if (this.pushing) return

		this.selection.clear()
		this.selection.addAt(event.point)
		this.selection.startMarquee(event.point)
	}

	private handleMove(event: paper.ToolEvent): void {
		this.pointer = event.point
		this.update()
	}

	private handleDrag(event: paper.ToolEvent): void {
		if (!this.pushing) {
			this.selection.clear()
			const rectangle = this.selection.dragMarquee(event.downPoint, event.point)
			this.selection.selectWithin(rectangle)
			return
		}

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

	/**
	 * Respace what was bent, or settle what was selected.
	 *
	 * A press that never pushed has changed what is selected, and everything this tool
	 * draws is derived from that — so it goes back through `refresh` rather than
	 * `update`, which would recompute the dots against a guide layer the marquee has
	 * left behind.
	 */
	private handleUp(): void {
		if (!this.pushing) {
			this.refresh()
			// The dots belong under the cursor, and the cursor hasn't moved since.
			this.update()
			return
		}

		for (const child of this.selection.layer.children) {
			if ('segments' in child) this.respace(child as paper.Path)
		}

		this.update()
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

		// Shown at every width now. They used to be desktop-only, on the reasoning that
		// a finger is sitting where the cursor would be and would cover them — which was
		// true while the cursor *was* the fingertip, and is the whole thing `holdTool`
		// changed. The dots are the only statement this tool makes about what a drag
		// would bend, and on a phone they were the statement being withheld.
		this.dots.opacity = 1
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

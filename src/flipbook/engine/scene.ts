// paper-core rather than paper: the full build bundles PaperScript and its Acorn
// parser, which compile `.pjs` sources at runtime. Nothing here uses that, and it is
// most of the difference between a 240 KB chunk and a 150 KB one.
import paper from 'paper/dist/paper-core'

import { CANVAS_HEIGHT, CANVAS_WIDTH, ONION_OPACITY } from './constants'

/**
 * The paper.js side of a flipbook: one project, one layer per page, and three
 * layers of scaffolding underneath them.
 *
 * Layer order, bottom to top, is inherited from 2013 and is load-bearing:
 *
 *   0  selection   the default layer paper.setup() creates. Selected strokes are
 *                  moved *into* it, and it sits below the pages — which reads
 *                  correctly only because the page fades to 20% whenever anything
 *                  is selected.
 *   1  guide       the marquee and the transform box.
 *   2  undo        never visible; holds the one-step undo snapshot.
 *   3+ pages       one per page, in page order, exactly one of them visible (plus
 *                  the onion skin of the one before it).
 *
 * so page N is `project.layers[N + SYSTEM_LAYERS]`. Nothing else may be inserted
 * below the pages without moving that number.
 */
export const SYSTEM_LAYERS = 3

export class Scene {
	readonly scope: paper.PaperScope
	readonly canvas: HTMLCanvasElement

	readonly selectionLayer: paper.Layer
	readonly guideLayer: paper.Layer
	readonly undoLayer: paper.Layer

	/** The page currently being drawn on. Always `project.layers[page + SYSTEM_LAYERS]`. */
	activeLayer: paper.Layer
	/** The page showing through at 10%, or null on page one. */
	onionLayer: paper.Layer | null = null

	private activeIndex = 0

	/** How much smaller than 640×360 the canvas is being *shown* at. See `pinCoordinates`. */
	private displayScale = 1
	private readonly resizeObserver: ResizeObserver | null = null

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas
		canvas.width = CANVAS_WIDTH
		canvas.height = CANVAS_HEIGHT

		// A scope of our own rather than the global singleton: two engines can exist
		// briefly during a route change (and always do under React's StrictMode
		// double-mount), and sharing paper's default project makes that a mess.
		this.scope = new paper.PaperScope()
		this.scope.setup(canvas)

		this.resizeObserver = this.pinCoordinates()

		// `setup()` leaves the project with no layers at all — paper creates the first
		// one lazily, the moment anything asks for the active layer. So this getter
		// *is* the layer-zero constructor, and reading `layers[0]` would be undefined.
		this.selectionLayer = this.scope.project.activeLayer
		this.selectionLayer.applyMatrix = true

		this.guideLayer = new this.scope.Layer()

		this.undoLayer = new this.scope.Layer()
		this.undoLayer.visible = false

		this.activeLayer = new this.scope.Layer()
		this.activeLayer.activate()
	}

	/**
	 * Keeps the project 640×360 however small the canvas is drawn.
	 *
	 * paper takes the project's coordinate space from the *displayed* size of the
	 * element — `DomElement.getSize`, which is its bounding rectangle — so a canvas
	 * shown 350 CSS px wide on a phone gave a project 350 units wide, and every
	 * stroke, every thumbnail and every saved SVG came out that shape. Every flipbook
	 * ever made is 640×360 and they all have to stay interchangeable, so the view size
	 * is stated rather than measured and the display size is left entirely to CSS.
	 *
	 * Two things follow from that, and both are dealt with here:
	 *
	 *  - **paper writes an inline width and height** onto the element as it sizes it,
	 *    but only on a hidpi screen — where it also has to state the CSS size to keep
	 *    the backing store 2× it. That inline pair would beat the stylesheet and pin
	 *    the canvas at 640px on a 375px screen, so it is removed again.
	 *  - **A pointer is mapped to a project point by subtracting the element's
	 *    position and nothing else.** On a canvas drawn at half size every event would
	 *    land at half the distance from the top left that it should. `getEventPoint`
	 *    is the one place that conversion happens — for the tools, the hit tests and
	 *    the selection alike — so it is wrapped rather than each of them corrected.
	 *
	 * Not `view.zoom`, which is the mechanism this looks like it should be using:
	 * `project.exportSVG()` defaults to the view's bounds and multiplies its matrix
	 * into the output, so a zoomed view would save the artwork at the phone's scale
	 * *and* wrap it in an extra `<g>` — which would put every page in the archive one
	 * group out. See `assertLeadingGroups`.
	 */
	private pinCoordinates(): ResizeObserver | null {
		const view = this.scope.view

		view.viewSize = new this.scope.Size(CANVAS_WIDTH, CANVAS_HEIGHT)
		this.canvas.style.removeProperty('width')
		this.canvas.style.removeProperty('height')

		const toProject = view.getEventPoint.bind(view)
		// Untyped parameter on purpose: paper declares this as taking its own `Event`
		// class and hands it a DOM one, and naming either of them here is a lie. The
		// contextual type from the assignment is exactly what `toProject` accepts.
		view.getEventPoint = (event) => toProject(event).divide(this.displayScale)

		// Read once up front as well as watched: this runs in a layout effect, so the
		// canvas is already laid out, and the observer's first callback is a frame away.
		if (this.canvas.offsetWidth > 0) this.displayScale = this.canvas.offsetWidth / CANVAS_WIDTH

		if (typeof ResizeObserver === 'undefined') return null

		// The observer's own box rather than `getBoundingClientRect`: page animations
		// put a transform on this canvas, and the rectangle would report the scale of
		// whatever frame it is mid-flight in. A layout box doesn't move.
		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.borderBoxSize?.[0]?.inlineSize ?? this.canvas.offsetWidth
			if (width > 0) this.displayScale = width / CANVAS_WIDTH
		})
		observer.observe(this.canvas)

		return observer
	}

	get project(): paper.Project {
		return this.scope.project
	}

	get view(): paper.View {
		return this.scope.view
	}

	/**
	 * Brings the canvas up to date *now*.
	 *
	 * paper redraws on its own on the next animation frame, so this is only needed
	 * before something reads the pixels back — drawing the canvas into a page
	 * thumbnail, or `toDataURL` for the saved thumbnail. `view.update()` is a no-op
	 * when there's nothing pending, so calling it defensively costs nothing.
	 */
	redraw(): void {
		this.view.update()
	}

	// --- pages ---------------------------------------------------------------

	get pageCount(): number {
		return this.project.layers.length - SYSTEM_LAYERS
	}

	get activePage(): number {
		return this.activeIndex
	}

	pageLayer(index: number): paper.Layer {
		const layer = this.project.layers[index + SYSTEM_LAYERS]
		if (!layer) throw new RangeError(`No layer for page ${index}`)
		return layer
	}

	/**
	 * Inserts an empty page after `index` and makes it active.
	 * Returns the index of the new page.
	 */
	insertBlankPage(index: number): number {
		const previous = this.pageLayer(index)

		previous.visible = false

		const layer = new this.scope.Layer()
		layer.insertAbove(previous)

		this.activeLayer = layer
		this.activeIndex = index + 1
		layer.activate()

		return this.activeIndex
	}

	/**
	 * Copies page `index` in *before* itself, so the copy takes the current page's
	 * place in the sequence and the original becomes the page after it. That's what
	 * makes "duplicate" feel like continuing to draw rather than starting again.
	 *
	 * Returns the index the copy landed at, which is `index` — the active page
	 * doesn't move.
	 */
	duplicatePage(index: number): number {
		const current = this.pageLayer(index)

		const copy = current.clone() as paper.Layer
		copy.insertBelow(current)
		copy.opacity = 1
		copy.visible = false

		// clone() activates the copy; the page being drawn on has not changed — it
		// has only moved one along, because the copy went in underneath it.
		this.activeLayer.activate()
		this.activeIndex = index + 1

		return index
	}

	removePage(index: number): void {
		this.pageLayer(index).remove()
		if (this.activeIndex > index) this.activeIndex--
	}

	/**
	 * Shows page `index` and hides whatever was showing.
	 *
	 * The old layer is only hidden when it isn't also the onion skin — during
	 * playback the onion is off and every page takes its turn, and hiding a layer
	 * the onion still points at would leave a hole.
	 */
	setActivePage(index: number, options: { playing?: boolean } = {}): void {
		const next = this.pageLayer(index)

		if (options.playing || this.activeLayer !== this.onionLayer) {
			this.activeLayer.visible = false
		}

		this.activeIndex = index
		this.activeLayer = next
		next.opacity = 1
		next.visible = true
		next.activate()
	}

	// --- onion skin ----------------------------------------------------------

	/** The previous page, ghosted underneath the current one. Off on page one. */
	showOnion(): void {
		const index = this.activeIndex
		this.hideOnion()

		if (index <= 0) {
			this.onionLayer = null
			return
		}

		this.onionLayer = this.pageLayer(index - 1)
		this.onionLayer.opacity = ONION_OPACITY
		this.onionLayer.visible = true
	}

	hideOnion(): void {
		if (!this.onionLayer || this.onionLayer === this.activeLayer) return

		this.onionLayer.opacity = 1
		this.onionLayer.visible = false
	}

	clearOnion(): void {
		this.hideOnion()
		this.onionLayer = null
	}

	// --- one-step undo -------------------------------------------------------

	/**
	 * Snapshots a layer into the hidden undo layer.
	 *
	 * One step deep, as it has been since 2013: taken on mouse-down by whichever
	 * tool is about to change something, and spent by the next Cmd-Z. Depth is the
	 * only thing standing between this and a real history — the snapshot itself is
	 * a full copy of the layer, so a stack of them would be straightforward, but it
	 * would also be a change in behaviour rather than a port of it.
	 */
	snapshot(layer: paper.Layer): void {
		this.snapshotKind = layer === this.selectionLayer ? 'transform' : 'draw'
		copyChildren(layer, this.undoLayer)
	}

	/**
	 * What the pending snapshot is of, or null when there's nothing to undo.
	 *
	 * `draw` covers the pencil and the eraser and restores the page; `transform`
	 * covers push and restores the selection. Transforms proper have never been
	 * undoable — 2013 took the snapshot and then cleared it again on mouse-up, and
	 * making it work is a change in behaviour rather than a port of one.
	 */
	snapshotKind: 'draw' | 'transform' | null = null

	clearSnapshot(): void {
		this.snapshotKind = null
		this.undoLayer.removeChildren()
	}

	/** Exchanges a layer's contents with the snapshot, so undo is its own redo. */
	swapWithSnapshot(layer: paper.Layer): void {
		const temp = new this.scope.Layer()

		copyChildren(layer, temp)
		copyChildren(this.undoLayer, layer)
		copyChildren(temp, this.undoLayer)

		temp.remove()
	}

	/**
	 * Detaches paper from the canvas.
	 *
	 * Order matters and both halves are guarded: `project.remove()` clears the
	 * scope's project reference, and `scope.view` is derived from it — so reading
	 * the view afterwards gives null, and the second half of a StrictMode
	 * double-mount teardown would throw on the way out.
	 */
	destroy(): void {
		this.resizeObserver?.disconnect()

		const view = this.scope.view as paper.View | null
		const project = this.scope.project as paper.Project | null

		view?.remove()
		project?.remove()
	}
}

export function copyChildren(from: paper.Layer, to: paper.Layer, clear = true): void {
	if (clear) to.removeChildren()
	// copyTo() mutates neither side's child list order, so a plain forward walk is safe.
	for (const child of from.children) child.copyTo(to)
}

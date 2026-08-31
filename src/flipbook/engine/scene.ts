import { DEFAULT_PAGE_SIZE, ONION_OPACITY, type PageSize } from './constants'

/**
 * paper-core's exports: paper's scope object, minus PaperScript.
 *
 * paper-core rather than paper because the full build bundles PaperScript and its
 * Acorn parser, which compile `.pjs` sources at runtime. Nothing here uses that, and
 * it is most of the difference between a 240 KB chunk and a 150 KB one.
 *
 * **Handed in rather than imported, and that is load-bearing.** A static
 * `import paper from 'paper/dist/paper-core'` here put 71 kB gzipped into whichever
 * route chunk reached this file, so `lazy(() => import('./routes/…'))` did not
 * resolve — and the artwork fetch inside that route did not *start* — until paper had
 * downloaded and been evaluated. It was 77% of the playback route's second wave and
 * the whole of the boot spinner. `useFlipbookEngine` fetches it and passes it down.
 *
 * The shape is paper's own declaration of what `paper-core` exports. Only the type is
 * named here; `paper` is an ambient global namespace in paper's `.d.ts`, so every
 * `paper.Layer` below needs no import at all.
 */
export type PaperCore = Pick<paper.PaperScope, Exclude<keyof paper.PaperScope, 'PaperScript'>>

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
 *   2  staging     never visible, and empty except for the instant a page is being
 *                  read into the undo history or written back out of it. It was the
 *                  one-step undo's snapshot; `History` keeps its steps as strings
 *                  instead, and borrows this to serialise through.
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

	/**
	 * Scratch space for the history, and the third of the three system layers.
	 *
	 * It has to exist whether or not anything is using it: every one of the 585
	 * archive flipbooks was written by a project with three scaffolding layers under
	 * the pages, and `SYSTEM_LAYERS` is what reads them back. Left empty between uses,
	 * because `exportSVG` writes every layer and a page's worth of ink parked in here
	 * would be saved along with the flipbook.
	 */
	readonly stagingLayer: paper.Layer

	/** The page currently being drawn on. Always `project.layers[page + SYSTEM_LAYERS]`. */
	activeLayer: paper.Layer
	/** The page showing through at 10%, or null on page one. */
	onionLayer: paper.Layer | null = null

	private activeIndex = 0

	/**
	 * The size of a page, in project units — the coordinate space every number in the
	 * artwork is in. Set at construction and changed only by `resize`.
	 */
	page: PageSize

	/** How much smaller than `page` the canvas is being *shown* at. See `pinCoordinates`. */
	private displayScale = 1
	private readonly resizeObserver: ResizeObserver | null = null

	/**
	 * CSS pixels lifted off a *touch* point before it becomes a project point.
	 *
	 * Zero except in the v4 drawing mode, where the whole idea is that the mark lands
	 * clear of the fingertip covering it. It belongs here rather than in the layer that
	 * owns that mode, because `getEventPoint` below is already the one place a pointer
	 * becomes a project point — for the tools, the hit tests and the selection alike —
	 * and a second place would have to be right about all three.
	 *
	 * Touch only: a mouse occludes nothing, and moving its cursor 40px off the arrow
	 * would be a bug rather than a mode.
	 */
	touchOffsetY = 0

	constructor(canvas: HTMLCanvasElement, paperCore: PaperCore, page: PageSize = DEFAULT_PAGE_SIZE) {
		this.canvas = canvas
		this.page = page
		canvas.width = page.width
		canvas.height = page.height

		// A scope of our own rather than the global singleton: two engines can exist
		// briefly during a route change (and always do under React's StrictMode
		// double-mount), and sharing paper's default project makes that a mess.
		//
		// Only `paperCore` is needed after this line — everything else goes through
		// the scope — so nothing holds on to the module.
		this.scope = new paperCore.PaperScope()
		this.scope.setup(canvas)

		this.resizeObserver = this.pinCoordinates()

		// `setup()` leaves the project with no layers at all — paper creates the first
		// one lazily, the moment anything asks for the active layer. So this getter
		// *is* the layer-zero constructor, and reading `layers[0]` would be undefined.
		this.selectionLayer = this.scope.project.activeLayer
		this.selectionLayer.applyMatrix = true

		this.guideLayer = new this.scope.Layer()

		this.stagingLayer = new this.scope.Layer()
		this.stagingLayer.visible = false

		this.activeLayer = new this.scope.Layer()
		this.activeLayer.activate()
	}

	/**
	 * Keeps the project `page`-sized however small the canvas is drawn.
	 *
	 * paper takes the project's coordinate space from the *displayed* size of the
	 * element — `DomElement.getSize`, which is its bounding rectangle — so a canvas
	 * shown 350 CSS px wide on a phone gave a project 350 units wide, and every
	 * stroke, every thumbnail and every saved SVG came out that shape. A flipbook's
	 * shape has to be a property of the flipbook rather than of the screen it was drawn
	 * on, so the view size is stated rather than measured and the display size is left
	 * entirely to CSS.
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

		view.viewSize = new this.scope.Size(this.page.width, this.page.height)
		this.canvas.style.removeProperty('width')
		this.canvas.style.removeProperty('height')

		const toProject = view.getEventPoint.bind(view)
		// Untyped parameter on purpose: paper declares this as taking its own `Event`
		// class and hands it a DOM one, and naming either of them here is a lie. The
		// contextual type from the assignment is exactly what `toProject` accepts.
		view.getEventPoint = (event) => {
			const point = toProject(event).divide(this.displayScale)
			if (!this.touchOffsetY || !isTouchEvent(event)) return point

			// The offset is stated in CSS pixels and applied in project units, so it has
			// to be scaled the same way the point was: 40px is 40 units on a desktop and
			// nearer 75 on a phone showing 640 of them in 343.
			return point.subtract(new this.scope.Point(0, this.touchOffsetY / this.displayScale))
		}

		// Read once up front as well as watched: this runs in a layout effect, so the
		// canvas is already laid out, and the observer's first callback is a frame away.
		if (this.canvas.offsetWidth > 0) this.displayScale = this.canvas.offsetWidth / this.page.width

		if (typeof ResizeObserver === 'undefined') return null

		// The observer's own box rather than `getBoundingClientRect`: page animations
		// put a transform on this canvas, and the rectangle would report the scale of
		// whatever frame it is mid-flight in. A layout box doesn't move.
		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.borderBoxSize?.[0]?.inlineSize ?? this.canvas.offsetWidth
			if (width > 0) this.displayScale = width / this.page.width
		})
		observer.observe(this.canvas)

		return observer
	}

	/**
	 * Restates the coordinate space, for artwork that turns out to be another shape.
	 *
	 * The drawing tool opens before it knows what it is opening — the engine is built
	 * the moment the canvas is in the DOM, and a remix's artwork is still on the wire
	 * at that point. Rather than hold the whole page up on a fetch, the scene starts at
	 * a default and is corrected here the instant the file says otherwise. See
	 * `pageSizeFromSvg`, which is where that answer comes from.
	 *
	 * Only safe before anything has been imported, which is the only place it is called
	 * from: `view.viewSize` re-resolves the project's coordinate space, and geometry
	 * already placed in it would keep the numbers it was given and so move. Both
	 * loaders clear the project first and resize before importing a single stroke.
	 */
	resize(page: PageSize): void {
		if (page.width === this.page.width && page.height === this.page.height) return

		this.page = page
		this.canvas.width = page.width
		this.canvas.height = page.height

		this.scope.view.viewSize = new this.scope.Size(page.width, page.height)
		// paper writes an inline width and height as it sizes the view on a hidpi
		// screen, and those would beat the stylesheet exactly as they do on the way in.
		this.canvas.style.removeProperty('width')
		this.canvas.style.removeProperty('height')

		if (this.canvas.offsetWidth > 0) this.displayScale = this.canvas.offsetWidth / page.width
	}

	get project(): paper.Project {
		return this.scope.project
	}

	get view(): paper.View {
		return this.scope.view
	}

	/**
	 * A point on the canvas, in CSS pixels from its top left, as a project point.
	 *
	 * The same conversion `getEventPoint` does, for the drawing modes that drive a
	 * tool directly instead of letting paper dispatch to it — see `PointerLayer`.
	 * They have already decided where the mark goes by the time they get here, so
	 * this deliberately does *not* apply `touchOffsetY`: that offset describes a
	 * fingertip, and what these hand over is a mark.
	 */
	toProject(x: number, y: number): paper.Point {
		return new this.scope.Point(x / this.displayScale, y / this.displayScale)
	}

	/**
	 * A point that is already in project units, as one of paper's own.
	 *
	 * The zoom stage works in project units from the start — it is a window on the page
	 * expressed in the page's own coordinates — so it has nothing for `toProject` to
	 * convert and would be undone by the display scale if it went through it.
	 */
	point(x: number, y: number): paper.Point {
		return new this.scope.Point(x, y)
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
	 * Adds an empty page at the end of the book and hands it back, leaving the page
	 * on screen exactly where it is.
	 *
	 * `insertBlankPage` is the drawing tool's version and does the opposite: it hides
	 * the page you were on and moves you to the new one. A load wants neither. Pages
	 * arrive behind whatever the canvas is already showing, which is what lets
	 * playback run over the ones that have landed while the rest are still being
	 * built — and is also why a flipbook no longer visibly draws itself as it loads.
	 */
	appendPage(): paper.Layer {
		const layer = new this.scope.Layer()
		layer.visible = false

		// A new layer activates itself, and paper puts new items in whichever layer
		// is active. The page being shown hasn't changed, so hand activation back.
		this.activeLayer.activate()

		return layer
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

	/**
	 * Puts an empty page *at* `index`, pushing whatever was there along, and leaves the
	 * page on screen where it is.
	 *
	 * The history's version of `insertBlankPage`, which can only insert after a page
	 * and always moves you onto the result. Undoing a delete has to be able to put a
	 * page back at the front of the flipbook, and has its own opinion about where you
	 * should be standing afterwards.
	 */
	insertPageAt(index: number): paper.Layer {
		const layer = new this.scope.Layer()
		layer.visible = false

		// Page zero goes directly above the last of the system layers; anything else
		// goes above the page it follows. The new layer is at the end of the project
		// until this line, so the lookup is against the old numbering — which is the
		// numbering `index` was measured in.
		layer.insertAbove(index === 0 ? this.stagingLayer : this.pageLayer(index - 1))

		// A new layer activates itself, and the page being drawn on has not changed.
		this.activeLayer.activate()

		return layer
	}

	removePage(index: number): void {
		this.pageLayer(index).remove()
		if (this.activeIndex > index) this.activeIndex--
	}

	/**
	 * Takes page `from` out of the sequence and puts it back at `to`, closing the gap
	 * behind it. Everything between the two shuffles along by one.
	 *
	 * The reference layer is read in the *old* numbering, because that is the numbering
	 * `from` and `to` are quoted in — but `insertAbove` removes this layer before it
	 * reads the reference's index, so what it inserts above is the reference's position
	 * in the gap-closed array. That is exactly `splice` out, `splice` in, and it is why
	 * the two cases below differ by one: dragging a page forwards passes over the page
	 * it is displacing, and dragging it back does not.
	 *
	 * Page zero goes above the last of the system layers, as `insertPageAt` does.
	 */
	movePage(from: number, to: number): void {
		if (from === to) return

		const layer = this.pageLayer(from)
		const below = to === 0 ? this.stagingLayer : this.pageLayer(to < from ? to - 1 : to)

		layer.insertAbove(below)

		if (this.activeIndex === from) this.activeIndex = to
		else if (from < this.activeIndex && to >= this.activeIndex) this.activeIndex--
		else if (from > this.activeIndex && to <= this.activeIndex) this.activeIndex++

		// paper hands `project._activeLayer` to a sibling when the layer it points at is
		// removed, and moving a layer *is* a remove and a re-insert. Nothing here has
		// changed which page is being drawn on, so it is handed straight back — otherwise
		// the next stroke would land on whichever page happened to be next door.
		this.activeLayer.activate()
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

/**
 * Whether paper handed us a touch event rather than a mouse one.
 *
 * paper picks its event set once at load and, on anything current, picks touch: the
 * pointer-events branch is guarded by `navigator.pointerEnabled`, which was IE11's
 * and Edge's and exists in no browser shipping today. So on a phone every event
 * through `getEventPoint` is a `TouchEvent`, and on a desktop none of them are.
 *
 * Asked of the event rather than of the device, for the reason `InkCursor` gives:
 * a tablet with a trackpad is a touch device all day, including while somebody is
 * using the trackpad.
 */
function isTouchEvent(event: unknown): boolean {
	return typeof event === 'object' && event !== null && 'targetTouches' in event
}

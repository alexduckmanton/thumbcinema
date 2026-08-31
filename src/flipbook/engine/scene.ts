import {
	canvasExtent,
	canvasOrigin,
	DEFAULT_PAGE_SIZE,
	ONION_OPACITY,
	type PageSize,
} from './constants'

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

		// The backing store is the *extent*, not the page: the whole drawable area has
		// to be rendered, because the zoom stage shows a window of this canvas by
		// copying pixels out of it and a surround that was never drawn would be blank.
		const extent = canvasExtent(page)
		canvas.width = extent.width
		canvas.height = extent.height

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
	 *
	 * **The view covers the whole extent and the page keeps its origin at (0,0).** The
	 * surround is negative on both axes rather than the page being offset into a bigger
	 * space, and that is the decision the export rests on: every coordinate in the
	 * artwork means what it has always meant, so a flipbook drawn on an infinite canvas
	 * is byte-identical to one drawn before there was one. `view.center` is what puts the
	 * page in the middle of the canvas; `exportRoot` is what pins the export back to it.
	 */
	private pinCoordinates(): ResizeObserver | null {
		const view = this.scope.view

		this.stateViewSize()
		this.canvas.style.removeProperty('width')
		this.canvas.style.removeProperty('height')

		const toProject = view.getEventPoint.bind(view)
		// Untyped parameter on purpose: paper declares this as taking its own `Event`
		// class and hands it a DOM one, and naming either of them here is a lie. The
		// contextual type from the assignment is exactly what `toProject` accepts.
		view.getEventPoint = (event) => {
			/*
			 * Scaled about the canvas's own origin, and the order is the whole of it.
			 *
			 * paper's answer already carries the view's translation — the surround puts the
			 * canvas's top-left corner at `canvasOrigin`, which is negative — so a plain
			 * divide would scale that offset along with the position and land every event a
			 * few hundred units from where the pointer is. Taking the origin off first,
			 * scaling, and putting it back applies the correction to the part that needs it.
			 *
			 * Caught by a stroke that simply did not appear. A mouse on a desktop draws
			 * through this and a finger does not — touch goes through `PointerLayer` and the
			 * stage's own mapping — so touch went on working perfectly at every width while
			 * a pointer drew nothing at all.
			 */
			const origin = new this.scope.Point(canvasOrigin(this.page))
			const point = toProject(event).subtract(origin).divide(this.displayScale).add(origin)
			if (!this.touchOffsetY || !isTouchEvent(event)) return point

			// The offset is stated in CSS pixels and applied in project units, so it has
			// to be scaled the same way the point was: 40px is 40 units on a desktop and
			// nearer 75 on a phone showing 640 of them in 343. A delta rather than a
			// position, so the origin does not come into it.
			return point.subtract(new this.scope.Point(0, this.touchOffsetY / this.displayScale))
		}

		// Read once up front as well as watched: this runs in a layout effect, so the
		// canvas is already laid out, and the observer's first callback is a frame away.
		this.measureDisplayScale(this.canvas.offsetWidth)

		if (typeof ResizeObserver === 'undefined') return null

		// The observer's own box rather than `getBoundingClientRect`: page animations
		// put a transform on this canvas, and the rectangle would report the scale of
		// whatever frame it is mid-flight in. A layout box doesn't move.
		const observer = new ResizeObserver(([entry]) => {
			this.measureDisplayScale(entry?.borderBoxSize?.[0]?.inlineSize ?? this.canvas.offsetWidth)
		})
		observer.observe(this.canvas)

		return observer
	}

	/**
	 * States the coordinate space: the extent, with the page in the middle of it.
	 *
	 * Both lines matter and they have to be in this order — `viewSize` re-resolves the
	 * space and puts the centre back in the middle of it, so a centre set first would be
	 * thrown away.
	 */
	private stateViewSize(): void {
		const extent = canvasExtent(this.page)
		this.scope.view.viewSize = new this.scope.Size(extent.width, extent.height)
		this.scope.view.center = new this.scope.Point(this.page.width / 2, this.page.height / 2)
	}

	/**
	 * How much smaller than the extent the canvas is being shown at.
	 *
	 * Against the extent rather than the page, because that is what the element holds:
	 * the whole drawable area is rendered into it, so a pointer halfway across the
	 * element is halfway across the *extent*.
	 */
	private measureDisplayScale(width: number): void {
		if (width > 0) this.displayScale = width / canvasExtent(this.page).width
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
		const extent = canvasExtent(page)
		this.canvas.width = extent.width
		this.canvas.height = extent.height

		this.stateViewSize()
		// paper writes an inline width and height as it sizes the view on a hidpi
		// screen, and those would beat the stylesheet exactly as they do on the way in.
		this.canvas.style.removeProperty('width')
		this.canvas.style.removeProperty('height')

		this.measureDisplayScale(this.canvas.offsetWidth)
	}

	/**
	 * The artwork as an SVG root, pinned to the page rather than to the view.
	 *
	 * **The one place the extent must not reach**, and the only reason `exportSVG` is
	 * wrapped at all. Left to itself paper exports the view's bounds — which is now the
	 * whole 2× canvas — and the result is wrong in two ways at once, both silent enough
	 * to reach production: the root states the extent's size, so every flipbook saved
	 * would read back as a page twice its real shape, on its card, on its playback page
	 * and in every remix of it for ever; and the non-identity view matrix makes paper wrap
	 * the whole project in a single `<g>`, which collapses the layer-per-page structure
	 * the format rests on. `assertLeadingGroups` catches the second. Nothing but this
	 * catches the first.
	 *
	 * With explicit bounds the output is byte-identical to what it was before there was a
	 * surround: the page's own viewBox, its own width and height, one group per layer and
	 * no transform on any of them. Proved in `scene.test.ts` against a real project rather
	 * than reasoned about, because the failure mode is a correct-looking file.
	 *
	 * It does *not* drop the surround — ink outside the page is still written, and clipped
	 * only by the viewBox on the way back in. Removing it is the save path's job; see
	 * `FlipbookEngine.exportForSave`, which does it for the file size rather than for the
	 * shape.
	 */
	exportRoot(): SVGElement {
		return this.project.exportSVG({
			asString: false,
			bounds: this.pageRect(),
		}) as SVGElement
	}

	/** The page, as a paper rectangle in project units. Its origin is the artwork's. */
	pageRect(): paper.Rectangle {
		return new this.scope.Rectangle(0, 0, this.page.width, this.page.height)
	}

	/**
	 * Where the page sits inside the canvas's backing store, in device pixels.
	 *
	 * For anything reading pixels *out* of the live canvas and wanting only the flipbook:
	 * the cover PNG, and the zoom stage's fallback. The canvas holds the whole extent, so
	 * the page is a rectangle in the middle of it — and the scale is measured off the
	 * element rather than assumed, because paper multiplies the backing store by the
	 * device pixel ratio and a hard 2 would be wrong on every screen that isn't retina.
	 */
	pageBox(): { x: number; y: number; width: number; height: number } {
		const extent = canvasExtent(this.page)
		const scale = this.canvas.width / extent.width

		return {
			x: ((extent.width - this.page.width) / 2) * scale,
			y: ((extent.height - this.page.height) / 2) * scale,
			width: this.page.width * scale,
			height: this.page.height * scale,
		}
	}

	/**
	 * Runs `fn` with everything drawn entirely outside the page taken out of the project,
	 * and puts it all back afterwards.
	 *
	 * The save path's, and the reason the surround costs the saved file nothing. Ink past
	 * the frame is still *written* by `exportRoot` — the viewBox clips it on the way back
	 * in, so it is invisible and it still travels — and the save request is capped at
	 * about 2.5 MB of drawing. A canvas four times the area could quietly spend most of
	 * that budget on strokes nobody will ever see.
	 *
	 * **Entirely outside, by `strokeBounds`.** A stroke that crosses the frame's edge
	 * stays whole and is clipped by the viewBox, which is both simpler and truer than
	 * cutting the path: the geometry that survives is the geometry that was drawn, and
	 * every renderer that reads this file already clips to the root. `strokeBounds` rather
	 * than `bounds` so a thick line just past the edge, whose ink laps over it, is kept.
	 *
	 * Nothing is painted in between. Every line of this runs in one go and the browser
	 * paints at frame boundaries, which is the same reason `captureCover` can move the
	 * active page and put it back without a flicker. Items go back at the index they came
	 * from, restored deepest-last, so z-order within a page is exactly what it was.
	 */
	withoutOverspill<T>(fn: () => T): T {
		const page = this.pageRect()
		const taken: { layer: paper.Layer; index: number; item: paper.Item }[] = []

		for (let i = SYSTEM_LAYERS; i < this.project.layers.length; i++) {
			const layer = this.project.layers[i]
			if (!layer) continue

			for (const item of layer.children) {
				if (item.strokeBounds.intersects(page)) continue
				taken.push({ layer, index: item.index, item })
			}
		}

		for (const { item } of taken) item.remove()

		try {
			return fn()
		} finally {
			// Ascending, so each insertion lands at the index it was read at: an item put
			// back at 2 shifts everything above it, and the one that was at 5 is at 5 again
			// only once every lower one is already there.
			for (const { layer, index, item } of taken) layer.insertChild(index, item)
		}
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

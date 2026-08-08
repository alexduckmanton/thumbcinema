import { DUPLICATE_COLOR, FADED_OPACITY, HIGHLIGHT_COLOR, PENCIL_COLOR } from './constants'
import { cornerIndex, edgeIndex } from './geometry'
import type { Scene } from './scene'

/**
 * Selecting and transforming strokes.
 *
 * The model is unusual and worth stating plainly, because everything downstream
 * assumes it: a *selected* stroke isn't flagged, it is physically moved out of the
 * page's layer and into the selection layer. Deselecting copies it back. That's why
 * the page fades to 20% while something is selected — the selection layer draws
 * beneath the pages, and the fade is what lets you see it.
 */

export type TransformType = 'none' | 'translate' | 'scale' | 'rotate' | 'stretch' | 'push'

/** paper types its hit-test options inline, so this names them once. */
type HitOptions = Parameters<paper.Item['hitTest']>[1]

/** Picking strokes: generous, and only on the stroke itself. */
const HIT_SELECT: HitOptions = {
	fill: false,
	bounds: false,
	stroke: true,
	tolerance: 10,
}

const MARQUEE_STROKE = '#ccc'
const MARQUEE_DASH = [4, 2]

/** How far outside the box counts as "grab to rotate". */
const ROTATE_RADIUS = 100

export class Selection {
	private readonly scene: Scene

	/** The dashed box round the selection, in the guide layer. */
	bounds: paper.Path | null = null
	/** The drag-select rectangle, also in the guide layer. */
	marquee: paper.Path | null = null

	type: TransformType = 'none'

	/**
	 * Told when `type` has been recomputed, whatever it came out as.
	 *
	 * This used to write a native cursor onto the canvas — `move`, `alias`,
	 * `nwse-resize` and the rest — which was how the tool explained itself to a mouse and
	 * was invisible to a finger. The cursor is drawn now, at the point the tool is
	 * actually working from, so what has to leave this file is the *fact* rather than the
	 * name of a CSS cursor. See `FlipbookEngine.subscribeGrab`.
	 */
	onGrabChanged: (() => void) | null = null

	/**
	 * Told whenever what is selected changes — anything picked up, anything put down.
	 *
	 * Separate from `onGrabChanged`, which is about what a drag *would* do and fires on
	 * every pointer move over a selection that hasn't changed at all. This one fires
	 * only when the layer's contents do, which is a handful of times in a gesture, and
	 * it exists because the Copy button has to know whether there is anything to copy.
	 * Every route in and out of the selection goes through the methods below, so this is
	 * the one place that fact is knowable.
	 */
	onChange: (() => void) | null = null

	/** The handle under the pointer, from the last `updateTransformType`. */
	handle: paper.HitResult | null = null

	/**
	 * Grab tolerance for the box's own handles. Scaled to the selection: a tiny
	 * selection whose corners are 8px apart can't afford a 50px grab radius, or
	 * every corner is every other corner.
	 */
	private handleTolerance = 50

	constructor(scene: Scene) {
		this.scene = scene
	}

	get layer(): paper.Layer {
		return this.scene.selectionLayer
	}

	get isEmpty(): boolean {
		return this.layer.children.length === 0
	}

	// --- selecting -----------------------------------------------------------

	/** Adds the stroke under `point` to the selection, if there is one. */
	addAt(point: paper.Point): boolean {
		const hit = this.scene.activeLayer.hitTest(point, HIT_SELECT)
		if (!hit?.item) return false

		this.layer.addChild(hit.item)
		hit.item.strokeColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)
		this.onChange?.()
		return true
	}

	/** Removes the stroke under `point` from the selection, if it's in it. */
	removeAt(point: paper.Point): boolean {
		const hit = this.layer.hitTest(point, HIT_SELECT)
		if (!hit?.item) return false

		this.scene.activeLayer.addChild(hit.item)
		this.onChange?.()
		return true
	}

	/**
	 * Everything the marquee touches. Bounds first as a cheap reject, then a segment
	 * test — a diagonal stroke's bounding box overlaps a lot of rectangle it isn't
	 * actually inside.
	 */
	selectWithin(rectangle: paper.Rectangle): void {
		// Walk a snapshot: addChild() moves items out of the list being iterated.
		for (const item of [...this.scene.activeLayer.children]) {
			if (!rectangle.intersects(item.bounds)) continue
			if (!('segments' in item)) continue

			const segments = (item as paper.Path).segments
			if (segments.some((segment) => segment.point.isInside(rectangle))) {
				this.layer.addChild(item)
				item.strokeColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)
			}
		}

		this.onChange?.()
	}

	/**
	 * Puts a set of strokes straight into the selection, wherever they came from.
	 *
	 * `hold` is the other way in and takes only strokes that are already lying on the
	 * page — it exists to pick back up what `clear` has just put down. These have never
	 * been anywhere: they are clones off the clipboard, and this is where a paste lands.
	 *
	 * The box isn't drawn here. The tool in hand dresses a selection its own way — a
	 * dashed box for transform, blue strokes and a grid of dots for push — and `init` is
	 * what each of them already does to make the scene its own. See `pasteClipboard`.
	 */
	receive(items: readonly paper.Item[]): void {
		for (const item of items) {
			this.layer.addChild(item)
			item.strokeColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)
		}

		this.onChange?.()
	}

	/**
	 * Puts everything back on the page and takes the box down.
	 *
	 * Hands back what it put there, because one caller wants it again: duplicating a
	 * page has to let go of the selection while the page is copied, and takes hold of
	 * the same strokes on the other side of it. See `hold`.
	 */
	clear(): paper.Item[] {
		this.removeMarquee()
		this.removeBounds()

		const dropped: paper.Item[] = []
		for (const child of this.layer.children) {
			const copy = child.copyTo(this.scene.activeLayer)
			copy.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
			dropped.push(copy)
		}
		this.layer.removeChildren()

		this.scene.activeLayer.activate()
		this.setLayerOpacity(this.scene.activeLayer, 1)

		this.type = 'none'
		this.onGrabChanged?.()
		this.onChange?.()
		this.scene.redraw()

		return dropped
	}

	/**
	 * Picks a set of strokes back up, and draws the box round them.
	 *
	 * Only ever the ones `clear` has just put down, and only from the page they are
	 * standing on — anything that has since left the page is skipped rather than dragged
	 * back into the selection layer from nowhere.
	 */
	hold(items: paper.Item[]): void {
		for (const item of items) {
			if (item.parent !== this.scene.activeLayer) continue

			this.layer.addChild(item)
			item.strokeColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)
		}

		this.onChange?.()
		this.reset()
	}

	deleteSelected(): void {
		this.layer.removeChildren()
		this.clear()
	}

	/** Alt-drag: leaves a copy behind on the page and drags the original. */
	duplicate(): void {
		for (const child of this.layer.children) child.copyTo(this.scene.activeLayer)
		this.fadePage()
	}

	// --- the transform box ---------------------------------------------------

	/**
	 * Redraws the box round whatever is selected and hands control back to the
	 * transform tool. Called after every drag finishes.
	 */
	reset(): void {
		this.removeMarquee()

		this.scene.guideLayer.activate()
		this.scene.guideLayer.removeChildren()
		this.bounds = null

		if (!this.isEmpty) {
			// Half-pixel offsets so a 1px dashed box lands on the pixel grid instead
			// of straddling it and rendering as two grey lines.
			const box = this.layer.bounds
			const rectangle = new this.scene.scope.Rectangle(
				box.topLeft.round().subtract(0.5),
				box.bottomRight.round().add(0.5),
			)

			this.bounds = new this.scene.scope.Path.Rectangle(rectangle)
			this.bounds.strokeColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)
			this.bounds.strokeWidth = 1
			this.bounds.dashArray = [4, 2]

			this.handleTolerance = Math.ceil(Math.sqrt(Math.min(rectangle.width, rectangle.height)))
		}

		this.layer.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
		if (this.isEmpty) this.setLayerOpacity(this.scene.activeLayer, 1)
		else this.fadePage()

		this.layer.activate()
		this.scene.redraw()
	}

	/**
	 * Push declares its own type on the way in rather than hit-testing for one: it bends
	 * a stroke wherever the cursor is, so there are no handles and nothing to be over.
	 */
	setType(type: TransformType): void {
		this.type = type
		this.onGrabChanged?.()
	}

	/** While a drag would duplicate rather than move, the box turns green. */
	setDuplicating(duplicating: boolean): void {
		if (!this.bounds) return
		this.bounds.strokeColor = new this.scene.scope.Color(
			duplicating ? DUPLICATE_COLOR : HIGHLIGHT_COLOR,
		)
	}

	/**
	 * Works out what a drag from `point` would do. Called on every pointer move while
	 * the transform tool is active, and what the drawn cursor is a picture of.
	 */
	updateTransformType(point: paper.Point, shiftHeld: boolean): TransformType {
		const type = this.computeTransformType(point, shiftHeld)
		this.onGrabChanged?.()
		return type
	}

	private computeTransformType(point: paper.Point, shiftHeld: boolean): TransformType {
		this.type = 'none'
		this.handle = null

		if (this.isEmpty || !this.bounds || shiftHeld) return this.type

		// Anywhere in a generous ring outside the box rotates — unless something
		// below claims the point first.
		if (isWithinOuterRadius(this.bounds, point, ROTATE_RADIUS)) {
			this.type = 'rotate'
		}

		/*
		 * Inside the box moves it, and that beats everything else.
		 *
		 * Asked of the rectangle directly rather than of a hit test, which is what
		 * 2013 did: the box carried a fully transparent fill and `hitTest({fill: true})`
		 * answered for the whole interior. paper 0.12 changed `Style.hasFill()` to
		 * require `alpha > 0`, so a transparent fill is now no fill and that hit never
		 * fires — leaving only the outline within grab tolerance, which is why the
		 * inside of a selection rotated and just its inner edge moved.
		 */
		if (this.bounds.bounds.contains(point)) {
			this.type = 'translate'
			return this.type
		}

		// Outside it: the corner and edge handles, which reach `handleTolerance`
		// beyond the box.
		const handle = this.bounds.hitTest(point, {
			bounds: true,
			stroke: true,
			tolerance: this.handleTolerance,
		})
		if (!handle) return this.type

		this.handle = handle

		const corner = cornerIndex(handle.name)
		if (corner !== null) {
			this.type = 'scale'
			return this.type
		}

		if (handle.type === 'stroke' || handle.type === 'bounds') {
			this.type = 'stretch'
		}

		return this.type
	}

	/**
	 * Which edge of the box is being stretched. A hit on the box's outline gives a
	 * curve index directly; a hit on a handle gives a name to look up.
	 */
	draggedEdge(): number | null {
		if (!this.handle) return null
		if (this.handle.type === 'stroke') return this.handle.location?.index ?? null
		return edgeIndex(this.handle.name)
	}

	draggedCorner(): number | null {
		return this.handle ? cornerIndex(this.handle.name) : null
	}

	// --- the marquee ---------------------------------------------------------

	startMarquee(point: paper.Point): void {
		this.removeMarquee()
		this.scene.guideLayer.activate()

		const size = 5
		const rectangle = new this.scene.scope.Rectangle(
			point.subtract(size / 2),
			new this.scene.scope.Size(size, size),
		)
		this.marquee = new this.scene.scope.Path.Rectangle(rectangle)
		this.styleMarquee(this.marquee)

		this.scene.activeLayer.activate()
	}

	dragMarquee(from: paper.Point, to: paper.Point): paper.Rectangle {
		this.removeMarquee()
		this.scene.guideLayer.activate()

		const rectangle = new this.scene.scope.Rectangle(from.subtract(0.5), to.add(0.5))
		this.marquee = new this.scene.scope.Path.Rectangle(rectangle)
		this.styleMarquee(this.marquee)

		this.scene.activeLayer.activate()
		return this.marquee.bounds
	}

	private styleMarquee(path: paper.Path): void {
		path.strokeColor = new this.scene.scope.Color(MARQUEE_STROKE)
		path.strokeWidth = 1
		path.dashArray = MARQUEE_DASH
	}

	removeMarquee(): void {
		this.marquee?.remove()
		this.marquee = null
	}

	private removeBounds(): void {
		this.bounds?.remove()
		this.bounds = null
	}

	// --- visibility ----------------------------------------------------------

	/**
	 * Takes the selection UI off screen without deselecting, so a page thumbnail
	 * can be captured without the dashed box in it.
	 */
	hideChrome(): void {
		if (!this.bounds) return

		this.bounds.opacity = 0
		if (this.type === 'push') this.layer.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
		this.setLayerOpacity(this.scene.activeLayer, 1)
		this.scene.redraw()
	}

	showChrome(): void {
		if (!this.bounds || this.isEmpty) return

		this.bounds.opacity = 1
		if (this.type === 'push') this.layer.strokeColor = new this.scene.scope.Color(HIGHLIGHT_COLOR)
		this.fadePage()
		this.scene.redraw()
	}

	fadePage(): void {
		this.setLayerOpacity(this.scene.activeLayer, FADED_OPACITY)
	}

	private setLayerOpacity(layer: paper.Layer, opacity: number): void {
		for (const child of layer.children) child.opacity = opacity
	}
}

/**
 * True when `point` is inside the box grown by `threshold` in each direction —
 * the ring you can grab to rotate.
 */
function isWithinOuterRadius(item: paper.Item, point: paper.Point, threshold: number): boolean {
	const outer = item.bounds.expand(threshold)
	return outer.contains(point)
}

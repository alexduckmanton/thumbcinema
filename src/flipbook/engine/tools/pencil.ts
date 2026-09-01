import { FLATTEN_DISTANCE, PENCIL_COLOR } from '../constants'
import { resamplePolyline } from '../geometry'
import type { Scene } from './../scene'
import type { Selection } from './../selection'
import type { ModalTool } from './types'

/**
 * The width of every stroke this tool draws, and now the only one.
 *
 * It used to be one of ten, set from a popover hanging off the pencil in the tray —
 * three divs in 2013, a real slider here. That control is gone at every width. On a
 * phone there was never room for it; on a desktop it was a settings panel for a
 * drawing tool whose whole proposition is that you pick it up and draw, and in ten
 * years of the original nobody has ever asked for a thicker line. What it leaves is
 * the width the tool always started on.
 */
export const DEFAULT_PENCIL_WIDTH = 3

/**
 * How long the dot a tap leaves actually is, and why it isn't nothing.
 *
 * A dot wants to be a subpath of zero length with a round cap, which is a circle a
 * stroke-width across — and that is what SVG paints. **A canvas does not, in Safari.**
 * Measured in WebKit 26 and Chromium 141 side by side, the same three shapes on both:
 *
 *                       canvas   SVG
 *   `M20,30v0`          0 / 14   12 / 10     ← WebKit paints no pixels at all
 *   `M60,30l0.01,0`    14 / 14   10 / 10
 *   `M100,30l10,0`     54 / 54   50 / 50     ← a real line, as a control
 *
 * The canvas is not the fallback here, it is the tool: paper strokes to one, and so
 * does the gallery's preview. So a dot written the tidy way is on the page, in the
 * file and in the GIF, and invisible to everyone drawing on an iPhone — which is most
 * of who draws on this.
 *
 * A hair of length is not a special case anywhere, needs nothing to know about it and
 * paints the same disc in both engines. A hundredth of a unit is four decimal places
 * inside what `getPathData` writes and three below anything a pinched page can show:
 * at the 4x the stage reaches, a phone renders it 0.006 CSS pixels long.
 */
const DOT_LENGTH = 0.01

export interface PencilOptions {
	/**
	 * Off for the pencil that redraws 2012 flipbooks on the playback page: it isn't a
	 * tool anyone is holding, so it mustn't be listening for the pointer.
	 */
	interactive?: boolean
	/** Only the playback page passes one: 2012 artwork was drawn at 2. */
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
	private readonly strokeWidth: number

	constructor(scene: Scene, selection: Selection, options: PencilOptions = {}) {
		this.scene = scene
		this.selection = selection
		this.interactive = options.interactive ?? true
		this.strokeWidth = options.width ?? DEFAULT_PENCIL_WIDTH

		this.tool = new scene.scope.Tool()

		if (this.interactive) {
			// The down point is put in here rather than waited for: paper's first
			// `onMouseDrag` is the first *movement*, so a stroke that began on it started
			// a pointer-event's travel away from where the pointer actually went down —
			// about 7px on a phone at a normal drawing speed — and a press that never
			// moved began nowhere at all. `FlipbookEngine.toolDown` has always done the
			// same for the gestures paper doesn't see.
			this.tool.onMouseDown = (event: paper.ToolEvent) => this.begin(event.point)
			this.tool.onMouseDrag = (event: paper.ToolEvent) => this.extend(event.point)
			this.tool.onMouseUp = () => this.end()
		}
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

	/**
	 * Starts a stroke, at `point` when there is one.
	 *
	 * There isn't when a 2012 flipbook is being replayed: that arrives as whole
	 * strokes and is fed in through `extend`, a point at a time, with nowhere for a
	 * down point to come from.
	 */
	begin(point?: paper.Point): void {
		this.path = new this.scene.scope.Path()
		this.path.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
		this.path.strokeWidth = this.strokeWidth
		this.path.strokeJoin = 'round'
		this.path.strokeCap = 'round'

		if (point) this.path.add(point)
	}

	extend(point: paper.Point): void {
		this.path?.add(point)
	}

	/**
	 * A tap that never moved is a dot.
	 *
	 * A path of one point is nothing at all — neither SVG nor a canvas strokes a lone
	 * `moveto` — so the point is laid down a second time, `DOT_LENGTH` away, and the
	 * round caps at the two ends of that hair are the dot. See `DOT_LENGTH` for why it
	 * is a hair rather than the same point twice, which is the tidier shape and is
	 * invisible on an iPhone.
	 *
	 * It used to be dropped, which is the 2013 behaviour and was wrong there too: a
	 * mark you made and watched not appear reads as the tool having missed you. Dots
	 * are also most of the difference between a face and a face with eyes.
	 *
	 * Nothing downstream needed telling. `resamplePolyline` puts its samples on the
	 * line it was given, and one step is the whole of this one, so `finish` hands back
	 * the same two points; the eraser has always removed a two-point path whole; and
	 * the GIF's rasteriser measures a segment by the distance to it, which for one this
	 * short is a disc in every direction.
	 */
	end(): void {
		const path = this.path
		this.path = null
		if (!path) return

		if (path.segments.length === 0) {
			path.remove()
			return
		}

		if (path.segments.length === 1) {
			path.add(path.segments[0]!.point.add(new this.scene.scope.Point(DOT_LENGTH, 0)))
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

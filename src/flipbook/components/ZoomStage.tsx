import { useEffect, useRef, useState } from 'react'

import { canvasExtent, canvasOrigin, DEFAULT_PAGE_SIZE, type PageSize } from '../engine/constants'
import type { FlipbookEngine } from '../engine/FlipbookEngine'
import { fittedSize, type TracePhoto } from '../engine/trace'
import type { ModalToolId } from '../engine/tools/types'
import type { PointerLayer } from '../pointer'
import { useCursor } from '../usePointerLayer'
import { clearStage, measureStage, setStageElement, useStage, type Viewport } from '../zoomStage'
import { DrawnCursor } from './InkCursor'
import styles from './ZoomStage.module.css'

export interface ZoomStageProps {
	layer: PointerLayer | null
	/** Asked to bring the canvas up to date before its pixels are read. See `paint`. */
	engine: FlipbookEngine | null
	/** The drawing itself, which this is a magnified copy of. */
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Null while a page animation holds the tools. */
	tool: ModalToolId | null
	/**
	 * The photograph this page is being traced over, if there is one and the paper is
	 * showing it. Null is "draw nothing", which covers no photo, a flipbook still
	 * arriving and a flipbook playing — the same condition the paper's own layer is
	 * rendered under, handed down rather than worked out again.
	 */
	photo: TracePhoto | null
	/** True while it is being placed, which is the one thing that changes how it looks. */
	placing: boolean
	/**
	 * Where this stage is standing, which is the whole difference between v11 and v12.
	 *
	 * `band` is v11's: the leftover under the tools, with the paper above it showing the
	 * whole page and an outline saying which part this is. `paper` is v12's: the stage
	 * *is* the drawing, in the place the drawing has always been, with the live canvas
	 * hidden underneath it and no overview anywhere.
	 */
	surface: 'band' | 'paper'
	/** How far in it starts, which differs between the two. See `startingZoom`. */
	startZoom: number
	/**
	 * Shows the whole page and leaves the photograph to the DOM layer over the paper.
	 *
	 * v12 only, and only while a trace photo is being placed. Up there the stage and the
	 * placing layer are the same box, and the placing layer's gestures are stated in the
	 * paper's own pixels — so a stage showing a magnified window underneath it would have
	 * the photo moving at one rate and the drawing at another. Standing the window back at
	 * 1× for the length of the placement makes the two agree without either of them
	 * knowing about the other. The zoom is not *lost*: the window is drawn differently for
	 * a moment, and the stored one comes back the instant the photo settles.
	 */
	suspended?: boolean
}

/**
 * v11's second canvas: the part of the page inside the outline, at two to four times
 * life size, and the surface you actually draw on.
 *
 * **It is a copy, not a second drawing.** There is one paper.js project and one canvas it
 * renders into; this reads pixels out of that canvas with a single `drawImage` per frame,
 * the way the loupe already does, and hands a finger's position back through the same
 * window the other way. So there is nothing here for the save path or the history to know
 * about — an intercepted gesture that arrives from down here is the same gesture and one
 * history step, and the artwork is still its own size whatever this is showing.
 *
 * Copying rather than re-rendering is also what keeps it honest: what you see is the live
 * canvas, so the stroke in progress, the onion skin and a selected stroke's blue are all
 * in it without this file knowing any of them exist. What it costs is sharpness at the
 * far end of the zoom — the source is the paper's backing store, which is 640 units
 * across at the device's pixel ratio, so at 4× the copy is magnifying about 2:1. On the
 * phone this mode is for, that is a soft edge on a hand-drawn line rather than anything
 * you would call blurry.
 *
 * **The size is measured, not stated**, and that is what the whole mode is arranged
 * around. This takes the band the column has left over once the paper and the page bar
 * have taken theirs, so its shape is whatever the window leaves it —
 * and the outline on the paper takes its aspect ratio from here rather than the other way
 * round. Below `MIN_STAGE_HEIGHT`, or on a layout where the stylesheet hides this
 * outright, `measureStage` reports no stage at all and v11 falls back to v2.
 */
export function ZoomStage({
	layer,
	engine,
	canvasRef,
	tool,
	photo,
	placing,
	surface,
	startZoom,
	suspended = false,
}: ZoomStageProps) {
	const host = useRef<HTMLDivElement | null>(null)
	const canvas = useRef<HTMLCanvasElement | null>(null)
	const { view } = useStage()
	const cursor = useCursor(layer)

	// The backing store, in device pixels, kept in state so React writes the attributes
	// only when they change. Never assigned from a ref callback: writing `width` clears
	// the bitmap, and a ref runs at moments that have nothing to do with the size.
	const [store, setStore] = useState({ width: 0, height: 0 })

	/*
	 * One observer for the life of the mode, and it is the only thing that says how big
	 * the stage is. The content box rather than `getBoundingClientRect`: a rectangle reports
	 * whatever transform is mid-flight, and a layout box doesn't — which matters because the
	 * drawing above is transformed for the whole of a reorder.
	 */
	// Read at measuring time rather than closed over: the effect runs once and the mode
	// can only change by unmounting this, but a value read through a ref cannot go stale.
	const zoom = useRef(startZoom)
	zoom.current = startZoom

	useEffect(() => {
		const element = host.current
		if (!element) return

		setStageElement(element)

		const read = () => {
			const width = element.clientWidth
			const height = element.clientHeight
			measureStage({ width, height }, live.current?.page ?? DEFAULT_PAGE_SIZE, zoom.current)

			const dpr = Math.min(window.devicePixelRatio || 1, 3)
			const next = { width: Math.round(width * dpr), height: Math.round(height * dpr) }
			// Guarded, because this is a React render and a render is a layout: an
			// unconditional write here is a `ResizeObserver` that notifies itself for ever.
			setStore((current) =>
				current.width === next.width && current.height === next.height ? current : next,
			)
		}

		read()

		/*
		 * Deferred by a frame, which is the second half of not looping.
		 *
		 * A callback that measures and then writes is doing both inside the browser's own
		 * observation step, and Chrome reports the leftover as
		 * `ResizeObserver loop completed with undelivered notifications` — an `error` event
		 * with no exception behind it, which is harmless everywhere except this page, where
		 * `useCrashRecovery` listens for exactly that and puts up the red screen. Reading on
		 * the next frame takes the write out of the step that caused it.
		 */
		let frame = 0
		const observer =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(() => {
						cancelAnimationFrame(frame)
						frame = requestAnimationFrame(read)
					})
		observer?.observe(element)

		return () => {
			cancelAnimationFrame(frame)
			observer?.disconnect()
			setStageElement(null)
			// The mode is off, or the page has gone. Either way there is no stage now, and
			// `PointerLayer` reads exactly that to decide whether v11 is v11.
			clearStage()
		}
	}, [])

	/*
	 * The photograph, as something `drawImage` will take.
	 *
	 * A second `Image` on the same object URL as the one `TraceLayer` renders, rather than
	 * reaching across the tree for its `<img>`: the URL is already in memory, so the
	 * browser serves this out of its cache and decodes once. Rebuilt only when the *url*
	 * changes — a placement changes sixty times a second during a pinch and none of those
	 * is a different picture.
	 */
	const picture = useRef<HTMLImageElement | null>(null)
	const url = photo?.url ?? null

	useEffect(() => {
		if (!url) {
			picture.current = null
			return
		}

		const image = new Image()
		image.src = url
		picture.current = image

		return () => {
			picture.current = null
		}
	}, [url])

	// The page's own size, read at draw time rather than closed over for the same reason
	// the engine is: a remix resizes the scene when its artwork lands, and a frame loop
	// built before that would go on scaling against the shape it opened at.
	const page = useRef<PageSize>(engine?.page ?? DEFAULT_PAGE_SIZE)
	page.current = engine?.page ?? page.current

	// Read by the frame loop rather than closed over, so a pinch — which changes this
	// sixty times a second — doesn't tear down and rebuild the loop on every frame of
	// itself. Same bargain `InkCursor` makes with the pointer.
	const showing = useRef(view)
	showing.current =
		suspended && view ? { x: 0, y: 0, w: page.current.width, h: page.current.height } : view

	const live = useRef(engine)
	live.current = engine

	// And the same for the photo's placement, for exactly the same reason: a drag on the
	// paper writes it straight onto the DOM without going through React, and the stage has
	// to follow that at the same rate.
	const trace = useRef<{ photo: TracePhoto; placing: boolean } | null>(null)
	trace.current = photo && !suspended ? { photo, placing } : null

	/*
	 * One frame of the copy, every frame.
	 *
	 * Unconditionally rather than while a finger is down, because most of what changes
	 * down here is not the pointer: turning a page, undoing, and playback all redraw the
	 * paper, and a stage that only repainted while it was being drawn on would sit
	 * showing the page before last. It is one `drawImage` of a few hundred square pixels.
	 */
	useEffect(() => {
		if (store.width === 0 || store.height === 0) return

		let frame = 0
		const draw = () => {
			// Bring the canvas up to date *first*: this is a reader of its pixels, and
			// paper schedules its own redraw rather than doing it where the change was
			// made. See `FlipbookEngine.redraw`.
			live.current?.redraw()

			paint(canvas.current, canvasRef.current, showing.current, page.current, {
				picture: picture.current,
				...trace.current,
			})
			frame = requestAnimationFrame(draw)
		}
		draw()

		return () => cancelAnimationFrame(frame)
	}, [canvasRef, store.width, store.height])

	return (
		<div className={surface === 'paper' ? styles.onPaper : styles.stage} ref={host}>
			{view ? (
				<canvas ref={canvas} className={styles.canvas} width={store.width} height={store.height} />
			) : null}

			{/* The same ring and the same four shapes the paper draws, told how many
			    project units across this box is so the ring is the size of the mark it is
			    actually about to make. */}
			{view && cursor?.surface === 'stage' ? (
				<DrawnCursor at={cursor} tool={tool} span={view.w} />
			) : null}
		</div>
	)
}

/**
 * One frame: the paper, and the window of it this stage is showing.
 *
 * Three coordinate spaces again, and the middle one is the one to keep hold of. The
 * viewport is in *project* units, of which the page has 640 across however wide anything
 * is drawn; the source canvas's backing store is some whole multiple of that, which is
 * what `drawImage` has to be told to read from; and the destination is this canvas's own
 * backing store, which it fills exactly.
 */
function paint(
	stage: HTMLCanvasElement | null,
	source: HTMLCanvasElement | null,
	view: Viewport | null,
	page: PageSize,
	trace: Trace,
): void {
	if (!stage || !source || !view || source.width === 0) return

	const context = stage.getContext('2d')
	if (!context) return

	// A flipbook is ink on paper, and paper draws onto a transparent canvas with the
	// white coming from CSS underneath it — so the copy has to bring its own.
	context.fillStyle = '#fff'
	context.fillRect(0, 0, stage.width, stage.height)

	// The source holds the whole drawable canvas, not the page — so its density is the
	// canvas's, and its pixel (0,0) is `canvasOrigin` rather than the page's corner. The
	// page keeps the artwork's own origin, which puts the surround at negative
	// coordinates; the subtraction here is the only place that has to know it.
	const canvas = canvasExtent(page)
	const origin = canvasOrigin(page)
	const density = source.width / canvas.width

	context.drawImage(
		source,
		(view.x - origin.x) * density,
		(view.y - origin.y) * density,
		view.w * density,
		view.h * density,
		0,
		0,
		stage.width,
		stage.height,
	)

	paintTrace(context, stage, view, page, trace)
}

/**
 * The photograph being traced over, in the stage, at the size and place the paper has it.
 *
 * **Drawn here rather than laid over the canvas in the DOM**, which is how the paper does
 * it. Up there the picture is a sibling of the canvas with `mix-blend-mode: multiply`, and
 * it can be, because the paper is the whole page and the layer can simply cover it. Down
 * here the stage is a *window* on the page: the photo has to be transformed by the same
 * placement and then by the window, and only the part inside the window drawn. A DOM layer
 * would need every one of those numbers anyway, and would then be a second thing that
 * could disagree with the copy underneath it about where the page is.
 *
 * The transform chain is the paper's, in the paper's own units, read from the outside in:
 * the window maps project units onto this canvas, the placement is
 * `translate(t) rotate(θ) scale(s)` about the frame's centre — which is exactly what
 * `.plate` does and what `pinched` solves against — and the picture is drawn centred at
 * `fittedSize`, which is the one expression both surfaces size it from.
 *
 * `multiply` at the layer's own opacity, which is the same arithmetic CSS does: a
 * separable blend mode composited with source alpha is `(1−α)·dst + α·blend(src, dst)`,
 * whichever of the two applies it. Over white paper that is the photo washed out to a
 * third; over a black stroke it is black however bright the photo is — which is the whole
 * reason the paper blends rather than fades, and it has to hold down here or the stage
 * would be showing a lighter drawing than the one being made.
 */
function paintTrace(
	context: CanvasRenderingContext2D,
	stage: HTMLCanvasElement,
	view: Viewport,
	page: PageSize,
	{ picture, photo, placing }: Trace,
): void {
	if (!picture || !photo || !picture.complete || picture.naturalWidth === 0) return

	// Backing-store pixels per project unit. Both axes, because rounding the canvas to
	// whole device pixels leaves the two a hair apart and a photo drawn at the mean of
	// them would sit a fraction off the ink it is under.
	const kx = stage.width / view.w
	const ky = stage.height / view.h

	const fit = fittedSize(photo, page)
	const width = fit.width * page.width
	const height = fit.height * page.height
	const at = photo.placement

	context.save()

	context.scale(kx, ky)
	context.translate(-view.x, -view.y)

	// The paper's own layer is `overflow: hidden` on the sheet — a photo dragged off the
	// side leaves at the edge of the page rather than out across it — and the stage has to
	// clip in the same place or a window at the edge of the page would show picture where
	// the paper shows none.
	context.beginPath()
	context.rect(0, 0, page.width, page.height)
	context.clip()

	context.translate(page.width / 2 + at.x * page.width, page.height / 2 + at.y * page.height)
	context.rotate((at.rotation * Math.PI) / 180)
	context.scale(at.scale, at.scale)

	context.globalCompositeOperation = 'multiply'
	// Stronger while it is being placed, exactly as the paper's is: a third is what you
	// draw against and is not what you line a photograph up by.
	context.globalAlpha = placing ? PLACING_OPACITY : TRACE_OPACITY
	context.drawImage(picture, -width / 2, -height / 2, width, height)

	context.restore()
}

interface Trace {
	/** The decoded picture, or null when there is nothing to draw. */
	picture?: HTMLImageElement | null
	photo?: TracePhoto
	placing?: boolean
}

/**
 * The two opacities the paper uses, restated here because a canvas cannot read a
 * stylesheet.
 *
 * The one place in this feature where a number is written down twice — `.frame` and
 * `.placing` in `TraceLayer.module.css` are the other copy. Kept as named constants next
 * to the code that needs them rather than threaded through as props, and worth a glance if
 * either of those rules is ever retuned.
 */
const TRACE_OPACITY = 0.3
const PLACING_OPACITY = 0.55

/**
 * The outline on the paper: which part of the page the stage is showing.
 *
 * Deliberately an outline and nothing else — not a magnifier, not a dimmed surround, not
 * a handle at each corner. The paper is still the drawing and still has to be readable as
 * one; a scrim over the four fifths of it that aren't in the window would make the page
 * about the window instead. What makes it findable is that it is the only straight-edged
 * rectangle on a sheet of hand-drawn lines.
 *
 * Two hairlines rather than one, white behind ink: the outline crosses the drawing by
 * definition, and a single dark line is invisible wherever it runs along a stroke.
 *
 * The outline itself takes no presses: what does is the transparent sheet it is drawn on,
 * which covers the whole of the paper. That is the forgiving reading — a press anywhere
 * up there takes hold of the window, rather than asking anybody to hit a rectangle the
 * size of a postage stamp — and it is also what keeps paper.js out of a canvas that is no
 * longer somewhere you draw: paper binds its own listeners to that element, and a sheet
 * over the top of it is the one thing that stops them being reached. See
 * `PointerLayer.zoomTouchStart`.
 */
export function ZoomWindow({ page = DEFAULT_PAGE_SIZE }: { page?: PageSize }) {
	const { view } = useStage()
	if (!view) return null

	return (
		<div className={styles.overview} aria-hidden="true">
			<div
				className={styles.window}
				style={{
					left: `${(view.x / page.width) * 100}%`,
					top: `${(view.y / page.height) * 100}%`,
					width: `${(view.w / page.width) * 100}%`,
					height: `${(view.h / page.height) * 100}%`,
				}}
			/>
		</div>
	)
}

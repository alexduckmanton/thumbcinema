import { useEffect, useRef, useState } from 'react'

import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../engine/constants'
import type { ModalToolId } from '../engine/tools/types'
import type { PointerLayer } from '../pointer'
import { useCursor } from '../usePointerLayer'
import { clearStage, measureStage, setStageElement, useStage, type Viewport } from '../zoomStage'
import { DrawnCursor } from './InkCursor'
import styles from './ZoomStage.module.css'

export interface ZoomStageProps {
	layer: PointerLayer | null
	/** The drawing itself, which this is a magnified copy of. */
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Null while a page animation holds the tools. */
	tool: ModalToolId | null
}

/**
 * v11's second canvas: the part of the page inside the outline, at two to four times
 * life size, and the surface you actually draw on.
 *
 * **It is a copy, not a second drawing.** There is one paper.js project and one canvas it
 * renders into; this reads pixels out of that canvas with a single `drawImage` per frame,
 * the way the loupe already does, and hands a finger's position back through the same
 * window the other way. So there is nothing here for the save path, the history or the
 * page strip to know about — an intercepted gesture that arrives from down here is the
 * same gesture, one history step, one thumbnail, and the artwork is still 640×360
 * whatever this is showing.
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
 * around. This takes the band the column has left over once the strip, the paper, the
 * page bar and the tray have taken theirs, so its shape is whatever the phone leaves it —
 * and the outline on the paper takes its aspect ratio from here rather than the other way
 * round. Below `MIN_STAGE_HEIGHT`, or on a layout where the stylesheet hides this
 * outright, `measureStage` reports no stage at all and v11 falls back to v2.
 */
export function ZoomStage({ layer, canvasRef, tool }: ZoomStageProps) {
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
	 * the stage is. The content box rather than `getBoundingClientRect`, for the reason
	 * the page strip gives: a rectangle reports whatever transform is mid-flight, and a
	 * layout box doesn't.
	 */
	useEffect(() => {
		const element = host.current
		if (!element) return

		setStageElement(element)

		const read = () => {
			const width = element.clientWidth
			const height = element.clientHeight
			measureStage({ width, height })

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

	// Read by the frame loop rather than closed over, so a pinch — which changes this
	// sixty times a second — doesn't tear down and rebuild the loop on every frame of
	// itself. Same bargain `InkCursor` makes with the pointer.
	const showing = useRef(view)
	showing.current = view

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
			paint(canvas.current, canvasRef.current, showing.current)
			frame = requestAnimationFrame(draw)
		}
		draw()

		return () => cancelAnimationFrame(frame)
	}, [canvasRef, store.width, store.height])

	return (
		<div className={styles.stage} ref={host}>
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
): void {
	if (!stage || !source || !view || source.width === 0) return

	const context = stage.getContext('2d')
	if (!context) return

	// A flipbook is ink on paper, and paper draws onto a transparent canvas with the
	// white coming from CSS underneath it — so the copy has to bring its own.
	context.fillStyle = '#fff'
	context.fillRect(0, 0, stage.width, stage.height)

	const density = source.width / CANVAS_WIDTH

	context.drawImage(
		source,
		view.x * density,
		view.y * density,
		view.w * density,
		view.h * density,
		0,
		0,
		stage.width,
		stage.height,
	)
}

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
export function ZoomWindow() {
	const { view } = useStage()
	if (!view) return null

	return (
		<div className={styles.overview} aria-hidden="true">
			<div
				className={styles.window}
				style={{
					left: `${(view.x / CANVAS_WIDTH) * 100}%`,
					top: `${(view.y / CANVAS_HEIGHT) * 100}%`,
					width: `${(view.w / CANVAS_WIDTH) * 100}%`,
					height: `${(view.h / CANVAS_HEIGHT) * 100}%`,
				}}
			/>
		</div>
	)
}

import { useCallback, useEffect, useRef, useState } from 'react'

import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../engine/constants'
import type { FlipbookEngine } from '../engine/FlipbookEngine'
import type { PageState } from '../engine/pages'
import styles from './PageStrip.module.css'

export interface PageStripProps {
	engine: FlipbookEngine
	pages: PageState[]
	activePage: number
	playing: boolean
	/** True while a page is still on its way into the canvas's slot. */
	arriving: boolean
	/** The live canvas, which the strip aligns the active page underneath. */
	canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export function PageStrip({
	engine,
	pages,
	activePage,
	playing,
	arriving,
	canvasRef,
}: PageStripProps) {
	const container = useRef<HTMLDivElement | null>(null)
	const firstPage = useRef<HTMLDivElement | null>(null)
	const [metrics, setMetrics] = useState({ offset: 0, width: CANVAS_WIDTH, gutter: 0 })

	/*
	 * Three numbers, all read off what the browser actually laid out.
	 *
	 * `offset` is where the live canvas sits relative to this container, and `width` is
	 * how wide it is — which is 640 on a desktop and whatever the window could spare on
	 * a phone, because the thumbnails are copies of the drawing and have to be exactly
	 * the size of it to stand behind it. `gutter` is the page's own padding, taken from
	 * the stylesheet rather than agreed with it, so the gap between pages can differ by
	 * layout without this file knowing that layouts exist.
	 */
	const measure = useCallback(() => {
		const canvas = canvasRef.current
		const box = container.current
		const page = firstPage.current
		if (!canvas || !box || !page) return

		setMetrics({
			offset: canvas.getBoundingClientRect().left - box.getBoundingClientRect().left,
			width: canvas.offsetWidth,
			gutter: Number.parseFloat(getComputedStyle(page).paddingLeft) || 0,
		})
	}, [canvasRef])

	/*
	 * Both, because they answer different halves of it.
	 *
	 * The canvas changes width when the window does, but it also changes width when
	 * nothing fires a resize at all — `--book-width` is drawn off `100dvh`, and on a
	 * phone that moves as the browser's own chrome slides in and out. And the window
	 * changes the canvas's *position* without changing its size at all, which is every
	 * desktop window: the drawing stays 640 and the column re-centres under it.
	 */
	useEffect(() => {
		measure()
		window.addEventListener('resize', measure)

		const canvas = canvasRef.current
		const observer =
			canvas && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
		observer?.observe(canvas as Element)

		return () => {
			window.removeEventListener('resize', measure)
			observer?.disconnect()
		}
	}, [measure, canvasRef])

	/** One page to the next: the drawing's width plus a gutter either side. */
	const step = metrics.width + metrics.gutter * 2

	// The engine throws pages from one slot to the next and needs to know how far that
	// is. It can't be told at build time for the same reason it isn't measured there.
	useEffect(() => {
		engine.setPageStep(step)
	}, [engine, step])

	const left = metrics.offset - metrics.gutter - activePage * step
	const snap = useSnapOnRemoval(pages.length)

	// Which thumbnail the canvas is standing in front of, and so which one to hide.
	// Nothing, while a page is still travelling into that slot.
	const covered = arriving ? -1 : activePage

	return (
		<div className={styles.container} ref={container} aria-hidden="true">
			<div
				className={playing ? `${styles.strip} ${styles.playing}` : styles.strip}
				style={
					{
						left: `${left}px`,
						transitionDuration: snap ? '0s' : undefined,
						// How wide a page is drawn. The stylesheet adds its own gutters to it
						// and this file reads those back, so neither has to state the other's
						// number. See `measure`.
						'--page-width': `${metrics.width}px`,
					} as React.CSSProperties
				}
			>
				{pages.map((page, index) => (
					// The whole strip is `aria-hidden`: these are decorative copies of the
					// canvas rather than controls. Clicking one is a pointer shortcut for the
					// arrow keys, which are the keyboard route and are bound on the document.
					// A tab stop per page would be noise rather than access.
					// biome-ignore lint/a11y/noStaticElementInteractions: decorative, aria-hidden.
					// biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys are the keyboard route.
					<div
						key={page.id}
						ref={index === 0 ? firstPage : null}
						className={index === covered ? `${styles.page} ${styles.covered}` : styles.page}
						onClick={() => engine.goToPage(index)}
					>
						{/* Sized here rather than by the engine: assigning `width` clears a
						    canvas, and a ref callback runs again on every render. */}
						<canvas
							width={CANVAS_WIDTH}
							height={CANVAS_HEIGHT}
							ref={(element) => engine.registerThumbnail(page.id, element)}
						/>
					</div>
				))}
			</div>
		</div>
	)
}

/**
 * True for the one render in which a page has just left the strip.
 *
 * A deleted page takes every page after it one step to the left, and at that same
 * moment the strip's own `left` moves one step to the right to compensate. The
 * reflow is instant and the transition is not, so left to itself the strip jumps a
 * page and then glides back over 0.3s. Killing the transition for that render lands
 * both together — which is what 2013 did by zeroing `#pages`' transition-duration
 * and putting it back a tick later.
 *
 * Set during render rather than in an effect: React re-renders immediately without
 * painting the discarded one, so the transition is never briefly live.
 */
function useSnapOnRemoval(count: number): boolean {
	const [previous, setPrevious] = useState(count)
	const [snap, setSnap] = useState(false)

	if (previous !== count) {
		setPrevious(count)
		setSnap(count < previous)
	}

	useEffect(() => {
		if (!snap) return

		const frame = requestAnimationFrame(() => setSnap(false))
		return () => cancelAnimationFrame(frame)
	}, [snap])

	return snap
}

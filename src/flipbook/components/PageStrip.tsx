import { useCallback, useEffect, useRef, useState } from 'react'

import { PAGE_TRAVEL_MS } from '../engine/animations'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../engine/constants'
import type { FlipbookEngine } from '../engine/FlipbookEngine'
import type { PageState } from '../engine/pages'
import { type Reorder, SETTLE_MS } from '../engine/reorder'
import styles from './PageStrip.module.css'

export interface PageStripProps {
	engine: FlipbookEngine
	pages: PageState[]
	activePage: number
	playing: boolean
	/** True while a page is still on its way into the canvas's slot. */
	arriving: boolean
	/**
	 * True for the length of a page animation, and what makes the row slide with it.
	 *
	 * Adding or deleting a page moves every page ahead of the gap along by a slot, and
	 * the row is the only thing carrying those — the keyframes animate the page being
	 * thrown and the one taking its place, and nothing else. See `.throwing`.
	 */
	throwing: boolean
	/** The live canvas, which the strip aligns the active page underneath. */
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Where a page is being carried, if one is. See `usePageReorder`. */
	reorder?: Reorder | null
	/** How far page `index` stands from its own slot while that is going on. */
	shiftFor?: (index: number) => number
}

export function PageStrip({
	engine,
	pages,
	activePage,
	playing,
	arriving,
	throwing,
	canvasRef,
	reorder = null,
	shiftFor,
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

	/*
	 * Which slot the row is lined up on, which is normally the page you are drawing on.
	 *
	 * While a page is being carried it is the gesture's, and it is what that gesture
	 * moves: it starts at the slot the page came out of, so the pages either side can
	 * step aside without the whole flipbook moving with them; it advances a page at a
	 * time while the page is held out to one side, which is the book running underneath
	 * it; and it arrives at the destination at the moment the page is let go — which,
	 * against the drawing sliding back to the middle of the column by exactly the same
	 * distance, is the flipbook closing up round the page as one movement. See
	 * `usePageReorder`, which is where the arithmetic of all three is written out.
	 */
	const anchor = reorder ? reorder.anchor : activePage
	const left = metrics.offset - metrics.gutter - anchor * step

	// Which thumbnail the canvas is standing in front of, and so which one to hide.
	// Nothing, while a page is still travelling into that slot.
	const covered = arriving ? -1 : activePage

	return (
		<div className={styles.container} ref={container} aria-hidden="true">
			<div
				className={[
					styles.strip,
					playing ? styles.playing : '',
					throwing ? styles.throwing : '',
					reorder ? styles.carrying : '',
					reorder?.slide ? styles.sliding : '',
				]
					.filter(Boolean)
					.join(' ')}
				style={
					{
						left: `${left}px`,
						// Only ever set while a page is in hand, which is what keeps the frame
						// that hands the flipbook back from animating: the class and the
						// transforms go in the same render, and a rule that isn't there can't
						// ease a transform away to nothing. Turning a page is still a cut.
						'--settle': `${SETTLE_MS}ms`,
						// How long one page of the run takes, which is also how long until the
						// next one starts. See `.sliding`.
						'--slide': `${reorder?.slide ?? 0}ms`,
						// And how long a thrown page takes to reach the next slot, which is
						// how long the row has to get there with it. See `.throwing`.
						'--throw': `${PAGE_TRAVEL_MS}ms`,
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
						// How far out of its own slot this page has to stand to leave room for
						// the one being carried. Zero, and unset, the rest of the time.
						style={{ '--shift': `${shiftFor?.(index) ?? 0}px` } as React.CSSProperties}
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

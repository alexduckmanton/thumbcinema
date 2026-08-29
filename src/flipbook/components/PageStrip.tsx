import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { PAGE_TRAVEL_MS } from '../engine/animations'

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
	const pageSize = engine.page
	const [metrics, setMetrics] = useState({ offset: 0, width: pageSize.width, gutter: 0 })
	const scale = useThumbnailScale(engine, pages.length)

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
						    canvas, so the size has to be something React owns and writes only
						    when it has actually changed. See `useThumbnailScale` for the two
						    values it takes and what has to happen when it goes from one to the
						    other. */}
						<canvas
							width={Math.round(pageSize.width * scale)}
							height={Math.round(pageSize.height * scale)}
							ref={(element) => engine.registerThumbnail(page.id, element)}
						/>
					</div>
				))}
			</div>
		</div>
	)
}

/**
 * How many device pixels a thumbnail carries per project unit.
 *
 * The drawing canvas is 640×360 project units drawn into a backing store the device
 * pixel ratio times that — paper sizes it, and on a retina screen it is 1280×720. A
 * thumbnail is a copy of that canvas shown at exactly the same size, so a 640×360 one
 * holds a quarter of the pixels it is displayed with, and the pages either side of the
 * drawing came out visibly softer than the drawing between them. Which they must not
 * be: the strip is the same flipbook seen again, and a page animation hands the
 * canvas's own job to one of these for 750ms.
 *
 * Capped at 2, because there is nothing above it worth another doubling of the memory:
 * a third of a device pixel is not something anyone can see, and the screens that
 * report 3 are the phones, where a thumbnail is displayed at about half its width.
 *
 * Read once. paper reads the ratio once as well, when it sets the view up, so a window
 * dragged onto a different monitor changes neither.
 */
const THUMBNAIL_SCALE = Math.min(
	typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
	2,
)

/**
 * How long a flipbook may be before its thumbnails go back to 1:1 — 50 pages at 2×.
 *
 * A page is ~900 KB of backing store at 1× and four times that at 2×, and the strip
 * holds one per page whether or not it is anywhere near the screen. Two hundred pages
 * is what an archive flipbook can be, and opening one of those in the *drawing tool*
 * became possible the day Remix did: 184 MB of canvas, which is heavy and survivable,
 * against 737 MB, which is not. iOS in particular enforces a per-tab canvas budget by
 * blanking canvases, so overrunning it doesn't fail loudly — it takes the strip away.
 *
 * So the ceiling is the one the strip already lived under, as many bytes as two hundred
 * pages at 1:1, and what gives way is the scale. A flipbook long enough to reach it is
 * one whose neighbouring pages are a thumbnail's worth of information anyway.
 */
const HIDPI_PAGE_LIMIT = Math.floor(200 / (THUMBNAIL_SCALE * THUMBNAIL_SCALE))

/**
 * The scale to draw thumbnails at, dropped to 1:1 once the flipbook is too long for it.
 *
 * It never goes back up, and that is deliberate rather than lazy: a canvas loses its
 * bitmap the moment either dimension is assigned, so every change of scale costs a
 * redraw of every page in the strip. Deleting back down to 49 pages to buy sharpness on
 * pages nobody is looking at is not a trade worth making twice.
 *
 * Which is what the layout effect is for, and why it is a layout effect. Resizing a
 * canvas empties it, and the strip's canvases are resized *in place* — the elements
 * don't change, so their ref callbacks never run again and the mechanism every other
 * page in this file leans on (owe it, pay on mount) never fires. So the engine is asked
 * to draw them outright, in the commit that resized them and before the browser has
 * painted it: an ordinary effect would put a frame of blank paper on the screen first.
 */
function useThumbnailScale(engine: FlipbookEngine, pages: number): number {
	const [scale, setScale] = useState(THUMBNAIL_SCALE)

	useEffect(() => {
		if (scale === 1 || pages <= HIDPI_PAGE_LIMIT) return
		setScale(1)
	}, [pages, scale])

	// biome-ignore lint/correctness/useExhaustiveDependencies: `scale` is the trigger rather than a value read here — a change of it is a row of canvases that have just been emptied.
	useLayoutEffect(() => {
		engine.redrawThumbnails()
	}, [engine, scale])

	return scale
}

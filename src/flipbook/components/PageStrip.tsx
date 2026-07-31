import { useCallback, useEffect, useRef, useState } from 'react'

import { CANVAS_HEIGHT, CANVAS_WIDTH, PAGE_MARGIN } from '../engine/constants'
import type { FlipbookEngine, PageState } from '../engine/FlipbookEngine'
import styles from './PageStrip.module.css'

/** One page's outer width: the canvas plus its gutters. Matches `.page` in the CSS. */
const PAGE_STEP = CANVAS_WIDTH + PAGE_MARGIN * 2

export interface PageStripProps {
	engine: FlipbookEngine
	pages: PageState[]
	activePage: number
	playing: boolean
	/** The live canvas, which the strip aligns the active page underneath. */
	canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export function PageStrip({ engine, pages, activePage, playing, canvasRef }: PageStripProps) {
	const container = useRef<HTMLDivElement | null>(null)
	const [canvasOffset, setCanvasOffset] = useState(0)

	// Where the live canvas sits relative to the strip's container. Measured rather
	// than assumed, because `.center` is a percentage width below 730px.
	const measure = useCallback(() => {
		const canvas = canvasRef.current
		const box = container.current
		if (!canvas || !box) return

		setCanvasOffset(canvas.getBoundingClientRect().left - box.getBoundingClientRect().left)
	}, [canvasRef])

	useEffect(() => {
		measure()
		window.addEventListener('resize', measure)
		return () => window.removeEventListener('resize', measure)
	}, [measure])

	const left = canvasOffset - PAGE_MARGIN - activePage * PAGE_STEP

	return (
		<div className={styles.container} ref={container} aria-hidden="true">
			<div
				className={playing ? `${styles.strip} ${styles.playing}` : styles.strip}
				style={{ left: `${left}px` }}
			>
				{pages.map((page, index) => (
					<div
						key={page.id}
						className={index === activePage ? `${styles.page} ${styles.active}` : styles.page}
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

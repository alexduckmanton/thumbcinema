import { useCallback, useEffect, useRef, useState } from 'react'

import { CANVAS_HEIGHT, CANVAS_WIDTH, PAGE_MARGIN } from '../engine/constants'
import type { FlipbookEngine } from '../engine/FlipbookEngine'
import type { PageState } from '../engine/pages'
import styles from './PageStrip.module.css'

/** One page's outer width: the canvas plus its gutters. Matches `.page` in the CSS. */
const PAGE_STEP = CANVAS_WIDTH + PAGE_MARGIN * 2

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

export function PageStrip({ engine, pages, activePage, playing, arriving, canvasRef }: PageStripProps) {
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
	const snap = useSnapOnRemoval(pages.length)

	// Which thumbnail the canvas is standing in front of, and so which one to hide.
	// Nothing, while a page is still travelling into that slot.
	const covered = arriving ? -1 : activePage

	return (
		<div className={styles.container} ref={container} aria-hidden="true">
			<div
				className={playing ? `${styles.strip} ${styles.playing}` : styles.strip}
				style={{ left: `${left}px`, transitionDuration: snap ? '0s' : undefined }}
			>
				{pages.map((page, index) => (
					<div
						key={page.id}
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

import { useCallback, useRef } from 'react'

import { MAX_PENCIL_WIDTH, MIN_PENCIL_WIDTH } from '../engine/tools/pencil'
import styles from './WidthSlider.module.css'

export interface WidthSliderProps {
	value: number
	onChange: (value: number) => void
}

export function WidthSlider({ value, onChange }: WidthSliderProps) {
	const track = useRef<HTMLDivElement | null>(null)

	const setFromPointer = useCallback(
		(clientY: number) => {
			const element = track.current
			if (!element) return

			const box = element.getBoundingClientRect()
			// The track runs bottom to top, matching the two dots stacked either end of
			// it — the big one is the one at the top. It used to lie down in a short
			// window, and asked its own box which way round it was; there is nowhere left
			// for it to do that, because a short window is a phone and it isn't shown
			// there at all.
			const fraction = (box.bottom - clientY) / box.height
			const span = MAX_PENCIL_WIDTH - MIN_PENCIL_WIDTH

			onChange(Math.round(MIN_PENCIL_WIDTH + span * Math.min(1, Math.max(0, fraction))))
		},
		[onChange],
	)

	// Pointer capture rather than document-level listeners: the drag follows the
	// pointer off the end of the track and releases cleanly wherever it ends up.
	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId)
		setFromPointer(event.clientY)
	}

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
		setFromPointer(event.clientY)
	}

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const step =
			event.key === 'ArrowLeft' || event.key === 'ArrowDown'
				? -1
				: event.key === 'ArrowRight' || event.key === 'ArrowUp'
					? 1
					: 0
		if (!step) return

		event.preventDefault()
		onChange(value + step)
	}

	const fraction = (value - MIN_PENCIL_WIDTH) / (MAX_PENCIL_WIDTH - MIN_PENCIL_WIDTH)

	return (
		<div className={styles.settings}>
			<div className={styles.slider}>
				<button
					type="button"
					className={`${styles.step} ${styles.smaller}`}
					disabled={value <= MIN_PENCIL_WIDTH}
					aria-label="Thinner"
					onClick={() => onChange(value - 1)}
				/>

				<div
					ref={track}
					className={styles.track}
					role="slider"
					tabIndex={0}
					aria-label="Pencil width"
					aria-orientation="vertical"
					aria-valuemin={MIN_PENCIL_WIDTH}
					aria-valuemax={MAX_PENCIL_WIDTH}
					aria-valuenow={value}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onKeyDown={handleKeyDown}
				>
					{/* The travel is the track less the handle's own width, so the far end
					    lines up with the far end of the track rather than hanging over it.
					    Which axis that plays out on is the stylesheet's business. */}
					<span
						className={styles.handle}
						style={{ '--fraction': fraction } as React.CSSProperties}
					/>
				</div>

				<button
					type="button"
					className={`${styles.step} ${styles.bigger}`}
					disabled={value >= MAX_PENCIL_WIDTH}
					aria-label="Thicker"
					onClick={() => onChange(value + 1)}
				/>
			</div>
		</div>
	)
}

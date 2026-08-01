import { useCallback, useRef } from 'react'

import { MAX_PENCIL_WIDTH, MIN_PENCIL_WIDTH } from '../engine/tools/pencil'
import styles from './WidthSlider.module.css'

export interface WidthSliderProps {
	value: number
	onChange: (value: number) => void
}

/** The handle's own width, which the travel has to account for. */
const HANDLE_WIDTH = 10

export function WidthSlider({ value, onChange }: WidthSliderProps) {
	const track = useRef<HTMLDivElement | null>(null)

	const setFromPointer = useCallback(
		(clientX: number) => {
			const element = track.current
			if (!element) return

			const box = element.getBoundingClientRect()
			const fraction = (clientX - box.left) / box.width
			const span = MAX_PENCIL_WIDTH - MIN_PENCIL_WIDTH

			onChange(Math.round(MIN_PENCIL_WIDTH + span * Math.min(1, Math.max(0, fraction))))
		},
		[onChange],
	)

	// Pointer capture rather than document-level listeners: the drag follows the
	// pointer off the end of the track and releases cleanly wherever it ends up.
	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId)
		setFromPointer(event.clientX)
	}

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
		setFromPointer(event.clientX)
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

	// The handle travels the track less its own width, so the far end lines up with
	// the far end of the track rather than hanging over it.
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
					aria-valuemin={MIN_PENCIL_WIDTH}
					aria-valuemax={MAX_PENCIL_WIDTH}
					aria-valuenow={value}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onKeyDown={handleKeyDown}
				>
					<span
						className={styles.handle}
						style={{ left: `calc(${fraction * 100}% - ${fraction * HANDLE_WIDTH}px)` }}
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

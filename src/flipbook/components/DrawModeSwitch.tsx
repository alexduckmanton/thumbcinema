import { useEffect, useState } from 'react'

import { DRAW_MODES, type DrawMode, setDrawMode } from '../drawModes'
import styles from './DrawModeSwitch.module.css'

export interface DrawModeSwitchProps {
	mode: DrawMode
}

/** How long the rules of a freshly-picked mode stay on screen. */
const HINT_DURATION = 5000

/**
 * The switch between the drawing modes, in the top right of the window.
 *
 * A native `<select>` rather than anything built here, and that is the whole design:
 * it is the one control on either platform that can show eight options in a list a
 * thumb can hit, and it costs nothing. It is laid over the disc at zero opacity, so
 * what you see is the button and what you press is the picker.
 *
 * Deliberately unlike everything else on the page. This is scaffolding — it is here
 * to answer a question about how a finger should draw, and it goes when the question
 * is answered — so it is stated in the plainest terms available rather than drawn in
 * the site's hand. Nothing about it should read as part of the flipbook tool.
 */
export function DrawModeSwitch({ mode }: DrawModeSwitchProps) {
	const current = DRAW_MODES.find((entry) => entry.id === mode) ?? DRAW_MODES[0]
	const [hinting, setHinting] = useState(false)

	// The rules of a mode, for as long as it takes to read them. Half of these are
	// gestures with a timer in them, and a mode whose rules you have forgotten is a
	// mode that tests as broken.
	useEffect(() => {
		if (!hinting) return
		const timer = window.setTimeout(() => setHinting(false), HINT_DURATION)
		return () => window.clearTimeout(timer)
	}, [hinting])

	return (
		<div className={styles.switcher}>
			<div className={styles.button}>
				<span className={styles.icon} aria-hidden="true">
					<span />
					<span />
					<span />
				</span>

				<select
					className={styles.select}
					aria-label="Drawing mode"
					value={mode}
					onChange={(event) => {
						setDrawMode(event.target.value as DrawMode)
						setHinting(true)
					}}
				>
					{DRAW_MODES.map((entry) => (
						<option key={entry.id} value={entry.id}>
							{entry.label}
						</option>
					))}
				</select>
			</div>

			{/* Hidden from the accessibility tree: the select above already announces
			    its own value, and a second copy of it is noise. */}
			<div className={styles.caption} aria-hidden="true">
				<span className={styles.label}>{current?.label}</span>
				{hinting ? <span className={styles.hint}>{current?.hint}</span> : null}
			</div>
		</div>
	)
}

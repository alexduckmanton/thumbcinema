import { useEffect, useState } from 'react'

import { isAdmin } from '../../lib/admin'
import { DRAW_MODES, type DrawMode, label, setDrawMode } from '../drawModes'
import styles from './DrawModeSwitch.module.css'

export interface DrawModeSwitchProps {
	mode: DrawMode
	/**
	 * The disc's class, handed down rather than owned here.
	 *
	 * It stands in the create page's row of edit actions and is one of them to look at,
	 * so it wears that page's `.action` — applied to this markup, which is what
	 * `RouteShell` does with the same class and is not the cross-module *selector* the
	 * rest of the tree avoids.
	 */
	className?: string
}

/** How long the rules of a freshly-picked mode stay on screen. */
const HINT_DURATION = 5000

/**
 * The switch between the drawing modes: the last disc in the phone's row of edit
 * actions, at the right-hand end.
 *
 * **Admin only.** The site ships `DEFAULT_DRAW_MODE` and nothing on the page says so:
 * the other twelve modes are a question being asked rather than a setting, and a picker
 * offering a stranger thirteen ways to hold a pencil is a worse first thirty seconds than
 * any of them is an improvement. It is gated on the same shared secret the gallery's
 * moderation toggles are, for the same reason and by the same one line — see
 * `lib/admin.ts` and `AdminToggles`.
 *
 * The gate is in two halves and both are needed: this control goes, and `read` in
 * `drawModes.ts` stops honouring what is in storage. Hiding the switch alone would strand
 * anybody who picked a mode while holding the token and then lost it.
 *
 * A native `<select>` rather than anything built here, and that is the whole design: it
 * is the one control on either platform that can show a dozen options in a list a thumb can
 * hit, and it costs nothing. It is laid over the disc at zero opacity, so what you see is
 * the button and what you press is the picker.
 *
 * **Phone only**, because the row it lives in is. That is not a loss worth working
 * around: the thirteen modes are thirteen answers to "a finger is opaque", and a desktop
 * has a pointer. It used to float in the top-right corner of every layout, which is a
 * corner the drawing modes themselves like to put a magnifier in.
 *
 * ⚿ rather than three drawn bars, and it is checked rather than assumed: Pecita's cmap
 * has U+26BF and not U+1F512, so the squared key is the lock this face actually ships.
 * A glyph rather than CSS boxes now that it stands in a row of glyphs — ↺ ↻ ↥ ↧ — and
 * has to look like one of them.
 *
 * **The caption is permanently on and leads with the version number**, which is most of
 * why the modes are numbered at all: they differ from each other by a rule rather than by
 * a picture, and half of them look identical until you touch the glass. Without a number
 * on screen, saying which one you were drawing with means describing it.
 */
export function DrawModeSwitch({ mode, className }: DrawModeSwitchProps) {
	const current = DRAW_MODES.find((entry) => entry.id === mode) ?? DRAW_MODES[0]
	const [hinting, setHinting] = useState(false)

	// The rules of a mode, for as long as it takes to read them. Several of these are
	// gestures with a timer in them, and a mode whose rules you have forgotten is a mode
	// that tests as broken.
	useEffect(() => {
		if (!hinting) return
		const timer = window.setTimeout(() => setHinting(false), HINT_DURATION)
		return () => window.clearTimeout(timer)
	}, [hinting])

	// After the hooks, not before them: an early return above `useState`/`useEffect` is a
	// different number of hooks on the two paths. `isAdmin()` is settled at import and
	// never changes under a live page, so this branch is stable for the page's life —
	// which is the same thing `AdminToggles` relies on.
	if (!isAdmin()) return null

	return (
		<>
			<div className={className ? `${styles.button} ${className}` : styles.button}>
				<span className={styles.glyph} aria-hidden="true">
					⚿
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
							{label(entry)}
						</option>
					))}
				</select>
			</div>

			{/* Hidden from the accessibility tree: the select above already announces
			    its own value, and a second copy of it is noise.

			    Fixed above the footer rather than beside the disc, because the disc is now
			    in a row that has no room for a paragraph. Out of the flow entirely, so the
			    row it is rendered from lays out as five discs and a button. */}
			<div className={styles.caption} aria-hidden="true">
				<span className={styles.label}>{current ? label(current) : null}</span>
				{hinting ? <span className={styles.hint}>{current?.hint}</span> : null}
			</div>
		</>
	)
}

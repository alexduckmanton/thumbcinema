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
 * **Nothing on the page says which mode is on.** There was a caption pinned above the
 * footer that did — the number and the rules of whichever mode had just been picked —
 * and it was a paragraph floating over the drawing for the sake of a control only an
 * admin can see. The `<select>` announces its own value and the list is one press away,
 * which is where the answer lives now.
 */
export function DrawModeSwitch({ mode, className }: DrawModeSwitchProps) {
	// `isAdmin()` is settled at import and never changes under a live page, so this branch
	// is stable for the page's life — which is the same thing `AdminToggles` relies on.
	if (!isAdmin()) return null

	return (
		<div className={className ? `${styles.button} ${className}` : styles.button}>
			<span className={styles.glyph} aria-hidden="true">
				⚿
			</span>

			<select
				className={styles.select}
				aria-label="Drawing mode"
				value={mode}
				onChange={(event) => setDrawMode(event.target.value as DrawMode)}
			>
				{DRAW_MODES.map((entry) => (
					<option key={entry.id} value={entry.id}>
						{label(entry)}
					</option>
				))}
			</select>
		</div>
	)
}

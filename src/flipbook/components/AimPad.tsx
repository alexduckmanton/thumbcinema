import styles from './AimPad.module.css'

/**
 * v14's aiming pad: the panel at the bottom of the screen you drag in to move the cursor
 * around the drawing.
 *
 * It has no code in it at all, and that is the design. `PointerLayer` finds it by the
 * `data-aim-pad` attribute and does the rest — see `usesAimPad` — so this component's
 * whole job is to be a box in the layout that says what it is. Nothing here listens for
 * anything, which is also why a pad that is `display: none` at desktop width needs no
 * corresponding condition in the layer: a hidden element takes no touches, so no touch is
 * ever aiming up there.
 *
 * **What it replaced was an inference.** v13 read every touch that wasn't on the paper or
 * on a control as an aiming drag, and while the create page was a column of drawing with
 * a band of empty white under it, that was free. It stopped being free the moment the
 * flipbook became a column you scroll: a drag on the pages had two possible meanings and
 * v13 answered "aim" every time, so the flipbook could not be scrolled at all. A surface
 * you can see is also a surface you can find, which "drag somewhere in the white" never
 * was.
 */
export function AimPad() {
	return (
		<div className={styles.pad} data-aim-pad>
			<span className="visuallyHidden">
				Drag here to move the cursor around the drawing. Put a second finger down, or hold a tool,
				to draw with it.
			</span>
		</div>
	)
}

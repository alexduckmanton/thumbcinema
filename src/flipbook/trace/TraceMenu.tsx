import { useEffect, useRef } from 'react'

import styles from './TraceMenu.module.css'

export interface TraceMenuProps {
	onEdit: () => void
	onReplace: () => void
	onRemove: () => void
	onCancel: () => void
}

/**
 * The three things you can do to a trace photo that is already on the page.
 *
 * Raised by pressing the camera button a second time, which is the only entry point the
 * feature has — so it has to carry all three rather than being a shortcut to one. The
 * button cannot simply toggle back into placing, because "I want a different photo" and
 * "I am done with this one" are at least as common as "let me nudge it", and neither has
 * anywhere else to be asked.
 *
 * Escape closes it, and so does a press on the wash, both of which mean "none of those".
 *
 * **Focus goes to the dialog itself rather than to the first choice**, and that is the
 * difference between a keyboard user finding the sheet and a mouse user being shown a blue
 * ring round "Move or resize the photo" that they did not ask for. `:focus-visible` is the
 * browser's own judgement about whether focus arrived from a keyboard, and a programmatic
 * `.focus()` poisons it — the same trap the gallery card's focus ring is written up for.
 * A container with `tabIndex={-1}` takes focus without drawing anything, and Tab from
 * there reaches the three choices in order. Focus goes back to the camera button on the
 * way out, which is where a keyboard was.
 */
export function TraceMenu({ onEdit, onReplace, onRemove, onCancel }: TraceMenuProps) {
	const panel = useRef<HTMLDivElement | null>(null)

	// Read on the event rather than closed over, so the listener is bound once.
	const dismiss = useRef(onCancel)
	dismiss.current = onCancel

	useEffect(() => {
		const returnTo = document.activeElement
		panel.current?.focus({ preventScroll: true })

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			// The create page's own shortcuts are live behind this; Escape there clears
			// the selection, which is not what closing a menu means.
			event.stopPropagation()
			dismiss.current()
		}

		document.addEventListener('keydown', onKeyDown, true)

		return () => {
			document.removeEventListener('keydown', onKeyDown, true)
			if (returnTo instanceof HTMLElement) returnTo.focus()
		}
	}, [])

	return (
		<div
			ref={panel}
			className={styles.scrim}
			role="dialog"
			aria-modal="true"
			aria-label="Trace photo"
			tabIndex={-1}
		>
			{/* The wash, as a button rather than a click handler on the box behind it: a
			    press out here means the same "none of those" that Cancel does, and a real
			    button gets that for free — the press, the Enter, and no keyboard trap. It
			    is out of the tab order and out of the accessibility tree because Cancel is
			    directly below and says the same thing in words. */}
			<button
				type="button"
				className={styles.wash}
				tabIndex={-1}
				aria-hidden="true"
				onClick={onCancel}
			/>

			<div className={styles.sheet}>
				<div className={styles.group}>
					<button type="button" className={styles.choice} onClick={onEdit}>
						Move or resize the photo
					</button>
					{/* One replaces this frame's photo; several replace it and fill the frames
					    after it, making them as needed. Worded for both, because the picker
					    cannot be told to offer only one. */}
					<button type="button" className={styles.choice} onClick={onReplace}>
						Take or choose photos
					</button>
					<button
						type="button"
						className={`${styles.choice} ${styles.destructive}`}
						onClick={onRemove}
					>
						Remove the photo
					</button>
				</div>

				<button type="button" className={`${styles.choice} ${styles.cancel}`} onClick={onCancel}>
					Cancel
				</button>
			</div>
		</div>
	)
}

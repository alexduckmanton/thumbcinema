import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '../../components/Button'
import styles from './SaveForm.module.css'

export interface SaveFormValues {
	title: string
	description: string
}

export interface SaveFormProps {
	saving: boolean
	onSave: (values: SaveFormValues) => void
	onCancel: () => void
}

/**
 * Naming a flipbook, as a modal dialog.
 *
 * A real `<dialog>` opened with `showModal()` rather than a positioned div, and the
 * platform earns its place three times over: the backdrop is `::backdrop`, everything
 * behind it goes inert without this component knowing what "everything" is, and focus
 * is trapped and restored on close. Hand-rolling that is about forty lines of focus
 * management to arrive at what the element already does — and getting it subtly wrong
 * on a page whose whole background is a drawing surface listening for pointer events.
 *
 * It used to be a panel laid over the canvas inside `.book`, which is why it is worth
 * saying what changed: the panel was sized to the canvas and the canvas is no longer
 * one shape. A 16:9 lid over a square page left the form's blue across the top and the
 * wash's lighter blue across the bottom. A modal isn't measured against the drawing at
 * all, so the question doesn't arise.
 */
export function SaveForm({ saving, onSave, onCancel }: SaveFormProps) {
	const titleId = useId()
	const descriptionId = useId()
	const headingId = useId()

	const [title, setTitle] = useState('')
	const [description, setDescription] = useState('')

	const dialog = useRef<HTMLDialogElement | null>(null)

	// Opened as a *modal* rather than rendered open: `open` as an attribute gives a
	// non-modal dialog with no backdrop, nothing inert behind it and no focus trap,
	// which is three of the four reasons this is a `<dialog>` at all.
	useEffect(() => {
		const element = dialog.current
		if (!element || element.open) return

		element.showModal()
		return () => element.close()
	}, [])

	return (
		<dialog
			ref={dialog}
			className={styles.dialog}
			aria-labelledby={headingId}
			// Esc, which the browser fires as `cancel` on a modal dialog. Prevented while
			// the artwork is on the wire: the save is already happening and there is
			// nothing left to back out of.
			onCancel={(event) => {
				event.preventDefault()
				if (!saving) onCancel()
			}}
		>
			<form
				className={styles.form}
				onSubmit={(event) => {
					event.preventDefault()
					// The browser's own validation has already said so — this is the
					// backstop for a title of nothing but spaces, which `required` allows.
					if (!title.trim()) return
					onSave({ title: title.trim(), description: description.trim() })
				}}
			>
				<h2 className={styles.heading} id={headingId}>
					Save flipbook
				</h2>

				<div className={styles.field}>
					<label htmlFor={titleId}>Title</label>
					{/* Autofocused by the attribute rather than by an effect: `showModal()`
					    moves focus itself, and it looks for this first. */}
					{/* biome-ignore lint/a11y/noAutofocus: focus inside a modal on open is what showModal does anyway. */}
					<input
						id={titleId}
						type="text"
						autoComplete="off"
						required
						autoFocus
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</div>

				<div className={`${styles.field} ${styles.description}`}>
					<label htmlFor={descriptionId}>
						Description <span className={styles.optional}>(optional)</span>
					</label>
					<textarea
						id={descriptionId}
						value={description}
						onChange={(event) => setDescription(event.target.value)}
					/>
				</div>

				<div className={styles.buttons}>
					<Button type="submit" variant="submit" loading={saving}>
						Save
					</Button>
					<Button variant="blank" onClick={onCancel} disabled={saving}>
						Cancel
					</Button>
				</div>
			</form>
		</dialog>
	)
}

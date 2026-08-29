import { type RefObject, useEffect, useId, useRef, useState } from 'react'

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
	useKeyboardInset(dialog)
	useDarkenedChrome()

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
			<div className={styles.card}>
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
			</div>
		</dialog>
	)
}

/**
 * How much of the window the on-screen keyboard is covering, as a custom property.
 *
 * There is no CSS-only answer that works where it needs to. `interactive-widget=
 * resizes-content` in the viewport meta is the declarative one and would make `dvh`
 * shrink with the keyboard — but it is Chrome and Firefox only, and WebKit has not
 * shipped it, which means it does nothing on an iPhone. iOS resizes the *visual*
 * viewport and leaves the layout viewport alone, so `100dvh` is still the whole screen
 * and a card centred in it sits half behind the keyboard.
 *
 * `visualViewport` is what every engine including iOS does agree on. What is published
 * is the **inset** rather than the visible height, and that distinction is the whole
 * design: the overlay stays the full size of the window so the wash reaches under the
 * browser's own chrome, and the keyboard is taken off it as padding instead. Sizing the
 * overlay to the visible height would have fixed the keyboard and reintroduced the pale
 * bands at the top and bottom that it exists to cover.
 *
 * `offsetTop` is part of the sum: iOS scrolls the layout viewport to bring a focused
 * field into view, and what is left underneath is the keyboard plus however far it has
 * scrolled.
 */
function useKeyboardInset(element: RefObject<HTMLDialogElement | null>): void {
	useEffect(() => {
		const viewport = window.visualViewport
		if (!viewport) return

		const update = () => {
			const node = element.current
			if (!node) return
			// Floored at zero: the sum goes slightly negative mid-rotation on iOS, and a
			// negative padding is an invalid declaration that takes the whole rule with it.
			const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
			node.style.setProperty('--keyboard-inset', `${Math.round(covered)}px`)
		}

		update()
		// Both, and they are different events: `resize` is the keyboard opening and
		// closing, `scroll` is iOS sliding the layout viewport under it.
		viewport.addEventListener('resize', update)
		viewport.addEventListener('scroll', update)
		return () => {
			viewport.removeEventListener('resize', update)
			viewport.removeEventListener('scroll', update)
		}
	}, [element])
}

/**
 * Darkens the browser's own chrome for as long as the dialog is up.
 *
 * The overlay covers the window, but on iOS the strip behind the status bar and the one
 * behind the URL bar are painted by Safari from `<meta name="theme-color">` — so with a
 * page-coloured theme the wash arrives with a pale band above and below it, which is
 * the thing that looked wrong. This is not what the reference app does; it does not have
 * to, because its theme colour is white in light mode and near-black in dark, and a
 * near-black bar beside a black wash is not a seam anybody notices. Ours is `--page`.
 *
 * The value is `--page` composited under the same wash the overlay paints — 55% black
 * over #f1f1f1 — so the bars and the overlay are the same grey rather than merely both
 * dark. Restored on close, including when the dialog is torn down by a navigation.
 */
const WASHED_THEME = '#6c6c6c'

function useDarkenedChrome(): void {
	useEffect(() => {
		const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
		if (!meta) return

		const original = meta.content
		meta.content = WASHED_THEME
		return () => {
			meta.content = original
		}
	}, [])
}

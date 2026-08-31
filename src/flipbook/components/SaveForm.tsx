import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
 * Naming a flipbook, as a modal.
 *
 * A positioned div rather than a `<dialog>` opened with `showModal()`, and that is a
 * reversal worth stating plainly, because the `<dialog>` was here for good reasons and
 * they still hold: it gave us the backdrop, the inert page and the focus trap for
 * nothing. What it also does is put the element in the **top layer**, and on iOS since
 * Safari 26 an open modal dialog stops the browser tinting its own toolbars from the
 * page — so the wash covered the drawing and left a pale band above and below it, under
 * the status bar and the URL bar. That is measured rather than reasoned about; see the
 * note at the top of the stylesheet for what was tried and how it was narrowed down.
 *
 * So the four things the element was doing are done by hand here — Esc, `inert` on the
 * page behind, focus moved in on open and put back on close — and the page behind is
 * still a drawing surface listening for pointer events, which is what `inert` is
 * covering.
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

	const overlay = useRef<HTMLDivElement | null>(null)
	const card = useRef<HTMLDivElement | null>(null)
	useKeyboardInset(overlay)
	useModalPage(overlay)
	useEntrance(overlay, card)

	return createPortal(
		<div
			ref={overlay}
			className={styles.overlay}
			role="dialog"
			aria-modal="true"
			aria-labelledby={headingId}
			// Focusable but not tabbable, purely as somewhere for focus to land if the
			// field isn't there — the keydown handler below only fires while focus is
			// inside this subtree.
			tabIndex={-1}
			// Esc, which a `<dialog>` used to answer for us. Refused while the artwork is
			// on the wire: the save is already happening and there is nothing left to back
			// out of.
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault()
					if (!saving) onCancel()
					return
				}
				if (event.key === 'Tab') trapTab(event, overlay.current)
			}}
		>
			<div className={styles.card} ref={card}>
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
						{/* Deliberately not focused when the form opens — see `useModalPage`. */}
						<input
							id={titleId}
							type="text"
							autoComplete="off"
							required
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
		</div>,
		document.body,
	)
}

/**
 * The entrance, animated rather than declared.
 *
 * Both elements start at `opacity: 0` in the stylesheet and are brought up from here,
 * which is the reference app's arrangement rather than a preference. A CSS `animation`
 * property on the wash was the last thing still telling the two apart, and it is not an
 * innocent difference: an animating element is composited on its own layer, and iOS's
 * toolbar sampler — the whole reason the wash is shaped the way it is, see the stylesheet
 * — is sensitive to how the thing it reads is composited.
 *
 * `element.animate()` is the Web Animations API, which is what the reference gets to
 * through Motion One. Called directly here: `react`, `react-dom`, `paper` and `pg` are
 * the only runtime dependencies and this needs no more.
 *
 * `fill: 'both'` is what holds the final frame — without it both elements snap back to
 * the `opacity: 0` the stylesheet gives them the moment the animation ends.
 *
 * Reduced motion is honoured here rather than by a media query, because the starting
 * frame is now in CSS: with no animation to run, something still has to put the two
 * elements at their finished state, or the form never appears at all. Same reason for
 * the `animate` guard — a browser without the API would otherwise show nothing.
 */
function useEntrance(
	overlay: RefObject<HTMLDivElement | null>,
	card: RefObject<HTMLDivElement | null>,
): void {
	useEffect(() => {
		const wash = overlay.current
		const sheet = card.current
		if (!wash || !sheet) return

		const settle = () => {
			wash.style.opacity = '1'
			sheet.style.opacity = '1'
			sheet.style.transform = 'none'
		}

		if (!wash.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
			settle()
			return
		}

		const timing = { duration: 160, easing: 'ease-out', fill: 'both' } as const
		const washIn = wash.animate({ opacity: [0, 1] }, timing)
		const cardIn = sheet.animate(
			{ opacity: [0, 1], transform: ['scale(0.96)', 'scale(1)'] },
			timing,
		)

		return () => {
			washIn.cancel()
			cardIn.cancel()
		}
	}, [overlay, card])
}

/**
 * The three things `showModal()` used to do, done by hand: the page behind goes inert,
 * focus moves into the form, and it goes back where it came from on close.
 *
 * `inert` is the platform feature that survives the dialog going away — it is what makes
 * everything behind unfocusable, unclickable and invisible to a screen reader, and it is
 * one attribute on `#root` because the overlay is portalled to `<body>` and so is that
 * element's sibling rather than its descendant. Without it the page behind this is still
 * a drawing surface with pointer handlers on it.
 *
 * The order is load-bearing. `inert` blurs whatever it swallows, so focus has to be
 * placed *after* the attribute lands rather than by an attribute on the markup, which
 * React applies during commit — before this effect runs.
 *
 * `#root` rather than "every sibling": that is the one element the app renders into, and
 * naming it keeps this from inerting the overlay itself, which walking siblings would
 * have to be careful not to do.
 */
function useModalPage(overlay: RefObject<HTMLDivElement | null>): void {
	useEffect(() => {
		const page = document.getElementById('root')
		const previous = document.activeElement

		page?.setAttribute('inert', '')
		// The overlay itself, not the title field. Focus has to land *somewhere* inside —
		// it is what Esc and the Tab trap below are listening from, and `inert` has just
		// taken away whatever had it — but focusing the input raises the on-screen
		// keyboard the moment the form appears, which covers half the card and collapses
		// Safari's own toolbar before you have decided to type anything. The overlay is
		// `tabIndex={-1}` for exactly this: focusable, not tabbable, and not a text field.
		overlay.current?.focus()

		return () => {
			page?.removeAttribute('inert')
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
		}
	}, [overlay])
}

/**
 * Tab, kept inside the card.
 *
 * `inert` on the page already stops focus reaching anything behind, so what this adds is
 * the wrap: without it, tabbing off the end of the form lands in the browser's own chrome
 * and the way back is shift-tab through it. Disabled controls are not focusable and the
 * save button is disabled while saving, so the set is read at the moment of the press
 * rather than held.
 */
function trapTab(event: React.KeyboardEvent, overlay: HTMLElement | null): void {
	if (!overlay) return

	const focusable = overlay.querySelectorAll<HTMLElement>(
		'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
	)
	const first = focusable[0]
	const last = focusable[focusable.length - 1]
	if (!first || !last) return

	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault()
		last.focus()
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault()
		first.focus()
	}
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
function useKeyboardInset(element: RefObject<HTMLDivElement | null>): void {
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

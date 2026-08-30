import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SaveForm } from './SaveForm'

describe('SaveForm', () => {
	it('does not focus the title, so no keyboard comes up with the form', () => {
		// Focus still has to land inside — Esc and the Tab trap listen from there, and
		// `inert` has just taken it away from whatever had it — but it lands on the
		// overlay rather than on a text field, which on a phone would raise the keyboard
		// over half the card before you had decided to type anything.
		render(<SaveForm saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)

		expect(screen.getByLabelText('Title')).not.toHaveFocus()
		expect(screen.getByRole('dialog')).toHaveFocus()
	})

	it('hands back what was filled in', async () => {
		const onSave = vi.fn()
		render(<SaveForm saving={false} onSave={onSave} onCancel={vi.fn()} />)

		await userEvent.type(screen.getByLabelText('Title'), '  A walking man  ')
		await userEvent.type(screen.getByLabelText(/Description/), 'He walks.')
		await userEvent.click(screen.getByRole('button', { name: 'Save' }))

		// Trimmed, which is the one thing this does to what was typed.
		expect(onSave).toHaveBeenCalledWith({ title: 'A walking man', description: 'He walks.' })
	})

	it('will not save an untitled flipbook', async () => {
		const onSave = vi.fn()
		render(<SaveForm saving={false} onSave={onSave} onCancel={vi.fn()} />)

		await userEvent.type(screen.getByLabelText('Title'), '   ')
		await userEvent.click(screen.getByRole('button', { name: 'Save' }))

		expect(onSave).not.toHaveBeenCalled()
	})

	it('goes back to drawing on cancel', async () => {
		const onCancel = vi.fn()
		render(<SaveForm saving={false} onSave={vi.fn()} onCancel={onCancel} />)

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(onCancel).toHaveBeenCalled()
	})

	it('locks both buttons while the artwork is on the wire', () => {
		render(<SaveForm saving onSave={vi.fn()} onCancel={vi.fn()} />)

		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
	})

	it('is a modal, and makes the page behind it inert', () => {
		// Deliberately *not* a `<dialog>` opened with `showModal()`: that puts the element
		// in the top layer, and on iOS the top layer stops the browser tinting its own
		// toolbars from the page — so the wash stopped short of both of them. See the note
		// in `SaveForm.module.css`. `inert` on `#root` is what replaces the dialog's free
		// inert page, and the drawing tool behind this is a canvas listening for every
		// pointer event there is.
		const root = document.createElement('div')
		root.id = 'root'
		document.body.append(root)

		const { unmount } = render(<SaveForm saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)

		expect(screen.getByRole('dialog')).toBeInTheDocument()
		expect(document.querySelector('dialog')).toBeNull()
		expect(root).toHaveAttribute('inert')

		// And handed back when it closes, or the page stays dead.
		unmount()
		expect(root).not.toHaveAttribute('inert')
		root.remove()
	})

	it('backs out on Escape, but not while it is saving', async () => {
		// Esc on a modal dialog was the browser's `cancel` event; it is ours now.
		const onCancel = vi.fn()
		const { rerender } = render(<SaveForm saving={false} onSave={vi.fn()} onCancel={onCancel} />)

		await userEvent.keyboard('{Escape}')
		expect(onCancel).toHaveBeenCalledTimes(1)

		// The artwork is already on the wire — there is nothing left to back out of.
		rerender(<SaveForm saving onSave={vi.fn()} onCancel={onCancel} />)
		await userEvent.keyboard('{Escape}')
		expect(onCancel).toHaveBeenCalledTimes(1)
	})

	it('names itself from its own heading', () => {
		render(<SaveForm saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
		expect(screen.getByRole('dialog')).toHaveAccessibleName('Save flipbook')
	})

	it('no longer asks whether a flipbook contains adult stuff', () => {
		// Flagging is an admin action now. Asserted rather than left to the absence of a
		// test, because the field went from the payload too — see `src/lib/api.test.ts`.
		render(<SaveForm saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
		expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
	})
})

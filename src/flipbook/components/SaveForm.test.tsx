import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SaveForm } from './SaveForm'

describe('SaveForm', () => {
	it('focuses the title, so you can just start typing', () => {
		render(<SaveForm saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)
		expect(screen.getByLabelText('Title')).toHaveFocus()
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

	it('is a modal dialog, and opens itself as one', () => {
		// `showModal()` rather than the `open` attribute is what gets the backdrop, the
		// focus trap and an inert page behind it — and the drawing tool behind this one
		// is a canvas listening for every pointer event there is.
		const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
		render(<SaveForm saving={false} onSave={vi.fn()} onCancel={vi.fn()} />)

		expect(showModal).toHaveBeenCalled()
		expect(screen.getByRole('dialog')).toBeInTheDocument()
		showModal.mockRestore()
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

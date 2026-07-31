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
		await userEvent.click(screen.getByLabelText(/adult stuff/))
		await userEvent.click(screen.getByRole('button', { name: 'Save flipbook' }))

		expect(onSave).toHaveBeenCalledWith({
			title: 'A walking man',
			description: 'He walks.',
			nsfw: true,
		})
	})

	it('will not save an untitled flipbook', async () => {
		const onSave = vi.fn()
		render(<SaveForm saving={false} onSave={onSave} onCancel={vi.fn()} />)

		await userEvent.type(screen.getByLabelText('Title'), '   ')
		await userEvent.click(screen.getByRole('button', { name: 'Save flipbook' }))

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

		expect(screen.getByRole('button', { name: 'Save flipbook' })).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
	})
})

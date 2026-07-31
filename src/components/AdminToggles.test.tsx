import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { refresh } from '../lib/admin'
import { ApiError } from '../lib/api'
import { AdminToggles } from './AdminToggles'

const setFlipbookFlags = vi.fn()

vi.mock('../lib/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../lib/api')>()),
	setFlipbookFlags: (...args: unknown[]) => setFlipbookFlags(...args),
}))

function enableAdmin() {
	window.localStorage.setItem('tc_admin_token', 'sekrit')
	refresh()
}

beforeEach(() => {
	setFlipbookFlags.mockReset()
	window.localStorage.clear()
	refresh()
})

describe('AdminToggles', () => {
	it('renders nothing at all without a token', () => {
		const { container } = render(
			<AdminToggles id="abc" flags={{ featured: false, nsfw: false }} onChange={vi.fn()} />,
		)
		expect(container).toBeEmptyDOMElement()
	})

	it('shows both toggles with their current state', () => {
		enableAdmin()
		render(<AdminToggles id="abc" flags={{ featured: true, nsfw: false }} onChange={vi.fn()} />)

		expect(screen.getByRole('button', { name: 'Featured' })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: 'Adult content' })).toHaveAttribute(
			'aria-pressed',
			'false',
		)
	})

	it('flips a flag and reports what the server actually stored', async () => {
		enableAdmin()
		setFlipbookFlags.mockResolvedValue({ id: 'abc', featured: true, nsfw: false })
		const onChange = vi.fn()

		render(<AdminToggles id="abc" flags={{ featured: false, nsfw: false }} onChange={onChange} />)
		await userEvent.click(screen.getByRole('button', { name: 'Featured' }))

		expect(setFlipbookFlags).toHaveBeenCalledWith(
			'abc',
			{ featured: true },
			{ headers: { Authorization: 'Bearer sekrit' } },
		)
		await waitFor(() => expect(onChange).toHaveBeenCalledWith({ featured: true, nsfw: false }))
	})

	it('signs out when the token has stopped working', async () => {
		enableAdmin()
		setFlipbookFlags.mockRejectedValue(new ApiError(401, 'Unauthorized'))

		const { rerender } = render(
			<AdminToggles id="abc" flags={{ featured: false, nsfw: false }} onChange={vi.fn()} />,
		)
		await userEvent.click(screen.getByRole('button', { name: 'Featured' }))

		await waitFor(() => expect(window.localStorage.getItem('tc_admin_token')).toBeNull())

		// And the controls go with it.
		rerender(<AdminToggles id="abc" flags={{ featured: false, nsfw: false }} onChange={vi.fn()} />)
		expect(screen.queryByRole('button', { name: 'Featured' })).not.toBeInTheDocument()
	})

	it('keeps the token for an ordinary failure', async () => {
		enableAdmin()
		setFlipbookFlags.mockRejectedValue(new ApiError(500, 'Something went wrong.'))

		render(<AdminToggles id="abc" flags={{ featured: false, nsfw: false }} onChange={vi.fn()} />)
		await userEvent.click(screen.getByRole('button', { name: 'Featured' }))

		await waitFor(() => expect(setFlipbookFlags).toHaveBeenCalled())
		expect(window.localStorage.getItem('tc_admin_token')).toBe('sekrit')
	})
})

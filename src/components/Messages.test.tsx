import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { hideMessage, showMessage } from '../lib/messages'
import { Messages } from './Messages'

beforeEach(() => {
	hideMessage()
})

describe('Messages', () => {
	it('shows nothing when there is nothing to say', () => {
		const { container } = render(<Messages />)
		expect(container).toBeEmptyDOMElement()
	})

	it('drops the message in a word at a time, and announces it', () => {
		render(<Messages />)
		act(() => showMessage({ copy: 'Nice one you did it', cta: 'Thanks', type: 'success' }))

		const banner = screen.getByRole('status')
		expect(banner).toHaveTextContent('Nice one you did it')
		// Five words plus the dismiss link, each on its own timing.
		expect(banner.querySelectorAll('li')).toHaveLength(6)
	})

	it('dismisses on the call to action', async () => {
		render(<Messages />)
		act(() => showMessage({ copy: 'Oh no', cta: 'Dang', type: 'error' }))

		await userEvent.click(screen.getByRole('button', { name: 'Dang' }))
		expect(screen.queryByRole('status')).not.toBeInTheDocument()
	})

	it.each(['Escape', 'Enter', ' '])('dismisses on %s', async (key) => {
		render(<Messages />)
		act(() => showMessage({ copy: 'Hello', cta: 'Fine', type: 'info' }))

		await userEvent.keyboard(key === ' ' ? '[Space]' : `{${key}}`)
		expect(screen.queryByRole('status')).not.toBeInTheDocument()
	})
})

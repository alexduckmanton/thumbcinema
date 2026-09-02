import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { hideToast, showToast } from '../lib/toast'
import { Toast } from './Toast'

beforeEach(() => {
	hideToast()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('Toast', () => {
	it('shows nothing when there is nothing to say', () => {
		const { container } = render(<Toast />)
		expect(container).toBeEmptyDOMElement()
	})

	it('announces an info toast politely', () => {
		render(<Toast />)
		act(() => showToast({ copy: 'Flipbook saved.', type: 'info' }))

		expect(screen.getByRole('status')).toHaveTextContent('Flipbook saved.')
	})

	it('announces an error assertively', () => {
		render(<Toast />)
		act(() => showToast({ copy: "Couldn't save your flipbook. Try again.", type: 'error' }))

		expect(screen.getByRole('alert')).toBeInTheDocument()
		expect(screen.queryByRole('status')).not.toBeInTheDocument()
	})

	it('dismisses on Got it', async () => {
		const user = userEvent.setup()
		render(<Toast />)
		act(() => showToast({ copy: 'Oh no', type: 'error' }))

		await user.click(screen.getByRole('button', { name: 'Got it' }))

		// It animates out, so it is on screen for a beat after the store lets go of it.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 250))
		})
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('takes an info toast away on its own', () => {
		vi.useFakeTimers()
		render(<Toast />)
		act(() => showToast({ copy: 'Flipbook saved.', type: 'info' }))

		// Twice: the first pass runs the linger timer, and only then does the component
		// start the one that unmounts it after the slide-out.
		act(() => void vi.advanceTimersByTime(5200))
		act(() => void vi.advanceTimersByTime(300))
		expect(screen.queryByRole('status')).not.toBeInTheDocument()
	})

	it('leaves an error up until it is dismissed', () => {
		vi.useFakeTimers()
		render(<Toast />)
		act(() => showToast({ copy: 'Oh no', type: 'error' }))

		act(() => void vi.advanceTimersByTime(30000))
		expect(screen.getByRole('alert')).toBeInTheDocument()
	})
})

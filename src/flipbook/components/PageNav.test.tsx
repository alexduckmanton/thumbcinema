import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { FlipbookEngine } from '../engine/FlipbookEngine'
import { PageNav } from './PageNav'

/** Only the two methods the arrows call. The rest of the engine isn't in this. */
function fakeEngine() {
	return { previousPage: vi.fn(), nextPage: vi.fn() } as unknown as FlipbookEngine
}

describe('PageNav', () => {
	it('turns the page in both directions', async () => {
		const engine = fakeEngine()
		render(<PageNav engine={engine} activePage={1} pages={3} busy={false} />)

		await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
		expect(engine.previousPage).toHaveBeenCalled()

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
		expect(engine.nextPage).toHaveBeenCalled()
	})

	it('stops at both ends', () => {
		const { rerender } = render(
			<PageNav engine={fakeEngine()} activePage={0} pages={3} busy={false} />,
		)
		expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()

		rerender(<PageNav engine={fakeEngine()} activePage={2} pages={3} busy={false} />)
		expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
	})

	it('is out of the way while a page is in flight', () => {
		render(<PageNav engine={fakeEngine()} activePage={1} pages={3} busy={true} />)

		expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
	})

	it('never counts past the end, which a delete would', () => {
		// The arriving page is active from the first frame and the page it replaces is
		// still falling, so for 750ms the active index is past the settled count.
		const { container } = render(
			<PageNav engine={fakeEngine()} activePage={1} pages={1} busy={true} />,
		)

		expect(container.querySelector('p')?.textContent).toBe('1 of 1')
	})
})

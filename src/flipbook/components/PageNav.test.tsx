import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { FlipbookEngine } from '../engine/FlipbookEngine'
import { fractionAt, PageNav, pageAt } from './PageNav'

/** Only the methods the arrows and the scrubber call. The rest of the engine isn't in this. */
function fakeEngine() {
	return { goToPage: vi.fn(), pause: vi.fn() } as unknown as FlipbookEngine
}

describe('PageNav', () => {
	it('turns the page in both directions', async () => {
		const engine = fakeEngine()
		render(<PageNav engine={engine} activePage={1} pages={3} playback="none" />)

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(2)

		await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(0)
	})

	it('wraps at both ends, because playback does', async () => {
		const engine = fakeEngine()
		const { rerender } = render(
			<PageNav engine={engine} activePage={0} pages={3} playback="none" />,
		)

		await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(2)

		rerender(<PageNav engine={engine} activePage={2} pages={3} playback="none" />)

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(0)
	})

	it('takes the arrows back off the bar they stand on', async () => {
		const engine = fakeEngine()
		render(<PageNav engine={engine} activePage={1} pages={5} playback="none" />)

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))

		// Pressing the bar starts a scrub, and a scrub takes over from playback. Pressing
		// an arrow is a press on the bar unless the arrow stops it there: without that,
		// every arrow is also a jump to whichever end the arrow happens to sit at.
		expect(engine.pause).not.toHaveBeenCalled()
		expect(engine.goToPage).toHaveBeenCalledTimes(1)
		expect(engine.goToPage).toHaveBeenCalledWith(2)
	})

	it('says where in the flipbook it is', () => {
		render(<PageNav engine={fakeEngine()} activePage={2} pages={9} playback="none" />)

		const scrubber = screen.getByRole('slider', { name: 'Page' })
		expect(scrubber).toHaveAttribute('aria-valuenow', '3')
		expect(scrubber).toHaveAttribute('aria-valuemin', '1')
		expect(scrubber).toHaveAttribute('aria-valuemax', '9')
		expect(scrubber).toHaveAttribute('aria-valuetext', 'Page 3 of 9')
	})

	it('scrubs with the arrow keys, without needing a pointer', async () => {
		const engine = fakeEngine()
		render(<PageNav engine={engine} activePage={4} pages={9} playback="none" />)

		screen.getByRole('slider').focus()

		await userEvent.keyboard('{ArrowRight}')
		expect(engine.goToPage).toHaveBeenLastCalledWith(5)

		await userEvent.keyboard('{ArrowDown}')
		expect(engine.goToPage).toHaveBeenLastCalledWith(3)
	})

	it('never points past the end, which a delete would', () => {
		// The arriving page is active from the first frame and the page it replaces is
		// still falling, so for 750ms the active index is past the settled count.
		render(<PageNav engine={fakeEngine()} activePage={1} pages={1} playback="none" />)

		expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Page 1 of 1')
	})
})

describe('fractionAt', () => {
	// A 248px bar with a 48px handle: 200px of travel, and the handle's centre runs
	// from 24 to 224.
	const at = (offset: number) => fractionAt(offset, 248, 48)

	it('measures from the handle, not from the end of the bar', () => {
		expect(at(24)).toBe(0)
		expect(at(124)).toBe(0.5)
		expect(at(224)).toBe(1)
	})

	it('holds at the ends rather than running past them', () => {
		expect(at(-500)).toBe(0)
		expect(at(500)).toBe(1)
	})

	it('has nowhere to go along a bar narrower than its own handle', () => {
		expect(fractionAt(120, 40, 48)).toBe(0)
	})
})

describe('pageAt', () => {
	it('puts the ends of the flipbook at the ends of the bar', () => {
		expect(pageAt(0, 5)).toBe(0)
		expect(pageAt(1, 5)).toBe(4)
	})

	it('snaps to the nearest page, and to nothing in between', () => {
		// Five pages, so a position every quarter, and the tipping point is halfway.
		expect(pageAt(0.12, 5)).toBe(0)
		expect(pageAt(0.13, 5)).toBe(1)
		expect(pageAt(0.5, 5)).toBe(2)
	})

	it('has two positions when there are two pages', () => {
		expect(pageAt(0.49, 2)).toBe(0)
		expect(pageAt(0.51, 2)).toBe(1)
	})

	it('has one when there is one page', () => {
		expect(pageAt(0.7, 1)).toBe(0)
	})
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MAX_PENCIL_WIDTH, MIN_PENCIL_WIDTH } from '../engine/tools/pencil'
import { WidthSlider } from './WidthSlider'

describe('WidthSlider', () => {
	it('is a real slider as far as assistive technology is concerned', () => {
		render(<WidthSlider value={3} onChange={vi.fn()} />)

		const slider = screen.getByRole('slider', { name: 'Pencil width' })
		expect(slider).toHaveAttribute('aria-valuenow', '3')
		expect(slider).toHaveAttribute('aria-valuemin', String(MIN_PENCIL_WIDTH))
		expect(slider).toHaveAttribute('aria-valuemax', String(MAX_PENCIL_WIDTH))
	})

	it('steps with the two dots', async () => {
		const onChange = vi.fn()
		render(<WidthSlider value={5} onChange={onChange} />)

		await userEvent.click(screen.getByRole('button', { name: 'Thicker' }))
		expect(onChange).toHaveBeenLastCalledWith(6)

		await userEvent.click(screen.getByRole('button', { name: 'Thinner' }))
		expect(onChange).toHaveBeenLastCalledWith(4)
	})

	it('stops offering a step it cannot take', () => {
		const { rerender } = render(<WidthSlider value={MIN_PENCIL_WIDTH} onChange={vi.fn()} />)
		expect(screen.getByRole('button', { name: 'Thinner' })).toBeDisabled()

		rerender(<WidthSlider value={MAX_PENCIL_WIDTH} onChange={vi.fn()} />)
		expect(screen.getByRole('button', { name: 'Thicker' })).toBeDisabled()
	})

	it('steps with the arrow keys, which the 2013 control could not do at all', async () => {
		const onChange = vi.fn()
		render(<WidthSlider value={4} onChange={onChange} />)

		screen.getByRole('slider').focus()

		await userEvent.keyboard('{ArrowRight}')
		expect(onChange).toHaveBeenLastCalledWith(5)

		await userEvent.keyboard('{ArrowDown}')
		expect(onChange).toHaveBeenLastCalledWith(3)
	})
})

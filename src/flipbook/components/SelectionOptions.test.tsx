import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SQUARE_PAGE_SIZE } from '../engine/constants'
import { RESTING_PAGE } from '../zoomStage'
import { place, SelectionOptions } from './SelectionOptions'

/*
 * The arithmetic, which is the whole of what can be wrong here.
 *
 * A desktop's page, one to one: 640 project units shown at 640px, so a unit is a pixel
 * and every expectation below can be read as the number that was written.
 */
const PAPER = { width: 640, height: 640 }

/** Two 32px discs 4px apart, so the row is 68 wide and its centre is 34 from either end. */
const HALF = 34

/** The row's own height plus the air it stands in. See `CLEARANCE` and `DISC`. */
const LIFT = 42

function at(
	selection: { x: number; y: number; width: number; height: number },
	sheet = RESTING_PAGE,
) {
	const style = place(selection, SQUARE_PAGE_SIZE, PAPER, sheet)
	return style && { left: style.left, top: style.top }
}

describe('place', () => {
	it('centres the row on the selection and stands it clear above', () => {
		expect(at({ x: 200, y: 300, width: 100, height: 80 })).toEqual({
			left: 250,
			top: 300 - LIFT,
		})
	})

	it('drops below the selection when there is no room above it', () => {
		// 20 units down is 20px down, and the row needs 42.
		expect(at({ x: 200, y: 20, width: 100, height: 80 })).toEqual({
			left: 250,
			top: 20 + 80 + 10,
		})
	})

	it('lies on the drawing when there is room on neither side', () => {
		// A drawing that reaches both edges: nothing above it, nothing below it.
		expect(at({ x: 0, y: 0, width: 640, height: 640 })).toEqual({ left: 320, top: 0 })
	})

	it('keeps the row on the paper at either edge', () => {
		expect(at({ x: 0, y: 300, width: 20, height: 20 })?.left).toBe(HALF)
		expect(at({ x: 620, y: 300, width: 20, height: 20 })?.left).toBe(640 - HALF)
	})

	/*
	 * The pinched sheet, which is a phone in v13: the paper is drawn twice the size and
	 * slid, and `.book` — the box these coordinates are in — has not moved.
	 */
	it('follows the sheet where a pinch has left it', () => {
		const sheet = { scale: 2, x: -100, y: -50 }
		// (200, 300) at 2× is (400, 600), less the offsets: (300, 550). The selection is
		// 100 wide, so 200 on screen, and its centre is 100 further on.
		expect(at({ x: 200, y: 300, width: 100, height: 80 }, sheet)).toEqual({
			left: 400,
			top: 550 - LIFT,
		})
	})

	it('goes when the selection has been pinched off the frame', () => {
		expect(at({ x: 200, y: 300, width: 100, height: 80 }, { scale: 2, x: -1000, y: 0 })).toBeNull()
		expect(at({ x: 200, y: 300, width: 100, height: 80 }, { scale: 2, x: 0, y: 1000 })).toBeNull()
	})
})

/**
 * The row itself, in a jsdom with a `ResizeObserver` that answers the one question the
 * component asks it. Nothing here is measuring a real layout — jsdom has none — so the
 * stub states the paper's size the way a browser would have reported it.
 */
function withPaper(size: { width: number; height: number } | null) {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(private readonly callback: ResizeObserverCallback) {}
			observe(element: Element) {
				if (!size) return
				this.callback(
					[{ target: element, contentRect: size } as unknown as ResizeObserverEntry],
					this as unknown as ResizeObserver,
				)
			}
			disconnect() {}
			unobserve() {}
		},
	)
}

describe('SelectionOptions', () => {
	const props = {
		page: SQUARE_PAGE_SIZE,
		sheet: RESTING_PAGE,
		onCopy: vi.fn(),
		onDelete: vi.fn(),
	}

	it('shows nothing at all while nothing is selected', () => {
		withPaper(PAPER)
		render(<SelectionOptions {...props} selection={null} />)

		expect(screen.queryByRole('button')).toBeNull()
	})

	it('offers copy and delete over a selection, and calls through', async () => {
		withPaper(PAPER)
		const onCopy = vi.fn()
		const onDelete = vi.fn()
		render(
			<SelectionOptions
				{...props}
				selection={{ x: 200, y: 300, width: 100, height: 80 }}
				onCopy={onCopy}
				onDelete={onDelete}
			/>,
		)

		await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
		await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

		expect(onCopy).toHaveBeenCalledOnce()
		expect(onDelete).toHaveBeenCalledOnce()
	})

	/*
	 * The first paint, before anything has measured anything. It is a real moment — the
	 * observer answers a frame later — and the wrong answer to it is a row placed against
	 * a paper 0px wide, which is both buttons in the top left corner of the drawing.
	 */
	it('waits for the paper to be measured before placing anything', () => {
		withPaper(null)
		render(<SelectionOptions {...props} selection={{ x: 200, y: 300, width: 100, height: 80 }} />)

		expect(screen.queryByRole('button')).toBeNull()
	})
})

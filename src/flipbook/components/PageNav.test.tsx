import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { FlipbookEngine } from '../engine/FlipbookEngine'
// The two handles are told apart by their class, and the names are scoped.
import styles from './PageNav.module.css'
import { fractionAt, PageNav, pageAt } from './PageNav'

/** Only the methods the arrows and the scrubber call. The rest of the engine isn't in this. */
function fakeEngine() {
	return { goToPage: vi.fn(), pause: vi.fn(), togglePlay: vi.fn() } as unknown as FlipbookEngine
}

/**
 * The bar and the handle standing on it, with pointer capture stubbed — jsdom has no
 * implementation of it, and the press asks for it on the way in.
 */
function bar() {
	const track = screen.getByRole('slider', { name: 'Page' })
	track.setPointerCapture = vi.fn()

	const copies = [...track.querySelectorAll<HTMLElement>(`.${styles.handle}`)]
	const at = (lap: number) => copies.find((el) => el.style.getPropertyValue('--lap') === `${lap}`)

	return {
		track,
		copies,
		/** The copy on the bar. */
		handle: at(0) as HTMLElement,
		/** The one a lap behind it, waiting at the near door. Sweeps only. */
		behind: at(-1),
		/** And the one a lap in front, which is never on the bar at all. */
		ahead: at(1),
	}
}

/** How far along its travel the handle is drawn, 0–1. The stylesheet does the rest. */
function fraction() {
	return Number(bar().track.style.getPropertyValue('--fraction'))
}

/** And how far past the end of it, in handle-widths: 0 all the way down the bar. */
function over() {
	return Number(bar().track.style.getPropertyValue('--over'))
}

describe('PageNav', () => {
	it('turns the page in both directions', async () => {
		const engine = fakeEngine()
		render(
			<PageNav engine={engine} activePage={1} pages={3} playback="none" onScrubbing={() => {}} />,
		)

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(2)

		await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(0)
	})

	it('wraps at both ends, because playback does', async () => {
		const engine = fakeEngine()
		const { rerender } = render(
			<PageNav engine={engine} activePage={0} pages={3} playback="none" onScrubbing={() => {}} />,
		)

		await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(2)

		rerender(
			<PageNav engine={engine} activePage={2} pages={3} playback="none" onScrubbing={() => {}} />,
		)

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
		expect(engine.goToPage).toHaveBeenLastCalledWith(0)
	})

	it('takes the arrows back off the bar they stand on', async () => {
		const engine = fakeEngine()
		render(
			<PageNav engine={engine} activePage={1} pages={5} playback="none" onScrubbing={() => {}} />,
		)

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))

		// Pressing an arrow is a press on the bar unless the arrow stops it there, and
		// pressing the bar scrubs to wherever the pointer is — so without that, every
		// arrow is also a jump to whichever end the arrow happens to sit at. One call,
		// for one page: two would be the arrow's page and then the bar's.
		expect(engine.goToPage).toHaveBeenCalledTimes(1)
		expect(engine.goToPage).toHaveBeenCalledWith(2)
	})

	it('stops playback when a page is turned by hand', async () => {
		const engine = fakeEngine()
		render(
			<PageNav engine={engine} activePage={1} pages={5} playback="play" onScrubbing={() => {}} />,
		)

		await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
		expect(engine.pause).toHaveBeenCalledTimes(1)

		// The keyboard route is the same control and does the same thing.
		screen.getByRole('slider').focus()
		await userEvent.keyboard('{ArrowLeft}')
		expect(engine.pause).toHaveBeenCalledTimes(2)
	})

	it('plays when the handle is tapped rather than dragged', () => {
		const engine = fakeEngine()
		render(
			<PageNav engine={engine} activePage={1} pages={5} playback="none" onScrubbing={() => {}} />,
		)

		const { track, handle } = bar()
		fireEvent.pointerDown(handle, { clientX: 100 })
		fireEvent.lostPointerCapture(track)

		expect(engine.togglePlay).toHaveBeenCalledTimes(1)
		// Nothing else: a tap doesn't move the handle, and pausing on the way in would
		// have made the toggle on the way out start it playing again.
		expect(engine.pause).not.toHaveBeenCalled()
		expect(engine.goToPage).not.toHaveBeenCalled()
	})

	it('scrubs when the same press moves, and then plays nothing', () => {
		const engine = fakeEngine()
		const onScrubbing = vi.fn()
		render(
			<PageNav
				engine={engine}
				activePage={1}
				pages={5}
				playback="none"
				onScrubbing={onScrubbing}
			/>,
		)

		const { track, handle } = bar()
		fireEvent.pointerDown(handle, { clientX: 100 })
		// Still a tap at this distance, so nothing has started yet.
		expect(onScrubbing).not.toHaveBeenCalled()

		fireEvent.pointerMove(track, { clientX: 160 })
		expect(onScrubbing).toHaveBeenLastCalledWith(true)

		fireEvent.lostPointerCapture(track)
		expect(onScrubbing).toHaveBeenLastCalledWith(false)

		expect(engine.pause).toHaveBeenCalledTimes(1)
		expect(engine.goToPage).toHaveBeenCalled()
		expect(engine.togglePlay).not.toHaveBeenCalled()
	})

	it('sweeps the handle at a floor speed while a short flipbook plays', () => {
		const engine = fakeEngine()
		const play = (activePage: number) => (
			<PageNav
				engine={engine}
				activePage={activePage}
				pages={2}
				playback="play"
				onScrubbing={() => {}}
			/>
		)
		const { rerender } = render(play(0))

		// Two pages, so the handle was going end to end six times a second. It now takes
		// a twenty-fourth of the bar per frame instead, wherever the pages are up to.
		expect(fraction()).toBeCloseTo(0)
		rerender(play(1))
		expect(fraction()).toBeCloseTo(1 / 23)
		rerender(play(0))
		expect(fraction()).toBeCloseTo(2 / 23)

		// And a re-render that isn't a page turn doesn't move it.
		rerender(play(0))
		expect(fraction()).toBeCloseTo(2 / 23)
	})

	it('starts the sweep from wherever the page had left the handle', () => {
		const engine = fakeEngine()
		const at = (activePage: number, playback: 'none' | 'play') => (
			<PageNav
				engine={engine}
				activePage={activePage}
				pages={3}
				playback={playback}
				onScrubbing={() => {}}
			/>
		)
		const { rerender } = render(at(1, 'none'))
		expect(fraction()).toBeCloseTo(0.5)

		// Pressing play mustn't move it. The bar goes from three positions to
		// twenty-four at that moment, and the handle is on neither scale — it is
		// halfway along, and stays halfway along.
		rerender(at(1, 'play'))
		expect(fraction()).toBeCloseTo(0.5)

		rerender(at(2, 'play'))
		expect(fraction()).toBeCloseTo(0.5 + 1 / 23)
	})

	it('carries the handle out one end of the bar and its double in at the other', () => {
		const engine = fakeEngine()
		const play = (activePage: number) => (
			<PageNav
				engine={engine}
				activePage={activePage}
				pages={2}
				playback="play"
				onScrubbing={() => {}}
			/>
		)
		const { rerender } = render(play(0))

		// A page turn a frame, alternating between the flipbook's two pages.
		let frame = 0
		const tick = () => rerender(play(++frame % 2))

		// Twenty-three of them take it to the far end of its travel, the last of them
		// short by however much of a step was left rather than stepping over the end.
		for (let i = 0; i < 23; i++) tick()
		expect(fraction()).toBeCloseTo(1)
		expect(over()).toBe(0)

		// And then into the tunnel, a third of a handle-width at a time. Only two of the
		// three transit steps are positions it stands in — the third is the lap turning
		// over, below.
		for (const step of [1 / 3, 2 / 3]) {
			tick()
			expect(fraction()).toBeCloseTo(1)
			expect(over()).toBeCloseTo(step)
			expect(bar().handle.className).toContain('stepped')
		}

		// The one waiting at the near door, two thirds of a handle-width short of it.
		const arriving = bar().behind

		// Round. Every copy takes on the job of the one in front of it, which is a step
		// each and no more — so this frame slides like every other, and the handle now on
		// the bar is the very element that had spent the tunnel sliding towards the door.
		tick()
		expect(fraction()).toBe(0)
		expect(over()).toBe(0)
		expect(bar().handle).toBe(arriving)
		expect(bar().handle.className).toContain('stepped')

		// And away down the bar again on the next frame, still the same element.
		tick()
		expect(fraction()).toBeCloseTo(1 / 23)
		expect(bar().handle).toBe(arriving)
	})

	it('keeps a copy either side of the handle while a sweep is running', () => {
		const engine = fakeEngine()
		const at = (playback: 'none' | 'play' | 'circleplay') => (
			<PageNav
				engine={engine}
				activePage={1}
				pages={2}
				playback={playback}
				onScrubbing={() => {}}
			/>
		)
		const { rerender } = render(at('none'))
		expect(bar().copies).toHaveLength(1)
		const resting = bar().handle

		rerender(at('play'))
		expect(bar().copies).toHaveLength(3)
		expect(bar().behind).toBeDefined()
		expect(bar().ahead).toBeDefined()
		// And the one on the bar is still the element that was already standing there:
		// starting a sweep puts two either side of it rather than replacing it.
		expect(bar().handle).toBe(resting)

		// Circleplay is a scrub rather than a sweep: the pointer is driving the pages,
		// the handle is saying which one it landed on, and it never leaves the bar.
		rerender(at('circleplay'))
		expect(bar().copies).toHaveLength(1)
	})

	it('puts the arrows away while it plays, and both kinds of playing count', () => {
		const engine = fakeEngine()
		const at = (playback: 'none' | 'play' | 'circleplay') => (
			<PageNav
				engine={engine}
				activePage={1}
				pages={5}
				playback={playback}
				onScrubbing={() => {}}
			/>
		)
		const { rerender } = render(at('none'))
		expect(bar().track.className).not.toContain('playing')

		rerender(at('play'))
		expect(bar().track.className).toContain('playing')

		rerender(at('circleplay'))
		expect(bar().track.className).toContain('playing')

		rerender(at('none'))
		expect(bar().track.className).not.toContain('playing')
	})

	it('puts the handle back on the page when a sweep is stopped inside the tunnel', () => {
		const engine = fakeEngine()
		const at = (activePage: number, playback: 'none' | 'play') => (
			<PageNav
				engine={engine}
				activePage={activePage}
				pages={2}
				playback={playback}
				onScrubbing={() => {}}
			/>
		)
		// Starting at the far end, so the next frame is the first of the tunnel.
		const { rerender } = render(at(1, 'play'))
		expect(fraction()).toBeCloseTo(1)

		rerender(at(0, 'play'))
		expect(over()).toBeCloseTo(1 / 3)

		// Let go of it there and the handle is off the end of the bar, so it comes back
		// to the page without easing: 0.18s of swooping in from the right is not a
		// flipbook being paused, it is a handle being thrown at one.
		rerender(at(0, 'none'))
		expect(fraction()).toBe(0)
		expect(over()).toBe(0)
		expect(bar().handle.className).not.toContain('eased')

		// And easing again from the next page turn, for a drag to settle from.
		rerender(at(1, 'none'))
		expect(fraction()).toBe(1)
		expect(bar().handle.className).toContain('eased')
	})

	it('leaves a long flipbook on the page it is showing', () => {
		render(
			<PageNav
				engine={fakeEngine()}
				activePage={6}
				pages={24}
				playback="play"
				onScrubbing={() => {}}
			/>,
		)

		// At the floor and above, the handle is the page and playback changes nothing.
		expect(fraction()).toBeCloseTo(6 / 23)
	})

	it('says where in the flipbook it is', () => {
		render(
			<PageNav
				engine={fakeEngine()}
				activePage={2}
				pages={9}
				playback="none"
				onScrubbing={() => {}}
			/>,
		)

		const scrubber = screen.getByRole('slider', { name: 'Page' })
		expect(scrubber).toHaveAttribute('aria-valuenow', '3')
		expect(scrubber).toHaveAttribute('aria-valuemin', '1')
		expect(scrubber).toHaveAttribute('aria-valuemax', '9')
		expect(scrubber).toHaveAttribute('aria-valuetext', 'Page 3 of 9')
	})

	it('scrubs with the arrow keys, without needing a pointer', async () => {
		const engine = fakeEngine()
		render(
			<PageNav engine={engine} activePage={4} pages={9} playback="none" onScrubbing={() => {}} />,
		)

		screen.getByRole('slider').focus()

		await userEvent.keyboard('{ArrowRight}')
		expect(engine.goToPage).toHaveBeenLastCalledWith(5)

		await userEvent.keyboard('{ArrowDown}')
		expect(engine.goToPage).toHaveBeenLastCalledWith(3)
	})

	it('never points past the end, which a delete would', () => {
		// The arriving page is active from the first frame and the page it replaces is
		// still falling, so for 750ms the active index is past the settled count.
		render(
			<PageNav
				engine={fakeEngine()}
				activePage={1}
				pages={1}
				playback="none"
				onScrubbing={() => {}}
			/>,
		)

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

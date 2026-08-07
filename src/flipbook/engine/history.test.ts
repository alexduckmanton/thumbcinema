import { describe, expect, it } from 'vitest'

import { History, MAX_STEPS, type Op, type Step } from './history'
import type { Scene } from './scene'

/**
 * The stack, on its own.
 *
 * Everything below exercises `record`, `takeUndo` and `takeRedo`, none of which
 * touches the scene — so there isn't one. Reading and writing a page's ink needs
 * paper.js and a canvas, and is verified in the browser against real drawings; what
 * is worth testing here is the part that can be quietly wrong without looking wrong:
 * which step comes back next, and when a step stops being reachable.
 */
function stack(): History {
	return new History(undefined as unknown as Scene)
}

function step(name: string): Step {
	const op: Op = { kind: 'content', pageId: 1, ink: name }
	return { ops: [op], forward: 1, back: 1 }
}

/**
 * The `ink` of a step's first op, which is what the fixtures above label them by.
 *
 * Guarded on the kind because a `move` op carries none: reordering pages changes
 * nothing about what is drawn on any of them, so there is no state to hold.
 */
function label(taken: Step | null): string | null {
	const op = taken?.ops[0]
	return op && op.kind !== 'move' ? op.ink : null
}

describe('History', () => {
	it('has nothing to spend until something is recorded', () => {
		const history = stack()

		expect(history.canUndo).toBe(false)
		expect(history.canRedo).toBe(false)
		expect(history.takeUndo()).toBeNull()
		expect(history.takeRedo()).toBeNull()
	})

	it('hands steps back in reverse, then forwards again', () => {
		const history = stack()
		history.record(step('a'))
		history.record(step('b'))
		history.record(step('c'))

		expect(label(history.takeUndo())).toBe('c')
		expect(label(history.takeUndo())).toBe('b')
		expect(label(history.takeRedo())).toBe('b')
		expect(label(history.takeRedo())).toBe('c')
		expect(history.canRedo).toBe(false)
	})

	it('drops the redo stack the moment something new is done', () => {
		const history = stack()
		history.record(step('a'))
		history.record(step('b'))

		history.takeUndo()
		expect(history.canRedo).toBe(true)

		history.record(step('c'))
		expect(history.canRedo).toBe(false)
		expect(label(history.takeUndo())).toBe('c')
	})

	it('keeps the most recent steps and forgets the oldest', () => {
		const history = stack()
		for (let i = 0; i < MAX_STEPS + 10; i++) history.record(step(`step ${i}`))

		const taken: (string | null)[] = []
		while (history.canUndo) taken.push(label(history.takeUndo()))

		expect(taken).toHaveLength(MAX_STEPS)
		expect(taken[0]).toBe(`step ${MAX_STEPS + 9}`)
		expect(taken.at(-1)).toBe('step 10')
	})

	it('drops steps whose ink is more than it will hold', () => {
		const history = stack()

		// Two megabytes each: six of them are past the budget, so the earliest go.
		const heavy = (name: string): Step => {
			const op: Op = { kind: 'content', pageId: 1, ink: name.padEnd(2_000_000, '.') }
			return { ops: [op], forward: 1, back: 1 }
		}

		for (let i = 0; i < 10; i++) history.record(heavy(`step ${i}`))

		let held = 0
		while (history.canUndo) {
			history.takeUndo()
			held++
		}
		expect(held).toBeLessThan(10)
		expect(held).toBeGreaterThan(0)
	})

	it('forgets everything when the flipbook is replaced', () => {
		const history = stack()
		history.record(step('a'))
		history.takeUndo()

		history.clear()
		expect(history.canUndo).toBe(false)
		expect(history.canRedo).toBe(false)
	})

	it('tells whoever is drawing the buttons that something changed', () => {
		const history = stack()
		let changes = 0
		history.onChange(() => changes++)

		history.record(step('a'))
		history.takeUndo()
		history.takeRedo()
		history.clear()

		expect(changes).toBe(4)
	})
})

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

/*
 * The snapshot cache. See `History.cache`: `begin` runs inside the pointer-down
 * handler, so it takes the string `commit` made rather than serialising the page again
 * — and only for as long as nothing else can have changed the page.
 *
 * A scene of plain objects is enough here: `capture` clones each child into the
 * staging layer and asks it for JSON, and the fake counts how often it is asked.
 */
interface FakeStroke {
	id: number
	ink: string
	clone(): FakeStroke
}

function fakeScene(pages: string[][]) {
	let serialised = 0
	let nextId = 1

	const stroke = (ink: string): FakeStroke => {
		const id = nextId++
		return { id, ink, clone: () => stroke(ink) }
	}
	const layer = (inks: string[]) => ({
		children: inks.map(stroke),
		removeChildren() {
			this.children = []
		},
		addChild(child: FakeStroke) {
			this.children.push(child)
		},
	})

	const layers = pages.map(layer)
	const staging = {
		...layer([]),
		exportJSON() {
			serialised++
			return JSON.stringify(this.children.map((child) => child.ink))
		},
		importJSON(json: string) {
			this.children = (JSON.parse(json) as string[]).map(stroke)
		},
	}

	const scene = {
		pageLayer: (index: number) => layers[index],
		get pageCount() {
			return layers.length
		},
		selectionLayer: { children: [] as FakeStroke[] },
		stagingLayer: staging,
		scope: {
			Color: class {
				constructor(public value: string) {}
			},
		},
	}

	return {
		scene: scene as unknown as Scene,
		layers,
		get serialised() {
			return serialised
		},
		draw(page: number, ink: string) {
			layers[page]?.addChild(stroke(ink))
		},
	}
}

describe('the snapshot cache', () => {
	it('reads the page once per gesture, not twice', () => {
		const fake = fakeScene([['a']])
		const history = new History(fake.scene)

		history.begin(0, 1)
		fake.draw(0, 'b')
		expect(history.commit(0)).toBe(true)
		expect(fake.serialised).toBe(2)

		// The second gesture opens on the page the first one closed on.
		history.begin(0, 1)
		expect(fake.serialised).toBe(2)
		fake.draw(0, 'c')
		expect(history.commit(0)).toBe(true)
		expect(fake.serialised).toBe(3)
	})

	it('still records a gesture that opened on the cached page', () => {
		const fake = fakeScene([['a']])
		const history = new History(fake.scene)

		history.begin(0, 1)
		history.commit(0)
		history.begin(0, 1)
		fake.draw(0, 'b')

		expect(history.commit(0)).toBe(true)
		const op = history.takeUndo()?.ops[0]
		expect(op && op.kind !== 'move' ? op.ink : null).toBe(JSON.stringify(['a']))
	})

	it('reads the page again after the selection changed it', () => {
		const fake = fakeScene([['a']])
		const history = new History(fake.scene)

		history.begin(0, 1)
		history.commit(0)
		history.invalidate(0)

		history.begin(0, 1)
		expect(fake.serialised).toBe(3)
	})

	it('reads the page again after undo wrote it', () => {
		const fake = fakeScene([['a']])
		const history = new History(fake.scene)

		history.begin(0, 1)
		fake.draw(0, 'b')
		history.commit(0)

		const step = history.takeUndo()
		const op = step?.ops[0]
		if (op?.kind !== 'content') throw new Error('expected a content op')
		history.swap(0, op.ink)
		const before = fake.serialised

		history.begin(0, 1)
		expect(fake.serialised).toBe(before + 1)
	})

	it('forgets every page when the flipbook is replaced', () => {
		const fake = fakeScene([['a']])
		const history = new History(fake.scene)

		history.begin(0, 1)
		history.commit(0)
		history.clear()

		history.begin(0, 1)
		expect(fake.serialised).toBe(3)
	})

	it('keeps one entry per page', () => {
		const fake = fakeScene([['a'], ['b']])
		const history = new History(fake.scene)

		history.begin(0, 1)
		history.commit(0)
		history.begin(1, 2)
		history.commit(1)
		const before = fake.serialised

		history.begin(0, 1)
		history.begin(1, 2)
		expect(fake.serialised).toBe(before)
	})
})

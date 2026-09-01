import { describe, expect, it } from 'vitest'

import { LEGACY_PAGE_SIZE } from '../constants'
import { Scene } from '../scene'
import { Selection } from '../selection'
import { PencilTool } from './pencil'

/*
 * The pencil against a real paper.js project, for the one thing about it that can
 * only be answered by what paper writes out: a tap leaves a mark, and the mark is a
 * shape every renderer downstream agrees is a dot.
 *
 * The canvas stub is `scene.test.ts`'s, and is there for the same reason — jsdom has
 * no 2D context, paper reaches for one as it loads, and nothing here draws.
 */
function stubCanvasContext(): void {
	const absorb = () => undefined
	// biome-ignore lint/suspicious/noExplicitAny: standing in for a whole context type
	;(HTMLCanvasElement.prototype as any).getContext = function stub(this: HTMLCanvasElement) {
		const properties: Record<string, unknown> = {
			canvas: this,
			measureText: () => ({ width: 0 }),
		}
		return new Proxy(properties, {
			get: (target, key) => (key in target ? target[key as string] : absorb),
			set: (target, key, value) => {
				target[key as string] = value
				return true
			},
		})
	}
}
stubCanvasContext()

async function pencilOnAPage(): Promise<{ pencil: PencilTool; scene: Scene }> {
	const paper = (await import('paper/dist/paper-core')).default
	const canvas = document.createElement('canvas')
	document.body.append(canvas)

	const scene = new Scene(canvas, paper as never, LEGACY_PAGE_SIZE)
	const pencil = new PencilTool(scene, new Selection(scene), { interactive: false })
	pencil.init()

	return { pencil, scene }
}

function at(scene: Scene, x: number, y: number): paper.Point {
	return new scene.scope.Point(x, y)
}

function strokes(scene: Scene): paper.Path[] {
	return scene.activeLayer.children as paper.Path[]
}

describe('a press that never moves', () => {
	it('leaves a dot, not nothing', async () => {
		const { pencil, scene } = await pencilOnAPage()

		pencil.begin(at(scene, 100, 50))
		pencil.end()

		expect(strokes(scene)).toHaveLength(1)
		// Two points a hair apart, whose round caps are the dot. Not the same point
		// twice, which is the tidier shape and which Safari's canvas paints as nothing
		// at all — see `DOT_LENGTH`.
		expect(strokes(scene)[0]?.pathData).toBe('M100,50h0.01')
	})

	it('has a length, without which Safari paints no pixels at all', async () => {
		const { pencil, scene } = await pencilOnAPage()

		pencil.begin(at(scene, 100, 50))
		pencil.end()

		// Measured in WebKit: a canvas subpath of zero length with a round cap is not
		// stroked, however the specification reads. The whole of the fix is that this
		// number is not nought, and it is small enough that nothing can see it: a
		// hundredth of a unit is 0.006 CSS pixels on a phone at the stage's deepest zoom.
		const dot = strokes(scene)[0]
		expect(dot?.length).toBeGreaterThan(0)
		expect(dot?.length).toBeLessThan(0.1)
	})

	it('wears the pencil width, so a dot is as thick as a line', async () => {
		const { pencil, scene } = await pencilOnAPage()

		pencil.begin(at(scene, 12, 12))
		pencil.end()

		const dot = strokes(scene)[0]
		expect(dot?.strokeWidth).toBe(3)
		expect(dot?.strokeCap).toBe('round')
	})

	it('is one dot however many identical points the pointer reported', async () => {
		const { pencil, scene } = await pencilOnAPage()

		// Which is what a finger held still delivers: Safari withholds movement below a
		// few pixels and then reports the same point again.
		pencil.begin(at(scene, 40, 40))
		pencil.extend(at(scene, 40, 40))
		pencil.extend(at(scene, 40, 40))
		pencil.end()

		expect(strokes(scene)).toHaveLength(1)
		expect(strokes(scene)[0]?.segments).toHaveLength(2)
	})
})

describe('a saved dot', () => {
	it('is written into the file and comes back the same shape', async () => {
		const { pencil, scene } = await pencilOnAPage()

		pencil.begin(at(scene, 100, 50))
		pencil.end()

		const svg = scene.project.exportSVG({ asString: true }) as string
		expect(svg).toContain('d="M100,50h0.01"')

		// What `FlipbookEngine.buildStroke` does with it when the flipbook is opened
		// again: two points in, two points out, and nothing along the way tempted to
		// treat the shorter of the two as an empty path.
		const reopened = scene.scope.PathItem.create('M100,50h0.01') as paper.Path
		expect(reopened.segments).toHaveLength(2)
		expect(reopened.pathData).toBe('M100,50h0.01')
	})
})

describe('a stroke', () => {
	it('starts where the pointer went down rather than where it first moved', async () => {
		const { pencil, scene } = await pencilOnAPage()

		pencil.begin(at(scene, 10, 10))
		pencil.extend(at(scene, 40, 10))
		pencil.end()

		expect(strokes(scene)[0]?.firstSegment.point.x).toBe(10)
	})

	it('is still resampled to even spacing', async () => {
		const { pencil, scene } = await pencilOnAPage()

		pencil.begin(at(scene, 0, 0))
		pencil.extend(at(scene, 100, 0))
		pencil.end()

		// 100 units at FLATTEN_DISTANCE 5: twenty steps, twenty-one points.
		expect(strokes(scene)[0]?.segments).toHaveLength(21)
	})

	it('is dropped when it has no points at all', async () => {
		const { pencil, scene } = await pencilOnAPage()

		// The replay path, handed an empty stroke.
		pencil.begin()
		pencil.end()

		expect(strokes(scene)).toHaveLength(0)
	})
})

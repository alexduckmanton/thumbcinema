import { beforeAll, describe, expect, it } from 'vitest'

import { parseSvgPages } from '../engine/formats'
import {
	LEGACY_STROKE_WIDTH,
	frameAt,
	legacyPageStrokes,
	readArtwork,
	svgPageStrokes,
	toPath2D,
} from './artwork'

/**
 * jsdom has no canvas, so it has no `Path2D` either.
 *
 * Stubbed rather than skipped, because what these tests are checking is that the
 * right geometry reaches it in the right order — which is the whole of `toPath2D`'s
 * job. What a real one then draws is a browser's business and is checked by looking
 * at the gallery.
 */
class FakePath2D {
	readonly calls: string[] = []

	constructor(readonly data?: string) {
		if (data !== undefined) this.calls.push(`d(${data})`)
	}

	moveTo(x: number, y: number) {
		this.calls.push(`M${x},${y}`)
	}

	lineTo(x: number, y: number) {
		this.calls.push(`L${x},${y}`)
	}
}

beforeAll(() => {
	Object.defineProperty(globalThis, 'Path2D', { value: FakePath2D, writable: true })
})

/** A flipbook, in the shape paper writes one: three system groups, then the pages. */
function svg(...pages: string[]): string {
	return `<svg xmlns="http://www.w3.org/2000/svg"><g/><g/><g/>${pages.join('')}</svg>`
}

describe('frameAt', () => {
	it('puts the first page at the left edge and the last at the right', () => {
		expect(frameAt(0, 10)).toBe(0)
		expect(frameAt(1, 10)).toBe(9)
	})

	it('spreads the rest evenly across the width', () => {
		expect(frameAt(0.5, 11)).toBe(5)
		expect(frameAt(0.25, 5)).toBe(1)
		expect(frameAt(0.75, 5)).toBe(3)
	})

	it('clamps a pointer that has run off either end', () => {
		// A pointermove can land outside the card — the pointer leaves faster than the
		// leave event arrives, and a drag started on a card keeps reporting.
		expect(frameAt(-0.4, 8)).toBe(0)
		expect(frameAt(1.9, 8)).toBe(7)
	})

	it('has nowhere to go in a one-page flipbook', () => {
		expect(frameAt(0.5, 1)).toBe(0)
		expect(frameAt(0.5, 0)).toBe(0)
	})
})

describe('svgPageStrokes', () => {
	it("prefers a stroke's own width, then its group's, then 2", () => {
		const [page] = parseSvgPages(
			svg(
				'<g stroke-width="5">' + '<path d="M0,0" stroke-width="9"/>' + '<path d="M1,1"/>' + '</g>',
			),
		)
		const [own, inherited] = svgPageStrokes(page as never)

		expect(own?.width).toBe(9)
		expect(inherited?.width).toBe(5)

		const [bare] = parseSvgPages(svg('<g><path d="M0,0"/></g>'))
		expect(svgPageStrokes(bare as never)[0]?.width).toBe(2)
	})

	it('reads all three stroke vocabularies', () => {
		// Both formats are live: paper 0.8 wrote polyline and line and that is the whole
		// archive, paper 0.12 writes path and that is everything saved since. A reader
		// that knows one of them renders nothing at all for half the database.
		const [page] = parseSvgPages(
			svg(
				'<g stroke-width="3">' +
					'<path d="M10,10L20,20"/>' +
					'<polyline points="1,2 3,4"/>' +
					'<line x1="5" y1="6" x2="7" y2="8"/>' +
					'</g>',
			),
		)
		const strokes = svgPageStrokes(page as never)

		expect(strokes).toHaveLength(3)
		expect(strokes[0]?.geometry).toEqual({ kind: 'data', data: 'M10,10L20,20' })
		expect(strokes[1]?.geometry).toEqual({
			kind: 'points',
			points: [
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
			],
		})
		expect(strokes[2]?.geometry).toEqual({
			kind: 'points',
			points: [
				{ x: 5, y: 6 },
				{ x: 7, y: 8 },
			],
		})
	})

	it('drops what it cannot draw rather than failing the page', () => {
		const [page] = parseSvgPages(svg('<g><rect width="10" height="10"/><path d="M0,0L1,1"/></g>'))
		const strokes = svgPageStrokes(page as never)

		expect(strokes).toHaveLength(1)
		expect(strokes[0]?.geometry).toEqual({ kind: 'data', data: 'M0,0L1,1' })
	})
})

describe('legacyPageStrokes', () => {
	it('draws every 2012 stroke at the width the engine replays them at', () => {
		const strokes = legacyPageStrokes([
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
		])

		expect(strokes).toHaveLength(1)
		expect(strokes[0]?.width).toBe(LEGACY_STROKE_WIDTH)
	})
})

describe('toPath2D', () => {
	it('hands path data straight to the constructor', () => {
		const path = toPath2D({ kind: 'data', data: 'M1,2l3,4' }) as unknown as FakePath2D
		expect(path.calls).toEqual(['d(M1,2l3,4)'])
	})

	it('walks a point list, moving to the first and lining to the rest', () => {
		const path = toPath2D({
			kind: 'points',
			points: [
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
				{ x: 5, y: 6 },
			],
		}) as unknown as FakePath2D

		expect(path.calls).toEqual(['M1,2', 'L3,4', 'L5,6'])
	})

	it('leaves an empty point list empty rather than throwing', () => {
		const path = toPath2D({ kind: 'points', points: [] }) as unknown as FakePath2D
		expect(path.calls).toEqual([])
	})
})

describe('readArtwork', () => {
	it('knows how many pages there are before it has built any', () => {
		// This is what the scrub is mapped across. Counting the pages that have landed
		// instead would have a long flipbook remapping itself under a still pointer.
		const reader = readArtwork(svg('<g/>', '<g/>', '<g/>', '<g/>'), 'svg')
		expect(reader.total).toBe(4)
	})

	it('skips the three system groups', () => {
		const reader = readArtwork(svg('<g><path d="M0,0L1,1"/></g>'), 'svg')
		const pages = [...reader.pages]

		expect(pages).toHaveLength(1)
		expect(pages[0]?.strokes).toHaveLength(1)
	})

	it('reads the 2012 format too', () => {
		const legacy = JSON.stringify({
			layers: [
				{ children: [] },
				{ children: [] },
				{ children: [] },
				{
					children: [
						{
							segments: [
								{ x: '1.0', y: '2.0' },
								{ x: '3.4', y: '4.6' },
							],
						},
					],
				},
			],
		})

		const reader = readArtwork(legacy, 'legacy-json')
		expect(reader.total).toBe(1)

		const [page] = [...reader.pages]
		expect(page?.strokes).toHaveLength(1)

		const stroke = page?.strokes[0]
		expect(stroke?.width).toBe(LEGACY_STROKE_WIDTH)
		// Rounded on the way in, as the 2013 pencil rounded them.
		expect((stroke?.path as unknown as FakePath2D)?.calls).toEqual(['M1,2', 'L3,5'])
	})

	it('builds a page only when it is asked for', () => {
		// The generator is what lets the cache spend a frame at a time on a flipbook
		// that runs to nine megabytes. Taking one page must not build the rest.
		const reader = readArtwork(svg('<g><path d="M0,0"/></g>', '<g><path d="M1,1"/></g>'), 'svg')
		const iterator = reader.pages[Symbol.iterator]()

		const first = iterator.next()
		expect(first.done).toBe(false)
		expect(first.value?.strokes).toHaveLength(1)
	})
})

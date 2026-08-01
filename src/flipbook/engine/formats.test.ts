import { describe, expect, it } from 'vitest'

import {
	ArtworkError,
	assertLeadingGroups,
	LEADING_SYSTEM_GROUPS,
	parseLegacyPages,
	parseSvgPages,
	strokeWidthFor,
} from './formats'

/** A saved flipbook: three system groups, then one group per page. */
function savedSvg(pages: string[]): string {
	const system = '<g/>'.repeat(LEADING_SYSTEM_GROUPS)
	return `<svg xmlns="http://www.w3.org/2000/svg">${system}${pages.join('')}</svg>`
}

describe('parseSvgPages', () => {
	it('skips the three system groups, which is the whole archive contract', () => {
		const svg = savedSvg([
			'<g stroke-width="3"><polyline points="0,0 1,1"/></g>',
			'<g><polyline points="2,2 3,3"/><polyline points="4,4 5,5"/></g>',
		])

		const pages = parseSvgPages(svg)

		expect(pages).toHaveLength(2)
		expect(pages[0]!.strokes).toHaveLength(1)
		expect(pages[1]!.strokes).toHaveLength(2)
	})

	it('reads the group stroke-width the strokes inherit', () => {
		const pages = parseSvgPages(savedSvg(['<g stroke-width="7"><polyline/></g>']))
		expect(pages[0]!.groupStrokeWidth).toBe(7)
	})

	it('has no pages when the file holds nothing but system groups', () => {
		expect(parseSvgPages(savedSvg([]))).toEqual([])
	})

	it('ignores non-group children, so a <defs> block cannot shift the pages', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs/><g/><g/><g/><g id="page"/></svg>'

		const pages = parseSvgPages(svg)
		expect(pages).toHaveLength(1)
		expect(pages[0]!.group.getAttribute('id')).toBe('page')
	})

	it('refuses anything that is not an SVG', () => {
		expect(() => parseSvgPages('<html><body/></html>')).toThrow(ArtworkError)
		expect(() => parseSvgPages('not markup at all')).toThrow(ArtworkError)
	})
})

describe('strokeWidthFor', () => {
	const stroke = (width?: string): Element => {
		const el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
		if (width !== undefined) el.setAttribute('stroke-width', width)
		return el
	}

	it('prefers the stroke, then the group, then 2', () => {
		expect(strokeWidthFor(stroke('5'), 3)).toBe(5)
		expect(strokeWidthFor(stroke(), 3)).toBe(3)
		expect(strokeWidthFor(stroke(), null)).toBe(2)
	})

	it('falls through a width that is not a number', () => {
		expect(strokeWidthFor(stroke('none'), 3)).toBe(3)
	})
})

describe('parseLegacyPages', () => {
	const legacy = (pages: unknown[]): string =>
		JSON.stringify({
			layers: [{ children: [] }, { children: [] }, { children: [] }, ...pages],
		})

	it('skips the same three system layers as the SVG format', () => {
		const json = legacy([
			{
				children: [
					{
						segments: [
							{ x: '1.4', y: '2.6' },
							{ x: '10', y: '20' },
						],
					},
				],
			},
		])

		expect(parseLegacyPages(json)).toEqual([
			[
				[
					{ x: 1, y: 3 },
					{ x: 10, y: 20 },
				],
			],
		])
	})

	it('rounds coordinates, which arrive as strings', () => {
		const json = legacy([
			{
				children: [
					{
						segments: [
							{ x: '466.7', y: '83.2' },
							{ x: '1', y: '1' },
						],
					},
				],
			},
		])
		expect(parseLegacyPages(json)[0]![0]![0]).toEqual({ x: 467, y: 83 })
	})

	it('keeps blank pages, which are real pages in a flipbook', () => {
		const json = legacy([{ children: [] }, { children: [] }])
		expect(parseLegacyPages(json)).toEqual([[], []])
	})

	it('drops a stroke of a single point — there is no line in it', () => {
		const json = legacy([{ children: [{ segments: [{ x: '1', y: '1' }] }] }])
		expect(parseLegacyPages(json)).toEqual([[]])
	})

	it('rejects a file with no layers rather than rendering nothing', () => {
		expect(() => parseLegacyPages('{}')).toThrow(ArtworkError)
		expect(() => parseLegacyPages('{{{')).toThrow(ArtworkError)
	})
})

describe('assertLeadingGroups', () => {
	const svg = (groups: number): SVGElement => {
		const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
		for (let i = 0; i < groups; i++) {
			el.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'))
		}
		return el
	}

	it('passes when every layer produced a group', () => {
		expect(() => assertLeadingGroups(svg(LEADING_SYSTEM_GROUPS + 4), 4)).not.toThrow()
	})

	it('catches a short export before it is saved and shifts every page', () => {
		expect(() => assertLeadingGroups(svg(4), 4)).toThrow(ArtworkError)
	})
})

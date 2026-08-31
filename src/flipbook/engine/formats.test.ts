import { describe, expect, it } from 'vitest'

import { LEGACY_PAGE_SIZE } from './constants'
import {
	ArtworkError,
	assertLeadingGroups,
	LEADING_SYSTEM_GROUPS,
	pageSizeFromSvg,
	parseLegacyPages,
	parseSvgPages,
	strokeGeometry,
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

describe('strokeGeometry', () => {
	const element = (tag: string, attributes: Record<string, string> = {}): Element => {
		const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
		for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
		return el
	}

	it('reads a polyline, which is every flipbook in the archive', () => {
		const geometry = strokeGeometry(element('polyline', { points: '355,88 350.5,88 345,90.25' }))

		expect(geometry).toEqual({
			kind: 'points',
			points: [
				{ x: 355, y: 88 },
				{ x: 350.5, y: 88 },
				{ x: 345, y: 90.25 },
			],
		})
	})

	it('reads path data, which is every flipbook saved since the rewrite', () => {
		const geometry = strokeGeometry(element('path', { d: 'M203,152l4,2.875l4,2.875' }))
		expect(geometry).toEqual({ kind: 'data', data: 'M203,152l4,2.875l4,2.875' })
	})

	it('reads a line as the two-point path it is', () => {
		const geometry = strokeGeometry(element('line', { x1: '1', y1: '2', x2: '3', y2: '4' }))

		expect(geometry).toEqual({
			kind: 'points',
			points: [
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
			],
		})
	})

	it('takes a missing line coordinate as zero, as SVG does', () => {
		expect(strokeGeometry(element('line', { x2: '3', y2: '4' }))).toEqual({
			kind: 'points',
			points: [
				{ x: 0, y: 0 },
				{ x: 3, y: 4 },
			],
		})
	})

	it('separates coordinates on whitespace as readily as on commas', () => {
		expect(strokeGeometry(element('polyline', { points: '1 2 3 4' }))).toEqual({
			kind: 'points',
			points: [
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
			],
		})
	})

	it('drops a trailing coordinate with no partner', () => {
		expect(strokeGeometry(element('polyline', { points: '1,2 3' }))).toEqual({
			kind: 'points',
			points: [{ x: 1, y: 2 }],
		})
	})

	it('has nothing to say about an empty or absent points list', () => {
		expect(strokeGeometry(element('polyline', { points: '' }))).toEqual({
			kind: 'points',
			points: [],
		})
		expect(strokeGeometry(element('polyline'))).toEqual({ kind: 'points', points: [] })
	})

	/**
	 * The loader falls back to `importSVG` on a null, so an element neither format
	 * has ever contained still renders — slowly, rather than not at all.
	 */
	it('declines anything that is not one of the three, rather than guessing', () => {
		expect(strokeGeometry(element('rect', { width: '10', height: '10' }))).toBeNull()
		expect(strokeGeometry(element('circle'))).toBeNull()
		expect(strokeGeometry(element('g'))).toBeNull()
		expect(strokeGeometry(element('path'))).toBeNull()
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

/*
 * What shape a file says it is.
 *
 * The single rule the whole two-aspect-ratio change rests on: **no viewBox means
 * 640×360**. paper 0.8 wrote none, so every archive row is silent and every one of them
 * is that shape; paper 0.12 states all three attributes. `lib/thumbnail.js` holds the
 * server's copy of this function and has to agree with it row for row — the column it
 * writes is what a card is laid out against, and this is what the drawing is scaled by.
 */
describe('pageSizeFromSvg', () => {
	it('reads the viewBox paper 0.12 writes', () => {
		expect(
			pageSizeFromSvg('<svg width="640" height="640" viewBox="0,0,640,640"><g/></svg>'),
		).toEqual({ width: 640, height: 640 })
	})

	it('is the legacy page for the archive, which states nothing at all', () => {
		// The exact root paper 0.8 wrote, and all 585 archive rows begin with it.
		expect(pageSizeFromSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/><g/><g/></svg>')).toEqual(
			LEGACY_PAGE_SIZE,
		)
	})

	it('takes either separator, because paper has written both', () => {
		expect(pageSizeFromSvg('<svg viewBox="0 0 640 360"/>')).toEqual({ width: 640, height: 360 })
		expect(pageSizeFromSvg('<svg viewBox="0,0,640,360"/>')).toEqual({ width: 640, height: 360 })
		expect(pageSizeFromSvg('<svg viewBox=" 0 , 0 , 640 , 640 "/>')).toEqual({
			width: 640,
			height: 640,
		})
	})

	it('ignores width and height when a viewBox says otherwise', () => {
		// Those two are a display size; the viewBox is the space the coordinates are in,
		// and the coordinates are the only thing that has to be got right.
		expect(pageSizeFromSvg('<svg width="320" height="180" viewBox="0,0,640,640"/>')).toEqual({
			width: 640,
			height: 640,
		})
	})

	it('falls back rather than throwing on anything malformed', () => {
		// A flipbook that renders at the wrong shape is recoverable; one that refuses to
		// open is somebody's drawing gone. Every one of these is the legacy page.
		for (const bad of [
			'',
			'not svg at all',
			'<svg viewBox=""/>',
			'<svg viewBox="0 0 640"/>',
			'<svg viewBox="0 0 0 360"/>',
			'<svg viewBox="0 0 -640 360"/>',
			'<svg viewBox="a b c d"/>',
		]) {
			expect(pageSizeFromSvg(bad)).toEqual(LEGACY_PAGE_SIZE)
		}
	})

	it('does not mistake a viewBox further down the document for the root’s', () => {
		// A nested <svg> is not something this tool writes, but "the first viewBox in the
		// file" would be a quietly wrong rule to rely on if it ever did.
		expect(pageSizeFromSvg('<svg viewBox="0,0,640,640"><svg viewBox="0,0,10,10"/></svg>')).toEqual({
			width: 640,
			height: 640,
		})
	})
})

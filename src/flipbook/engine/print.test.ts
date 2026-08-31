import { describe, expect, it } from 'vitest'

import { LEGACY_PAGE_SIZE, SQUARE_PAGE_SIZE } from './constants'
import { LEADING_SYSTEM_GROUPS } from './formats'
import { buildPrintSheets, columnX, perSheet, PRINT, rowsPerSheet, rowY } from './print'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The legacy page: 21 to a sheet, which is the layout every number here was set by. */
const PAGE = LEGACY_PAGE_SIZE

/** A paper.js-shaped export: three system groups, then one group per page. */
function exported(pageCount: number): SVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg')

	for (let i = 0; i < LEADING_SYSTEM_GROUPS; i++) {
		svg.appendChild(document.createElementNS(SVG_NS, 'g'))
	}

	for (let i = 0; i < pageCount; i++) {
		const group = document.createElementNS(SVG_NS, 'g')
		group.setAttribute('id', `page-${i}`)
		if (i > 0) group.setAttribute('visibility', 'hidden')
		group.appendChild(document.createElementNS(SVG_NS, 'polyline'))
		svg.appendChild(group)
	}

	return svg
}

const pagesIn = (sheet: SVGElement) =>
	[...sheet.children].filter((el) => el.tagName.toLowerCase() === 'g')

describe('buildPrintSheets', () => {
	it('skips the system groups and keeps every page', () => {
		const [sheet] = buildPrintSheets(exported(5), PAGE)

		expect(sheet).toBeDefined()
		expect(pagesIn(sheet!).map((g) => g.getAttribute('id'))).toEqual([
			'page-0',
			'page-1',
			'page-2',
			'page-3',
			'page-4',
		])
	})

	it('breaks into sheets of twenty-one', () => {
		const sheets = buildPrintSheets(exported(45), PAGE)

		expect(sheets).toHaveLength(3)
		expect(pagesIn(sheets[0]!)).toHaveLength(21)
		expect(pagesIn(sheets[1]!)).toHaveLength(21)
		expect(pagesIn(sheets[2]!)).toHaveLength(3)
	})

	it('is empty for a flipbook with no pages rather than emitting a blank sheet', () => {
		expect(buildPrintSheets(exported(0), PAGE)).toEqual([])
	})

	it('lays pages out in rows of three', () => {
		const [sheet] = buildPrintSheets(exported(4), PAGE)
		const [first, second, third, fourth] = pagesIn(sheet!)

		const transform = (el: Element | undefined) => el?.getAttribute('transform')

		expect(transform(first)).toBe(
			`translate(${columnX(0, PAGE)},${rowY(0, PAGE)}),scale(0.25,0.25)`,
		)
		expect(transform(second)).toBe(
			`translate(${columnX(1, PAGE)},${rowY(0, PAGE)}),scale(0.25,0.25)`,
		)
		expect(transform(third)).toBe(
			`translate(${columnX(2, PAGE)},${rowY(0, PAGE)}),scale(0.25,0.25)`,
		)
		// Fourth wraps to the next row, back in the first column.
		expect(transform(fourth)).toBe(
			`translate(${columnX(0, PAGE)},${rowY(1, PAGE)}),scale(0.25,0.25)`,
		)
	})

	it('leaves a staple margin down the left of every page', () => {
		// The cut line starts a spine's width left of the drawing, which is the strip
		// you staple through.
		expect(columnX(0, PAGE) - PRINT.margin / 2 - PRINT.spineMargin).toBeLessThan(columnX(0, PAGE))
		expect(columnX(1, PAGE) - columnX(0, PAGE)).toBe(160 + PRINT.margin + PRINT.spineMargin)
	})

	it('unhides every page — on paper they are all on the sheet at once', () => {
		const [sheet] = buildPrintSheets(exported(4), PAGE)
		expect(pagesIn(sheet!).some((g) => g.hasAttribute('visibility'))).toBe(false)
	})

	it('drops the onion skin, which is a drawing aid rather than part of the flipbook', () => {
		const svg = exported(2)
		const onion = [...svg.children].filter((el) => el.tagName.toLowerCase() === 'g')[
			LEADING_SYSTEM_GROUPS
		]!
		onion.setAttribute('opacity', '0.1')

		const [sheet] = buildPrintSheets(svg, PAGE)
		expect(pagesIn(sheet!)[0]!.hasAttribute('opacity')).toBe(false)
	})

	it('clips each page to its own frame, from one shared definition', () => {
		const [sheet] = buildPrintSheets(exported(6), PAGE)

		const clips = sheet!.querySelectorAll('clipPath')
		expect(clips).toHaveLength(1)

		for (const page of pagesIn(sheet!)) {
			expect(page.getAttribute('clip-path')).toBe(`url(#${clips[0]!.id})`)
		}
	})

	it('gives every page a cut line', () => {
		const [sheet] = buildPrintSheets(exported(7), PAGE)
		expect(sheet!.querySelectorAll('rect[stroke]')).toHaveLength(7)
	})

	it('does not modify the flipbook it was given', () => {
		const svg = exported(3)
		const before = svg.outerHTML

		buildPrintSheets(svg, PAGE)
		expect(svg.outerHTML).toBe(before)
	})

	it('still breaks the legacy page into sheets of twenty-one', () => {
		// The 2013 number, and now a derived one — so it is asserted rather than assumed.
		// `rowsPerSheet` explains why it is a ceiling and what rounding would have cost.
		expect(perSheet(PAGE)).toBe(21)
		expect(rowsPerSheet(PAGE)).toBe(7)
	})
})

/*
 * A square page prints twelve to a sheet rather than twenty-one.
 *
 * Keeping the count instead would put four rows of a taller page on a sheet nearly twice
 * as tall as it is wide, which the browser then shrinks to fit the paper — the same
 * booklet, printed smaller, for no reason anybody asked for. Twelve keeps the sheet the
 * shape it has always been, and so keeps a printed page the size it has always been.
 */
describe('printing a square flipbook', () => {
	const SQUARE = SQUARE_PAGE_SIZE

	it('fits twelve to a sheet', () => {
		expect(perSheet(SQUARE)).toBe(12)
		expect(buildPrintSheets(exported(25), SQUARE)).toHaveLength(3)
	})

	it('keeps the sheet roughly the shape the legacy one is', () => {
		const shape = (page: typeof SQUARE) =>
			(columnX(PRINT.columns - 1, page) + page.width * PRINT.scale + PRINT.margin / 2) /
			rowY(rowsPerSheet(page), page)

		// Within a tenth of each other, which is what "the same booklet" means here.
		expect(shape(SQUARE)).toBeCloseTo(shape(PAGE), 1)
	})

	it('lays a square page out in rows of three, at its own row height', () => {
		const [sheet] = buildPrintSheets(exported(4), SQUARE)
		const transform = (el: Element | undefined) => el?.getAttribute('transform')
		const [first, , , fourth] = pagesIn(sheet!)

		expect(transform(first)).toBe(
			`translate(${columnX(0, SQUARE)},${rowY(0, SQUARE)}),scale(0.25,0.25)`,
		)
		// The fourth wraps, and lands a *square* row down rather than a 16:9 one.
		expect(transform(fourth)).toBe(
			`translate(${columnX(0, SQUARE)},${rowY(1, SQUARE)}),scale(0.25,0.25)`,
		)
		expect(rowY(1, SQUARE)).toBeGreaterThan(rowY(1, PAGE))
	})

	it('clips each page to its own frame rather than to the legacy one', () => {
		const [sheet] = buildPrintSheets(exported(2), SQUARE)
		const mask = sheet!.querySelector('clipPath rect')

		expect(mask?.getAttribute('width')).toBe(String(SQUARE.width))
		expect(mask?.getAttribute('height')).toBe(String(SQUARE.height))
	})
})

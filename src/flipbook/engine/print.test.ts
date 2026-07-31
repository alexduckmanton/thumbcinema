import { describe, expect, it } from 'vitest'

import { LEADING_SYSTEM_GROUPS } from './formats'
import { buildPrintSheets, columnX, PRINT, rowY } from './print'

const SVG_NS = 'http://www.w3.org/2000/svg'

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
		const [sheet] = buildPrintSheets(exported(5))

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
		const sheets = buildPrintSheets(exported(45))

		expect(sheets).toHaveLength(3)
		expect(pagesIn(sheets[0]!)).toHaveLength(21)
		expect(pagesIn(sheets[1]!)).toHaveLength(21)
		expect(pagesIn(sheets[2]!)).toHaveLength(3)
	})

	it('is empty for a flipbook with no pages rather than emitting a blank sheet', () => {
		expect(buildPrintSheets(exported(0))).toEqual([])
	})

	it('lays pages out in rows of three', () => {
		const [sheet] = buildPrintSheets(exported(4))
		const [first, second, third, fourth] = pagesIn(sheet!)

		const transform = (el: Element | undefined) => el?.getAttribute('transform')

		expect(transform(first)).toBe(`translate(${columnX(0)},${rowY(0)}),scale(0.25,0.25)`)
		expect(transform(second)).toBe(`translate(${columnX(1)},${rowY(0)}),scale(0.25,0.25)`)
		expect(transform(third)).toBe(`translate(${columnX(2)},${rowY(0)}),scale(0.25,0.25)`)
		// Fourth wraps to the next row, back in the first column.
		expect(transform(fourth)).toBe(`translate(${columnX(0)},${rowY(1)}),scale(0.25,0.25)`)
	})

	it('leaves a staple margin down the left of every page', () => {
		// The cut line starts a spine's width left of the drawing, which is the strip
		// you staple through.
		expect(columnX(0) - PRINT.margin / 2 - PRINT.spineMargin).toBeLessThan(columnX(0))
		expect(columnX(1) - columnX(0)).toBe(160 + PRINT.margin + PRINT.spineMargin)
	})

	it('unhides every page — on paper they are all on the sheet at once', () => {
		const [sheet] = buildPrintSheets(exported(4))
		expect(pagesIn(sheet!).some((g) => g.hasAttribute('visibility'))).toBe(false)
	})

	it('drops the onion skin, which is a drawing aid rather than part of the flipbook', () => {
		const svg = exported(2)
		const onion = [...svg.children].filter((el) => el.tagName.toLowerCase() === 'g')[
			LEADING_SYSTEM_GROUPS
		]!
		onion.setAttribute('opacity', '0.1')

		const [sheet] = buildPrintSheets(svg)
		expect(pagesIn(sheet!)[0]!.hasAttribute('opacity')).toBe(false)
	})

	it('clips each page to its own frame, from one shared definition', () => {
		const [sheet] = buildPrintSheets(exported(6))

		const clips = sheet!.querySelectorAll('clipPath')
		expect(clips).toHaveLength(1)

		for (const page of pagesIn(sheet!)) {
			expect(page.getAttribute('clip-path')).toBe(`url(#${clips[0]!.id})`)
		}
	})

	it('gives every page a cut line', () => {
		const [sheet] = buildPrintSheets(exported(7))
		expect(sheet!.querySelectorAll('rect[stroke]')).toHaveLength(7)
	})

	it('does not modify the flipbook it was given', () => {
		const svg = exported(3)
		const before = svg.outerHTML

		buildPrintSheets(svg)
		expect(svg.outerHTML).toBe(before)
	})
})

/**
 * Turning a flipbook into something you can print, cut up and staple.
 *
 * Pages are laid out at quarter size in a three-column grid, twenty-one to a sheet,
 * each with a cut line round it and a wide margin down its left-hand side for the
 * staples. It is the same layout the 2013 print tool produced.
 *
 * Rewritten against the DOM directly rather than through svg.js, which was a
 * dependency this used and nothing else did. Everything here is a pure function of
 * an SVG element, so the arithmetic can be tested without a printer.
 */

import { LEADING_SYSTEM_GROUPS } from './formats'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const PRINT = {
	/** Pages per printed sheet: 3 across, 7 down. */
	perSheet: 21,
	columns: 3,
	/** Gap between cut lines. */
	margin: 10,
	/** The bit you staple through, down the left of each page. */
	spineMargin: 40,
	scale: 0.25,
	pageWidth: 640,
	pageHeight: 360,
} as const

const scaledWidth = PRINT.pageWidth * PRINT.scale
const scaledHeight = PRINT.pageHeight * PRINT.scale

/** Left edge of column `column`, in sheet coordinates. */
export function columnX(column: number): number {
	return column * (scaledWidth + PRINT.margin + PRINT.spineMargin) + PRINT.spineMargin
}

/** Top edge of row `row`. */
export function rowY(row: number): number {
	return row * (scaledHeight + PRINT.margin)
}

export const SHEET_WIDTH = columnX(PRINT.columns - 1) + scaledWidth + PRINT.margin / 2
export const SHEET_HEIGHT = rowY(Math.ceil(PRINT.perSheet / PRINT.columns))

/**
 * Splits a saved flipbook into printable sheets.
 *
 * `source` is a paper.js export, so the first three groups are the scaffolding
 * layers and the rest are pages — the same contract the loader relies on.
 */
export function buildPrintSheets(source: SVGElement): SVGElement[] {
	const groups = [...source.children].filter((el) => el.tagName.toLowerCase() === 'g')
	const pages = groups.slice(LEADING_SYSTEM_GROUPS)

	const sheets: SVGElement[] = []
	for (let start = 0; start < pages.length; start += PRINT.perSheet) {
		sheets.push(buildSheet(pages.slice(start, start + PRINT.perSheet)))
	}
	return sheets
}

function buildSheet(pages: Element[]): SVGElement {
	const sheet = document.createElementNS(SVG_NS, 'svg')
	sheet.setAttribute('xmlns', SVG_NS)
	sheet.setAttribute('width', String(SHEET_WIDTH))
	sheet.setAttribute('height', String(SHEET_HEIGHT))
	// Half a margin of breathing room so the top and left cut lines aren't clipped.
	sheet.setAttribute(
		'viewBox',
		`${-PRINT.margin / 2} ${-PRINT.margin / 2} ${SHEET_WIDTH} ${SHEET_HEIGHT}`,
	)

	// One clip path for the whole sheet. The 2013 version made one per page, which
	// on a 200-page flipbook meant 200 identical definitions.
	const clipId = 'tc-page-clip'
	const defs = document.createElementNS(SVG_NS, 'defs')
	const clip = document.createElementNS(SVG_NS, 'clipPath')
	clip.setAttribute('id', clipId)

	const mask = document.createElementNS(SVG_NS, 'rect')
	mask.setAttribute('width', String(PRINT.pageWidth))
	mask.setAttribute('height', String(PRINT.pageHeight))
	clip.appendChild(mask)
	defs.appendChild(clip)
	sheet.appendChild(defs)

	pages.forEach((page, index) => {
		const column = index % PRINT.columns
		const row = Math.floor(index / PRINT.columns)
		const x = columnX(column)
		const y = rowY(row)

		// The cut line goes down first so the drawing sits on top of it.
		const outline = document.createElementNS(SVG_NS, 'rect')
		outline.setAttribute('x', String(x - PRINT.margin / 2 - PRINT.spineMargin))
		outline.setAttribute('y', String(y - PRINT.margin / 2))
		outline.setAttribute('width', String(scaledWidth + PRINT.margin + PRINT.spineMargin))
		outline.setAttribute('height', String(scaledHeight + PRINT.margin))
		outline.setAttribute('stroke', '#ccc')
		outline.setAttribute('stroke-width', '1')
		outline.setAttribute('fill', 'none')
		sheet.appendChild(outline)

		const copy = page.cloneNode(true) as Element
		copy.setAttribute('transform', `translate(${x},${y}),scale(${PRINT.scale},${PRINT.scale})`)
		copy.setAttribute('clip-path', `url(#${clipId})`)

		// Hidden pages are hidden because they aren't the one on screen, which means
		// nothing on paper — every page is on this sheet.
		copy.removeAttribute('visibility')
		// The onion skin is a drawing aid, not part of the flipbook.
		if (copy.getAttribute('opacity') === '0.1') copy.removeAttribute('opacity')

		sheet.appendChild(copy)
	})

	return sheet
}

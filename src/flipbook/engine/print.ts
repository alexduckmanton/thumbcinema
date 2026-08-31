/**
 * Turning a flipbook into something you can print, cut up and staple.
 *
 * Pages are laid out at quarter size in a three-column grid, each with a cut line round
 * it and a wide margin down its left-hand side for the staples. It is the same layout
 * the 2013 print tool produced — twenty-one to a sheet on a 16:9 page, and see
 * `rowsPerSheet` for why a square one gets twelve instead.
 *
 * Rewritten against the DOM directly rather than through svg.js, which was a
 * dependency this used and nothing else did. Everything here is a pure function of
 * an SVG element, so the arithmetic can be tested without a printer.
 */

import type { PageSize } from './constants'
import { LEADING_SYSTEM_GROUPS } from './formats'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const PRINT = {
	columns: 3,
	/** Gap between cut lines. */
	margin: 10,
	/** The bit you staple through, down the left of each page. */
	spineMargin: 40,
	scale: 0.25,
} as const

/**
 * How many rows fit on a sheet, which is the one number a page's shape decides.
 *
 * 2013 printed 21 to a sheet — 3 across, 7 down — and that is what three columns of
 * 16:9 pages comes to when the sheet is about as tall as it is wide. Keeping the count
 * rather than the proportion would print a square flipbook on a sheet nearly twice as
 * tall as it is wide, which the browser then shrinks to fit the paper: the same
 * booklet, printed smaller, for no reason anybody asked for. So the rows are derived
 * and a square page gets four of them, which lands the sheet back where it was and
 * keeps a printed page the size it has always been.
 */
export function rowsPerSheet(page: PageSize): number {
	// Ceiling rather than rounding, and it is the legacy page that settles which:
	// three columns come to 625 across and a 16:9 row is 100 tall, so rounding gives
	// six rows and eighteen to a sheet — quietly reprinting the 2013 booklet with
	// three pages missing off every sheet. The ceiling gives back exactly the seven
	// rows and twenty-one pages it has always produced, and four rows for a square.
	return Math.max(1, Math.ceil(sheetSpan(page) / (page.height * PRINT.scale + PRINT.margin)))
}

/** Pages on one sheet, for a page of this shape. 21 for the legacy page, 12 for a square. */
export function perSheet(page: PageSize): number {
	return PRINT.columns * rowsPerSheet(page)
}

/** How wide a sheet is, which is the columns and nothing else. */
function sheetSpan(page: PageSize): number {
	return columnX(PRINT.columns - 1, page) + page.width * PRINT.scale + PRINT.margin / 2
}

/** Left edge of column `column`, in sheet coordinates. */
export function columnX(column: number, page: PageSize): number {
	return column * (page.width * PRINT.scale + PRINT.margin + PRINT.spineMargin) + PRINT.spineMargin
}

/** Top edge of row `row`. */
export function rowY(row: number, page: PageSize): number {
	return row * (page.height * PRINT.scale + PRINT.margin)
}

export function sheetWidth(page: PageSize): number {
	return sheetSpan(page)
}

export function sheetHeight(page: PageSize): number {
	return rowY(rowsPerSheet(page), page)
}

/**
 * Splits a saved flipbook into printable sheets.
 *
 * `source` is a paper.js export, so the first three groups are the scaffolding
 * layers and the rest are pages — the same contract the loader relies on.
 */
export function buildPrintSheets(source: SVGElement, page: PageSize): SVGElement[] {
	const groups = [...source.children].filter((el) => el.tagName.toLowerCase() === 'g')
	const pages = groups.slice(LEADING_SYSTEM_GROUPS)

	const step = perSheet(page)
	const sheets: SVGElement[] = []
	for (let start = 0; start < pages.length; start += step) {
		sheets.push(buildSheet(pages.slice(start, start + step), page))
	}
	return sheets
}

function buildSheet(pages: Element[], page: PageSize): SVGElement {
	const width = sheetWidth(page)
	const height = sheetHeight(page)
	const scaledWidth = page.width * PRINT.scale
	const scaledHeight = page.height * PRINT.scale
	const sheet = document.createElementNS(SVG_NS, 'svg')
	sheet.setAttribute('xmlns', SVG_NS)
	sheet.setAttribute('width', String(width))
	sheet.setAttribute('height', String(height))
	// Half a margin of breathing room so the top and left cut lines aren't clipped.
	sheet.setAttribute('viewBox', `${-PRINT.margin / 2} ${-PRINT.margin / 2} ${width} ${height}`)

	// One clip path for the whole sheet. The 2013 version made one per page, which
	// on a 200-page flipbook meant 200 identical definitions.
	const clipId = 'tc-page-clip'
	const defs = document.createElementNS(SVG_NS, 'defs')
	const clip = document.createElementNS(SVG_NS, 'clipPath')
	clip.setAttribute('id', clipId)

	const mask = document.createElementNS(SVG_NS, 'rect')
	mask.setAttribute('width', String(page.width))
	mask.setAttribute('height', String(page.height))
	clip.appendChild(mask)
	defs.appendChild(clip)
	sheet.appendChild(defs)

	pages.forEach((child, index) => {
		const column = index % PRINT.columns
		const row = Math.floor(index / PRINT.columns)
		const x = columnX(column, page)
		const y = rowY(row, page)

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

		const copy = child.cloneNode(true) as Element
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

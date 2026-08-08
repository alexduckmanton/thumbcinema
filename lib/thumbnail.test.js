import { describe, expect, it } from 'vitest';

import { busiestPage, coverSvg } from './thumbnail.js';

const ROOT =
	'<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
	' width="640" height="360" viewBox="0,0,640,360">';

/**
 * What paper 0.8 wrote, which is all 438 SVG-format archive rows: the namespace and
 * nothing else — no viewBox, no width, no height. Kept as its own fixture because a
 * suite that only ever states the 0.12 root is a suite that cannot see the archive,
 * and that is exactly how a dimensionless thumbnail reached 400 rows.
 */
const ARCHIVE_ROOT = '<svg xmlns="http://www.w3.org/2000/svg">';

/** The three paper writes before any page: selection, guide, staging. */
const SYSTEM = '<g fill="none" stroke="none"/>'.repeat(3);

const PAGE_STYLE =
	'fill="none" stroke="#444444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';

function file(...pages) {
	return `${ROOT}${SYSTEM}${pages.join('')}</svg>`;
}

/** A page in paper 0.12's vocabulary. */
function page(strokes, extra = '') {
	const paths = strokes
		.map((d, i) => `<path d="${d}" id="${i}_${i} 1"/>`)
		.join('');
	return `<g ${PAGE_STYLE}${extra ? ` ${extra}` : ''}>${paths}</g>`;
}

describe('busiestPage', () => {
	it('is the page with the most ink on it, not the first', () => {
		const svg = file(
			page(['M1,1l2,2']),
			page(['M1,1l2,2l3,3l4,4l5,5', 'M9,9l8,8l7,7']),
			page(['M4,4l1,1']),
		);

		expect(busiestPage(svg)).toBe(1);
	});

	it('skips the three system layers when numbering pages', () => {
		// The busiest group in the whole document is a system layer, and it is not a page.
		const svg = `${ROOT}<g fill="none" stroke="none"><path d="M1,1l2,2l3,3l4,4l5,5l6,6"/></g>` +
			'<g fill="none" stroke="none"/><g fill="none" stroke="none"/>' +
			`${page(['M1,1l2,2'])}${page(['M1,1l2,2l3,3'])}</svg>`;

		expect(busiestPage(svg)).toBe(1);
	});

	it('is null when there are no pages at all', () => {
		expect(busiestPage(`${ROOT}${SYSTEM}</svg>`)).toBe(null);
		expect(busiestPage('not an svg')).toBe(null);
	});
});

describe('coverSvg', () => {
	it('lifts one page out as a document in its own right', () => {
		const svg = file(page(['M1,1l2,2']), page(['M5,5l6,6']));
		const cover = coverSvg(svg, { page: 1 });

		expect(cover.page).toBe(1);
		expect(cover.svg).toContain('viewBox="0,0,640,360"');
		expect(cover.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(cover.svg).toContain('M5,5l6,6');
		// One page, and only that page.
		expect(cover.svg).not.toContain('M1,1l2,2');
		expect(cover.svg.match(/<g/g)).toHaveLength(1);
	});

	it('keeps the paint the page group carries, which is what makes it renderable', () => {
		const cover = coverSvg(file(page(['M1,1l2,2'])), {});

		expect(cover.svg).toContain('stroke="#444444"');
		expect(cover.svg).toContain('stroke-width="3"');
		expect(cover.svg).toContain('stroke-linecap="round"');
		expect(cover.svg).toContain('fill="none"');
	});

	it('reads the 2013 vocabulary too', () => {
		const svg =
			`${ROOT}${SYSTEM}` +
			'<g fill="none" stroke="rgb(68, 68, 68)" stroke-width="10" stroke-linecap="round">' +
			'<polyline points="453,189 448.9,187 444.0,187" id="19691_19709 1"/>' +
			'<line x1="1" y1="2" x2="3" y2="4"/></g></svg>';

		const cover = coverSvg(svg, {});
		expect(cover.svg).toContain('stroke="rgb(68, 68, 68)"');
		expect(cover.svg).toContain('points="453,189 448.9,187 444.0,187"');
		expect(cover.svg).toContain('<line x1="1"');
	});

	it('drops the visibility every page but the last one saved is wearing', () => {
		const cover = coverSvg(file(page(['M1,1l2,2'], 'visibility="hidden"')), {});

		expect(cover.svg).not.toContain('visibility');
		expect(cover.svg).toContain('M1,1l2,2');
	});

	it('drops the onion skin\'s opacity, which the cover page can be wearing', () => {
		// The onion is a real page layer and it is live when the file is written, so
		// the busiest page is sometimes the one ghosted behind the page being drawn on.
		const cover = coverSvg(file(page(['M1,1l2,2'], 'opacity="0.1"')), {});

		expect(cover.svg).not.toContain('opacity');
	});

	it('drops the stroke ids, which nothing reads', () => {
		const cover = coverSvg(file(page(['M1,1l2,2', 'M3,3l4,4'])), {});

		expect(cover.svg).not.toContain('id=');
		expect(cover.svg).toContain('<path d="M1,1l2,2"/>');
	});

	it('falls back to the busiest page when asked for one that is not there', () => {
		const svg = file(page(['M1,1l2,2']), page(['M1,1l2,2l3,3l4,4']));

		expect(coverSvg(svg, { page: 9 }).page).toBe(1);
		expect(coverSvg(svg, { page: -1 }).page).toBe(1);
		expect(coverSvg(svg, { page: null }).page).toBe(1);
	});

	it('adds the namespace when the file has not got one', () => {
		const svg = '<svg width="640" height="360" viewBox="0,0,640,360">' +
			`${SYSTEM}${page(['M1,1l2,2'])}</svg>`;

		expect(coverSvg(svg, {}).svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	// The archive's root has no viewBox on it, and without one the result has no
	// intrinsic size: an `<img>` gives a dimensionless SVG the 300x150 default, draws
	// the page 1:1 into it and crops the rest. Every one of these renders wrong on a
	// card while the flipbook itself plays perfectly, because only the card asks the
	// file how big it is.
	it('states a viewBox when the artwork has not got one, as the whole archive has not', () => {
		const svg = `${ARCHIVE_ROOT}${SYSTEM}${page(['M1,1l2,2'])}</svg>`;
		const cover = coverSvg(svg, {}).svg;

		expect(cover).toContain('viewBox="0,0,640,360"');
		// and an intrinsic size with it, so an archive card measures as a modern one does
		expect(cover).toContain('width="640"');
		expect(cover).toContain('height="360"');
	});

	it('leaves the artwork with its own viewBox alone rather than restating it', () => {
		const cover = coverSvg(file(page(['M1,1l2,2'])), {}).svg;

		expect(cover.match(/viewBox=/g)).toHaveLength(1);
		expect(cover.match(/\swidth=/g)).toHaveLength(1);
		expect(cover).toContain('viewBox="0,0,640,360"');
	});

	it('does not write a second width when the root has one but no viewBox', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">${SYSTEM}${page(['M1,1l2,2'])}</svg>`;
		const cover = coverSvg(svg, {}).svg;

		expect(cover).toContain('viewBox="0,0,640,360"');
		expect(cover.match(/\swidth=/g)).toHaveLength(1);
		expect(cover.match(/\sheight=/g)).toHaveLength(1);
	});

	// A stroke drawn off the edge keeps its whole geometry, so archive pages hold
	// coordinates well outside the canvas. The viewBox is the window that clips them,
	// which is what the PNG does too — fitting the content would show strokes the
	// drawing never did.
	it('states the window rather than fitting the artwork in it', () => {
		const off = '<g fill="none" stroke="rgb(68, 68, 68)"><polyline points="-397,-105 1279,564"/></g>';
		const cover = coverSvg(`${ARCHIVE_ROOT}${SYSTEM}${off}</svg>`, {}).svg;

		expect(cover).toContain('viewBox="0,0,640,360"');
		expect(cover).toContain('-397,-105 1279,564');
	});

	it('is null for anything there is no page to take', () => {
		expect(coverSvg(`${ROOT}${SYSTEM}</svg>`, {})).toBe(null);
		expect(coverSvg('{"layers":[]}', {})).toBe(null);
		expect(coverSvg('', {})).toBe(null);
		expect(coverSvg(null, {})).toBe(null);
	});

	it('handles an empty page without inventing one', () => {
		const cover = coverSvg(file('<g fill="none" stroke="none"/>'), {});

		expect(cover.page).toBe(0);
		expect(cover.svg).toContain('</g></svg>');
	});

	it('is not fooled by a > inside an attribute value', () => {
		const svg = file(`<g ${PAGE_STYLE} data-note="a > b"><path d="M1,1l2,2"/></g>`);
		const cover = coverSvg(svg, {});

		expect(cover.svg).toContain('M1,1l2,2');
		expect(cover.svg).toContain('data-note="a > b"');
	});

	it('counts a nested group as part of its page rather than as a page', () => {
		const svg = file(
			`<g ${PAGE_STYLE}><g><path d="M1,1l2,2l3,3l4,4"/></g></g>`,
			page(['M9,9l1,1']),
		);

		expect(busiestPage(svg)).toBe(0);
		expect(coverSvg(svg, { page: 1 }).svg).toContain('M9,9l1,1');
	});
});

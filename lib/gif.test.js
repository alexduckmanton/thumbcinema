import { describe, expect, it } from 'vitest';

import {
	GIF_HEIGHT,
	GIF_WIDTH,
	delayFor,
	flattenPathData,
	flipbookGif,
	legacyPages,
	palette,
	rasterise,
	svgPages
} from './gif.js';

const ROOT =
	'<svg version="1.1" xmlns="http://www.w3.org/2000/svg"' +
	' width="640" height="360" viewBox="0,0,640,360">';

/** What paper 0.8 wrote, which is all 438 SVG-format archive rows. */
const ARCHIVE_ROOT = '<svg xmlns="http://www.w3.org/2000/svg">';

/** The three paper writes before any page: selection, guide, staging. */
const SYSTEM = '<g fill="none" stroke="none"/>'.repeat(3);

const PAGE_STYLE =
	'fill="none" stroke="#444444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';

/** `Math.max(...frame)` overflows the stack on 230,400 arguments. */
function highest(values) {
	let most = 0;
	for (const value of values) if (value > most) most = value;
	return most;
}

function file(...pages) {
	return `${ROOT}${SYSTEM}${pages.join('')}</svg>`;
}

/** A page in paper 0.12's vocabulary. */
function page(paths, extra = '') {
	const inner = paths.map((d, i) => `<path d="${d}" id="${i}_${i} 1"/>`).join('');
	return `<g ${PAGE_STYLE}${extra ? ` ${extra}` : ''}>${inner}</g>`;
}

/** A page in paper 0.8's, which is what the archive holds. */
function archivePage(polylines) {
	const inner = polylines.map((p, i) => `<polyline points="${p}" id="${i}_${i}"/>`).join('');
	return `<g fill="none" stroke="rgb(68, 68, 68)" stroke-width="3">${inner}</g>`;
}


// --- a GIF decoder, so the round trip is actually a round trip ---------------

/**
 * Enough of GIF89a to read back what `flipbookGif` writes.
 *
 * Written to the specification rather than by mirroring the encoder, because a decoder
 * that shares the encoder's assumptions can only ever confirm that this file agrees
 * with itself. The output is separately checked against Pillow, which is a decoder
 * nobody here wrote.
 */
function decodeGif(bytes) {
	let at = 0;
	const u8 = () => bytes[at++];
	const u16 = () => {
		const value = bytes.readUInt16LE(at);
		at += 2;
		return value;
	};

	const signature = bytes.toString('latin1', 0, 6);
	at = 6;

	const width = u16();
	const height = u16();
	const packed = u8();
	u8(); // background index
	u8(); // pixel aspect ratio

	let colours = null;
	if (packed & 0x80) {
		const size = 1 << ((packed & 0x07) + 1);
		colours = [];
		for (let i = 0; i < size; i++) {
			colours.push([bytes[at], bytes[at + 1], bytes[at + 2]]);
			at += 3;
		}
	}

	const subBlocks = () => {
		const chunks = [];
		for (;;) {
			const size = u8();
			if (!size) break;
			chunks.push(bytes.subarray(at, at + size));
			at += size;
		}
		return Buffer.concat(chunks);
	};

	const frames = [];
	let loop = null;
	let delay = null;

	for (;;) {
		const block = u8();
		if (block === 0x3b || at >= bytes.length) break;

		if (block === 0x21) {
			const label = u8();
			if (label === 0xf9) {
				u8(); // block size, always 4
				u8(); // packed
				delay = u16();
				u8(); // transparent index
				u8(); // terminator
			} else if (label === 0xff) {
				const size = u8();
				const name = bytes.toString('latin1', at, at + size);
				at += size;
				const payload = subBlocks();
				if (name === 'NETSCAPE2.0' && payload[0] === 1) loop = payload.readUInt16LE(1);
			} else {
				subBlocks();
			}
			continue;
		}

		if (block !== 0x2c) throw new Error(`unexpected block 0x${block.toString(16)}`);

		const x = u16();
		const y = u16();
		const w = u16();
		const h = u16();
		const flags = u8();
		if (flags & 0x80) throw new Error('local colour tables are not written here');

		const minCodeSize = u8();
		frames.push({ x, y, width: w, height: h, delay, indices: inflateLzw(subBlocks(), minCodeSize) });
		delay = null;
	}

	return { signature, width, height, colours, frames, loop };
}

function inflateLzw(data, minCodeSize) {
	const CLEAR = 1 << minCodeSize;
	const END = CLEAR + 1;

	let dictionary = [];
	let codeSize = 0;

	const reset = () => {
		dictionary = [];
		for (let i = 0; i < CLEAR; i++) dictionary.push([i]);
		dictionary.push(null, null); // clear and end occupy their codes
		codeSize = minCodeSize + 1;
	};
	reset();

	const out = [];
	let bit = 0;
	let previous = null;

	const readCode = () => {
		let value = 0;
		for (let i = 0; i < codeSize; i++) {
			const byte = data[bit >> 3];
			if (byte === undefined) return END;
			value |= ((byte >> (bit & 7)) & 1) << i;
			bit++;
		}
		return value;
	};

	for (;;) {
		const code = readCode();
		if (code === END) break;

		if (code === CLEAR) {
			reset();
			previous = null;
			continue;
		}

		let entry;
		if (dictionary[code]) entry = dictionary[code];
		else if (previous) entry = [...previous, previous[0]];
		else throw new Error('first code after a clear must be in the table');

		for (const symbol of entry) out.push(symbol);

		if (previous) {
			dictionary.push([...previous, entry[0]]);
			// A decoder is always one entry behind the encoder — it learns an entry from
			// the code *after* the one that created it — so it widens when its table is
			// full rather than when the entry it just added filled it. One off here and
			// the stream stays readable for exactly as long as the first code width
			// lasts, then turns to noise.
			if (dictionary.length === 1 << codeSize && codeSize < 12) codeSize++;
		}

		previous = entry;
	}

	return out;
}


describe('flattenPathData', () => {
	it("reads paper's own vocabulary: an absolute M and relative l, h, v", () => {
		// `getPathData` writes exactly this — see the note in gif.js.
		expect(flattenPathData('M10,10l5,0v5h-5z')).toEqual([
			10, 10, // M
			15, 10, // l5,0
			15, 15, // v5
			10, 15, // h-5
			10, 10 // z, back to the start
		]);
	});

	it('treats coordinate pairs after a moveto as linetos, keeping absoluteness', () => {
		expect(flattenPathData('M0,0 10,0 10,10')).toEqual([0, 0, 10, 0, 10, 10]);
		expect(flattenPathData('m0,0 10,0 10,10')).toEqual([0, 0, 10, 0, 20, 10]);
	});

	it('subdivides a cubic and lands exactly on its endpoint', () => {
		const points = flattenPathData('M0,0c10,0 20,0 30,0');

		expect(points.slice(0, 2)).toEqual([0, 0]);
		expect(points.slice(-2)).toEqual([30, 0]);
		// A straight curve stays on its line however finely it is cut.
		for (let i = 1; i < points.length; i += 2) expect(points[i]).toBeCloseTo(0, 6);
		expect(points.length).toBeGreaterThan(8);
	});

	it('reflects the control point of a smooth curve', () => {
		const points = flattenPathData('M0,0C0,10 10,10 10,0S20,-10 20,0');
		expect(points.slice(-2)).toEqual([20, 0]);
	});

	it('reads scientific notation, which is a number and not a command', () => {
		expect(flattenPathData('M1e2,1E1l1,1')).toEqual([100, 10, 101, 11]);
	});

	it('does not stand still on a malformed path', () => {
		// `z` consumes nothing, so a number after one used to be an infinite loop.
		expect(() => flattenPathData('M1,1l2,2z9 9 9')).not.toThrow();
		expect(flattenPathData('')).toEqual([]);
		expect(flattenPathData('nonsense')).toEqual([]);
	});
});


describe('svgPages', () => {
	it('skips the three system layers, so index 0 is page one', () => {
		const pages = svgPages(file(page(['M1,1l1,1']), page(['M2,2l2,2']), page(['M3,3l3,3'])));
		expect(pages).toHaveLength(3);
		expect(pages[0][0].points.slice(0, 2)).toEqual([1, 1]);
	});

	it('reads both stroke vocabularies, which are both still live', () => {
		const modern = svgPages(file(page(['M10,10l10,10'])));
		const archive = svgPages(`${ARCHIVE_ROOT}${SYSTEM}${archivePage(['10,10 20,20'])}</svg>`);

		expect(modern[0][0].points).toEqual([10, 10, 20, 20]);
		expect(archive[0][0].points).toEqual([10, 10, 20, 20]);
	});

	it('reads a <line>, which paper 0.8 wrote for a two-point stroke', () => {
		const svg = `${ARCHIVE_ROOT}${SYSTEM}<g stroke-width="3"><line x1="1" y1="2" x2="3" y2="4"/></g></svg>`;
		expect(svgPages(svg)[0][0].points).toEqual([1, 2, 3, 4]);
	});

	it("takes a stroke's own width first, then its group's, then 2", () => {
		const svg = file(
			`<g ${PAGE_STYLE}><path d="M1,1l1,1"/><path d="M2,2l1,1" stroke-width="8"/></g>`,
			'<g fill="none"><path d="M3,3l1,1"/></g>'
		);
		const pages = svgPages(svg);

		expect(pages[0][0].width).toBe(3); // the group's
		expect(pages[0][1].width).toBe(8); // its own
		expect(pages[1][0].width).toBe(2); // neither
	});

	it("does not mistake a group's width for its stroke-width", () => {
		// The root carries width="640"; so could a page group. Matching the wrong one
		// would draw every stroke as thick as the canvas.
		const svg = file(`<g fill="none" width="640" stroke-width="3"><path d="M1,1l1,1"/></g>`);
		expect(svgPages(svg)[0][0].width).toBe(3);
	});

	it('drops what it does not recognise rather than guessing at it', () => {
		const svg = file(`<g ${PAGE_STYLE}><path d="M1,1l1,1"/><rect x="0" y="0" width="9" height="9"/></g>`);
		expect(svgPages(svg)[0]).toHaveLength(1);
	});

	it('drops a stroke with nowhere to go, and keeps an empty page', () => {
		const svg = file(`<g ${PAGE_STYLE}><path d="M5,5"/></g>`, '<g fill="none"/>');
		const pages = svgPages(svg);

		expect(pages).toHaveLength(2);
		expect(pages[0]).toHaveLength(0);
		expect(pages[1]).toHaveLength(0);
	});
});


describe('legacyPages', () => {
	const legacy = (...layers) =>
		JSON.stringify({ layers: [{ children: [] }, { children: [] }, { children: [] }, ...layers] });

	it('skips the same three leading layers', () => {
		const text = legacy(
			{ children: [{ segments: [{ x: '1.0', y: '2.0' }, { x: '3.0', y: '4.0' }] }] },
			{ children: [{ segments: [{ x: '5.0', y: '6.0' }, { x: '7.0', y: '8.0' }] }] }
		);
		const pages = legacyPages(text);

		expect(pages).toHaveLength(2);
		expect(pages[0][0].points).toEqual([1, 2, 3, 4]);
	});

	it('rounds to whole pixels, as the 2013 pencil did', () => {
		const text = legacy({ children: [{ segments: [{ x: '1.4', y: '2.6' }, { x: '3.5', y: '4.4' }] }] });
		expect(legacyPages(text)[0][0].points).toEqual([1, 3, 4, 4]);
	});

	it('gives every 2012 stroke the width the engine replays it at', () => {
		const text = legacy({ children: [{ segments: [{ x: '1', y: '1' }, { x: '2', y: '2' }] }] });
		expect(legacyPages(text)[0][0].width).toBe(2);
	});

	it('is empty rather than throwing on anything it cannot read', () => {
		expect(legacyPages('not json at all')).toEqual([]);
		expect(legacyPages('{"nope":1}')).toEqual([]);
		expect(legacyPages(legacy({ children: 'wrong' }))[0]).toEqual([]);
	});
});


describe('rasterise', () => {
	const blank = () => new Float32Array(GIF_WIDTH * GIF_HEIGHT);
	const at = (cover, x, y) => cover[y * GIF_WIDTH + x];

	it('lays a solid core down the middle of a stroke', () => {
		const cover = blank();
		rasterise([{ points: [10, 20, 100, 20], width: 6 }], cover);

		expect(at(cover, 50, 20)).toBe(1);
		expect(at(cover, 50, 18)).toBe(1);
		// Beyond the half-width plus the anti-aliased pixel there is nothing.
		expect(at(cover, 50, 25)).toBe(0);
		expect(at(cover, 50, 14)).toBe(0);
	});

	it('softens the edge rather than stopping dead', () => {
		const cover = blank();
		// An odd width, so the edge falls between two pixel centres and there is a
		// partial one to find. At width 6 on an integer centre line the boundary lands
		// exactly on a pixel edge and the falloff has nowhere to show.
		rasterise([{ points: [10, 20, 100, 20], width: 5 }], cover);

		expect(at(cover, 50, 21)).toBe(1); // still inside
		const edge = at(cover, 50, 22);
		expect(edge).toBeGreaterThan(0);
		expect(edge).toBeLessThan(1);
		expect(at(cover, 50, 23)).toBe(0); // past it
	});

	it('rounds the cap, so the corner of the bounding box stays empty', () => {
		const cover = blank();
		rasterise([{ points: [50, 50, 100, 50], width: 20 }], cover);

		expect(at(cover, 50, 50)).toBe(1); // on the end point
		expect(at(cover, 41, 41)).toBe(0); // the corner a square cap would have filled
	});

	it('unions overlapping ink instead of adding it up', () => {
		const cover = blank();
		rasterise(
			[
				{ points: [10, 50, 100, 50], width: 6 },
				{ points: [50, 10, 50, 100], width: 6 }
			],
			cover
		);

		// Where they cross is a stroke, not two — coverage is a proportion and cannot
		// exceed one however many strokes pass over a pixel.
		expect(at(cover, 50, 50)).toBe(1);
		for (const value of cover) expect(value).toBeLessThanOrEqual(1);
	});

	it('clips to the canvas, which is what the viewport does when a flipbook plays', () => {
		const cover = blank();
		// Archive pages hold coordinates hundreds of units outside the window.
		expect(() =>
			rasterise([{ points: [-400, -400, 1279, 900], width: 4 }], cover)
		).not.toThrow();
		expect(cover.some((value) => value > 0)).toBe(true);
	});
});


describe('delayFor', () => {
	it('averages 12fps, which GIF cannot state directly', () => {
		// 1/12s is 8.333 hundredths. Eight would be 12.5fps and nine would be 11.1.
		const lap = [delayFor(0), delayFor(1), delayFor(2)];
		expect(lap).toEqual([8, 8, 9]);
		expect(lap.reduce((total, value) => total + value, 0) / 3).toBeCloseTo(100 / 12, 6);
	});
});


describe('palette', () => {
	it('runs from paper to ink over sixteen steps', () => {
		const table = palette();

		expect(table).toHaveLength(16 * 3);
		expect([...table.subarray(0, 3)]).toEqual([0xff, 0xff, 0xff]);
		expect([...table.subarray(45, 48)]).toEqual([0x44, 0x44, 0x44]);
		// Grey, so a flipbook cannot come out tinted.
		for (let i = 0; i < 16; i++) {
			expect(table[i * 3]).toBe(table[i * 3 + 1]);
			expect(table[i * 3]).toBe(table[i * 3 + 2]);
		}
	});
});


describe('flipbookGif', () => {
	const artwork = file(
		page(['M50,50l200,100', 'M100,300l300,-200']),
		page(['M60,60l200,100']),
		page(['M70,70l200,100', 'M20,20l100,0', 'M300,300l50,50']),
		page([]) // a blank frame, which flipbooks are full of
	);

	it('writes a GIF89a of the project size, looping forever', () => {
		const gif = decodeGif(flipbookGif(artwork, 'svg'));

		expect(gif.signature).toBe('GIF89a');
		expect(gif.width).toBe(GIF_WIDTH);
		expect(gif.height).toBe(GIF_HEIGHT);
		expect(gif.colours).toHaveLength(16);
		expect(gif.loop).toBe(0);
	});

	it('is one full-size frame per page, in page order, at 12fps', () => {
		const gif = decodeGif(flipbookGif(artwork, 'svg'));

		expect(gif.frames).toHaveLength(4);
		expect(gif.frames.map((frame) => frame.delay)).toEqual([8, 8, 9, 8]);

		for (const frame of gif.frames) {
			// Deliberately not cropped to what changed — see writeFrame.
			expect(frame.x).toBe(0);
			expect(frame.y).toBe(0);
			expect(frame.width).toBe(GIF_WIDTH);
			expect(frame.height).toBe(GIF_HEIGHT);
			expect(frame.indices).toHaveLength(GIF_WIDTH * GIF_HEIGHT);
		}
	});

	it('decodes back to exactly the pixels the rasteriser produced', () => {
		const gif = decodeGif(flipbookGif(artwork, 'svg'));
		const pages = svgPages(artwork);

		for (let i = 0; i < pages.length; i++) {
			const cover = new Float32Array(GIF_WIDTH * GIF_HEIGHT);
			rasterise(pages[i], cover);

			const expected = Array.from(cover, (value) => Math.round(value * 15));
			expect(gif.frames[i].indices).toEqual(expected);
		}
	});

	it('draws the ink dark and leaves the paper alone', () => {
		const [first] = decodeGif(flipbookGif(artwork, 'svg')).frames;

		expect(first.indices[0]).toBe(0); // the top-left corner is paper
		expect(highest(first.indices)).toBe(15); // and there is a solid stroke on it
	});

	it('renders a 2012 flipbook too, from point lists', () => {
		const text = JSON.stringify({
			layers: [
				{ children: [] },
				{ children: [] },
				{ children: [] },
				{ children: [{ segments: [{ x: '50', y: '50' }, { x: '250', y: '150' }] }] },
				{ children: [{ segments: [{ x: '60', y: '60' }, { x: '260', y: '160' }] }] }
			]
		});
		const gif = decodeGif(flipbookGif(text, 'legacy-json'));

		expect(gif.frames).toHaveLength(2);
		expect(highest(gif.frames[0].indices)).toBe(15);
	});

	it('takes the format from the field rather than sniffing the text', () => {
		// The rule `src/lib/api.ts` already states: the flipbook's own `format` is what
		// knows. A legacy file read as SVG has no pages in it at all.
		const legacy = JSON.stringify({
			layers: [{ children: [] }, { children: [] }, { children: [] }, { children: [{ segments: [{ x: '1', y: '1' }, { x: '9', y: '9' }] }] }]
		});
		expect(flipbookGif(legacy, 'svg')).toBeNull();
		expect(flipbookGif(legacy, 'legacy-json')).not.toBeNull();
	});

	it('is null when there is nothing to animate', () => {
		expect(flipbookGif(`${ROOT}${SYSTEM}</svg>`, 'svg')).toBeNull();
		expect(flipbookGif('', 'svg')).toBeNull();
		expect(flipbookGif('not json', 'legacy-json')).toBeNull();
	});

	it('survives a one-page flipbook, which has nothing to loop between', () => {
		const gif = decodeGif(flipbookGif(file(page(['M10,10l100,100'])), 'svg'));
		expect(gif.frames).toHaveLength(1);
	});

	it('compresses a mostly-blank flipbook to far less than its raw frames', () => {
		// The reason whole frames beat a diff: a page is long runs of paper, and LZW
		// eats those. Twelve raw frames would be 2.7 MB.
		const blank = file(...Array.from({ length: 12 }, (_, i) => page([`M${10 + i},10l20,20`])));
		const gif = flipbookGif(blank, 'svg');

		expect(gif.length).toBeLessThan(60 * 1024);
	});
});

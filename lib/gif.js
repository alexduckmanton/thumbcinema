/**
 * A saved flipbook, as an animated GIF.
 *
 * This is what `/f/:id.gif` serves. It is text in and bytes out — no canvas, no
 * paper.js, no DOM and no dependency — because the only caller is Node, and because
 * a flipbook is a shape simple enough that a general rasteriser would be almost all
 * unused surface: dark grey ink on white paper, round caps, round joins, one width
 * from end to end. Everything below is that one case done properly rather than any
 * case done adequately.
 *
 * **It is the third reader of the artwork format**, after `FlipbookEngine` (which has
 * paper) and `src/flipbook/preview/` (which has a canvas). That is not duplication for
 * its own sake: there is no build step shared between `lib/` and `src/`, which is the
 * same reason `LEADING_SYSTEM_GROUPS` and the 640x360 project size are already written
 * twice. What it does share is the genuinely awkward part — `lib/thumbnail.js`'s tag
 * scanner, which knows how to walk a paper export without a parser — so what is new
 * here is only the geometry, and the vocabularies it reads are the same three
 * `formats.ts` documents.
 *
 * The rest of the file is a rasteriser and a GIF writer. Both are small, and the
 * measurements that shaped them are recorded where they apply.
 */

import { pageGroups, pageSize, tags } from './thumbnail.js';

/**
 * The shape of everything drawn between 2012 and 2026, and so the size of a GIF of any
 * artwork that doesn't say what shape it is.
 *
 * The GIF is the size of the page, and the page's size comes off the artwork's own
 * `viewBox` — `pageSize` in `lib/thumbnail.js`, which is where the reasoning lives.
 * The whole 2013-2015 archive was written with no viewBox at all, and every one of
 * those is this.
 */
export const GIF_WIDTH = 640;
export const GIF_HEIGHT = 360;

/** Ink and paper. `PENCIL_COLOR` in `src/flipbook/engine/constants.ts`. */
const INK = 0x44;
const PAPER = 0xff;

/**
 * How many greys the ink ramp is quantised to.
 *
 * Measured on a 40-page page at 640x360: 2 greys is 260 KB and looks like a fax, 16
 * is 574 KB, 64 is 829 KB for edge detail nobody can see on a hand-drawn line. 16 is
 * also exactly four bits, so it is the last value before every pixel in the file costs
 * a fifth bit through LZW.
 */
const GREY_LEVELS = 16;
const CODE_BITS = 4;

/** A stroke's own width, its group's, or 2 — in that order, as in 2013. */
const DEFAULT_STROKE_WIDTH = 2;

/**
 * The 2012 format holds no widths at all — it is point lists — and the engine replays
 * it through a pencil constructed with 2, so every stroke in a 2012 flipbook is this
 * thick. `LEGACY_STROKE_WIDTH` in `src/flipbook/preview/artwork.ts`, same artwork.
 */
const LEGACY_STROKE_WIDTH = 2;

/**
 * 12fps, which GIF cannot say.
 *
 * Delays are in hundredths of a second and 1/12 is 8.333 of them. Eight would run the
 * flipbook at 12.5fps and nine at 11.1, so the frames alternate: 8, 8, 9 averages
 * 8.333 exactly, and a flipbook is a loop, so an error that cancels every three frames
 * never accumulates however long anyone watches it.
 */
const DELAY_PATTERN = [8, 8, 9];

export function delayFor(frame) {
	return DELAY_PATTERN[frame % DELAY_PATTERN.length];
}


/**
 * A whole flipbook as GIF bytes, or null when there is nothing to make one from.
 *
 * `format` is the flipbook's own — 'svg' or 'legacy-json' — and not a guess from the
 * text, which is the rule `src/lib/api.ts` already states: the field is what knows.
 *
 * Frames are rasterised and encoded one at a time and then dropped. That is worth
 * doing rather than building an array first because the two are not the same size: a
 * 200-page flipbook is 46 MB of raw frames and a 2.9 MB GIF, and holding all of the
 * former to write the latter is a peak this never has to reach. It is only possible
 * because frames here are independent — see `writeFrame` on why they are.
 */
export function flipbookGif(text, format) {
	const pages = format === 'legacy-json' ? legacyPages(text) : svgPages(text);
	if (!pages.length) return null;

	// The 2012 format has no root element to carry a viewBox and predates any other
	// shape, so it is the legacy page by construction rather than by fallback.
	const size = format === 'legacy-json' ? { width: GIF_WIDTH, height: GIF_HEIGHT } : pageSize(text);

	const out = new ByteSink();
	writeHeader(out, pages.length, size);

	// One coverage buffer and one index buffer for the whole flipbook, cleared between
	// pages. A page is a couple of hundred thousand pixels and there may be two hundred
	// of them.
	const cover = new Float32Array(size.width * size.height);
	const indices = new Uint8Array(size.width * size.height);
	const lzw = new Lzw();

	for (let i = 0; i < pages.length; i++) {
		cover.fill(0);
		rasterise(pages[i], cover, size);
		quantise(cover, indices);
		writeFrame(out, indices, delayFor(i), lzw, size);
	}

	out.u8(0x3b); // trailer
	return out.take();
}


// --- reading the artwork ---------------------------------------------------

/**
 * The pages of a paper export, each as a list of strokes in project coordinates.
 *
 * `pageGroups` has already skipped the three system layers, so index 0 here is page
 * one. Anything that isn't one of the three stroke vocabularies is dropped: the engine
 * falls back to paper's `importSVG` for those and can, having paper — this hasn't, so
 * the trade is explicit and it is the right way round. Across 594 flipbooks there has
 * never been a fourth, and `path`, `polyline` and `line` are all any version of this
 * tool has ever written.
 */
export function svgPages(text) {
	return pageGroups(text).map((group) => {
		const inner = text.slice(group.innerStart, group.innerEnd);
		const groupWidth = strokeWidth(group.attributes);
		const strokes = [];

		for (const tag of tags(inner)) {
			if (tag.closing) continue;

			const points = geometry(tag);
			if (!points || points.length < 4) continue;

			strokes.push({ points, width: strokeWidth(tag.attributes) ?? groupWidth ?? DEFAULT_STROKE_WIDTH });
		}

		return strokes;
	});
}

/**
 * The 2012 format: paper's own layer/segment JSON, with no paths in it anywhere.
 *
 * The same three leading system layers, and the same rounding the 2013 pencil did —
 * the archive was drawn expecting whole pixels, and `parseLegacyPages` in `formats.ts`
 * rounds for the same reason. Coordinates were serialised as strings ("466.0"), so
 * everything goes through Number() rather than being trusted.
 *
 * Not resampled. The engine replays these through the pencil, which spaces points
 * evenly on the way in; that exists for the push tool, which needs even spacing to
 * bend something, and nothing here bends anything. Drawing the corners the file
 * actually holds is the more faithful of the two — see `legacyPageStrokes`.
 */
export function legacyPages(text) {
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return [];
	}

	const layers = data?.layers;
	if (!Array.isArray(layers)) return [];

	return layers.slice(LEADING_SYSTEM_LAYERS).map((layer) => {
		const children = layer?.children;
		if (!Array.isArray(children)) return [];

		const strokes = [];
		for (const child of children) {
			const segments = child?.segments;
			if (!Array.isArray(segments)) continue;

			const points = [];
			for (const segment of segments) {
				const x = Math.round(Number(segment?.x));
				const y = Math.round(Number(segment?.y));
				if (Number.isFinite(x) && Number.isFinite(y)) points.push(x, y);
			}
			if (points.length >= 4) strokes.push({ points, width: LEGACY_STROKE_WIDTH });
		}
		return strokes;
	});
}

/** The same three the SVG side skips; `pageGroups` applies its own copy. */
const LEADING_SYSTEM_LAYERS = 3;

/**
 * One stroke's shape, flattened to `[x0, y0, x1, y1, ...]`, or null if this element
 * isn't a stroke at all.
 */
function geometry(tag) {
	switch (tag.name) {
		case 'path': {
			const data = attribute(tag.attributes, 'd');
			return data ? flattenPathData(data) : null;
		}
		case 'polyline':
			return svgNumbers(attribute(tag.attributes, 'points') ?? '');
		case 'line':
			return ['x1', 'y1', 'x2', 'y2'].map((name) => {
				const value = Number.parseFloat(attribute(tag.attributes, name) ?? '');
				return Number.isFinite(value) ? value : 0;
			});
		default:
			return null;
	}
}

/**
 * `importPoly`'s own regular expression, and deliberately so — the point of going
 * round an SVG parser is to skip the style, attribute and matrix resolution paper's
 * importer does per element, not to read the coordinates differently. Anything that
 * changed how these are read would change the artwork.
 */
const SVG_NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

/** Pairs only: a trailing odd coordinate needs a partner to mean anything. */
function svgNumbers(raw) {
	const found = raw.match(SVG_NUMBER);
	if (!found) return [];

	const points = [];
	for (let i = 0; i + 1 < found.length; i += 2) {
		points.push(Number.parseFloat(found[i]), Number.parseFloat(found[i + 1]));
	}
	return points;
}

/**
 * SVG path data as a polyline.
 *
 * paper's `getPathData` writes exactly five things — an absolute `M`, then relative
 * `l`, `h`, `v` and `c`, and a `z` on a closed path — so that is what this is built
 * for. The absolute forms and `S` are handled because they cost four lines and because
 * "paper only ever writes X" is the kind of claim that stops being true quietly; `Q`,
 * `T` and `A` fall through to their endpoint, which draws a straight line where a
 * curve was rather than dropping the stroke.
 */
/** How many numbers each command takes. Anything not in here isn't a command. */
const ARGUMENTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * A token is either one command letter or one number, and telling them apart needs
 * this rather than "does it contain a letter" — `1e2` is a number, and reading its
 * exponent as a command turns every coordinate written in scientific notation into a
 * dropped stroke.
 */
const COMMAND = /^[MmLlHhVvCcSsQqTtAaZz]$/;

export function flattenPathData(data) {
	const tokens = data.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
	if (!tokens) return [];

	const points = [];
	let at = 0;
	let command = '';
	let x = 0, y = 0;          // current point
	let startX = 0, startY = 0; // where the subpath began, for `z`
	let lastControlX = 0, lastControlY = 0;
	let afterCurve = false;

	const number = () => {
		const value = Number.parseFloat(tokens[at++]);
		return Number.isFinite(value) ? value : 0;
	};

	/** Whether the next `count` tokens are all numbers, i.e. whether a command can run. */
	const hasArguments = (count) => {
		for (let i = 0; i < count; i++) {
			const token = tokens[at + i];
			if (token === undefined || COMMAND.test(token)) return false;
		}
		return true;
	};

	while (at < tokens.length) {
		if (COMMAND.test(tokens[at])) command = tokens[at++];

		const relative = command !== command.toUpperCase();
		const kind = command.toUpperCase();

		// A command that isn't one, or one whose arguments have been truncated, ends
		// the path where it stands. Reading it anyway would draw a stroke to (0, 0) out
		// of a corrupt file, which is a mark nobody made appearing on somebody's page.
		const arity = ARGUMENTS[kind];
		if (arity === undefined || !hasArguments(arity)) break;

		if (kind === 'Z') {
			points.push(startX, startY);
			x = startX;
			y = startY;
			afterCurve = false;
			// `z` takes no arguments, so it is the one command that consumes nothing —
			// and a number after one is malformed input this would otherwise stand still
			// on for ever. Every other branch advances `at` on its own.
			if (at < tokens.length && !COMMAND.test(tokens[at])) at++;
			continue;
		}

		if (kind === 'M') {
			const dx = number(), dy = number();
			x = relative ? x + dx : dx;
			y = relative ? y + dy : dy;
			startX = x;
			startY = y;
			points.push(x, y);
			// A second coordinate pair after a moveto is an implicit lineto, and paper
			// writes runs of them.
			command = relative ? 'l' : 'L';
			afterCurve = false;
			continue;
		}

		if (kind === 'L' || kind === 'H' || kind === 'V') {
			if (kind === 'H') {
				const dx = number();
				x = relative ? x + dx : dx;
			} else if (kind === 'V') {
				const dy = number();
				y = relative ? y + dy : dy;
			} else {
				const dx = number(), dy = number();
				x = relative ? x + dx : dx;
				y = relative ? y + dy : dy;
			}
			points.push(x, y);
			afterCurve = false;
			continue;
		}

		if (kind === 'C' || kind === 'S') {
			let c1x, c1y;
			if (kind === 'C') {
				const ax = number(), ay = number();
				c1x = relative ? x + ax : ax;
				c1y = relative ? y + ay : ay;
			} else {
				// Smooth: the first control point is the reflection of the previous one.
				c1x = afterCurve ? 2 * x - lastControlX : x;
				c1y = afterCurve ? 2 * y - lastControlY : y;
			}
			const bx = number(), by = number(), ex = number(), ey = number();
			const c2x = relative ? x + bx : bx;
			const c2y = relative ? y + by : by;
			const endX = relative ? x + ex : ex;
			const endY = relative ? y + ey : ey;

			flattenCubic(points, x, y, c1x, c1y, c2x, c2y, endX, endY);

			lastControlX = c2x;
			lastControlY = c2y;
			afterCurve = true;
			x = endX;
			y = endY;
			continue;
		}

		// Q, T and A, in each of which the last pair is the endpoint. Nothing paper
		// writes reaches here; drawing the chord is better than dropping the stroke.
		let endX = x, endY = y;
		for (let i = 0; i < arity; i++) {
			const value = number();
			if (i === arity - 2) endX = relative ? x + value : value;
			if (i === arity - 1) endY = relative ? y + value : value;
		}
		x = endX;
		y = endY;
		points.push(x, y);
		afterCurve = false;
	}

	return points;
}

/**
 * A cubic as line segments, subdivided by how long it is rather than by a fixed count.
 *
 * The control net is an upper bound on the curve's length, and a segment every three
 * project units is finer than the five the pencil spaces its own points at — so a
 * curve is never the coarsest thing in the drawing. Bounded at both ends: two segments
 * for a curve short enough to be a dot, 24 for one that crosses the page.
 */
function flattenCubic(points, x0, y0, x1, y1, x2, y2, x3, y3) {
	const net = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
	const steps = Math.min(24, Math.max(2, Math.ceil(net / 3)));

	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const u = 1 - t;
		const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
		points.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
	}
}

/** `stroke-width` off a raw attribute string, or null when it hasn't got one. */
function strokeWidth(attributes) {
	const raw = attribute(attributes, 'stroke-width');
	if (raw === null) return null;

	const width = Number.parseFloat(raw);
	return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * One attribute out of the raw text between a tag's name and its bracket.
 *
 * Anchored on a boundary, because `width` is a substring of `stroke-width` and a page
 * group carries both — matching the wrong one would draw every archive page at the
 * width of the canvas.
 */
function attribute(attributes, name) {
	const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`);
	const match = pattern.exec(attributes);
	if (!match) return null;
	return match[2] ?? match[3] ?? '';
}


// --- rasterising -----------------------------------------------------------

/**
 * A page's strokes as per-pixel ink coverage in [0, 1].
 *
 * A round-cap, round-join stroke is the set of points within half a stroke-width of
 * its polyline — the Minkowski sum of the line with a disc — so coverage is a distance
 * test, and the shape needs no outline, no joins and no scanline fill. Only each
 * segment's own bounding box is visited, which is what makes this cost proportional to
 * the ink on the page rather than to the size of the canvas: a nearly blank page is
 * nearly free, and the archive is full of them.
 *
 * Overlap is a **max, not a sum**, which is what a union means and what stops a join
 * — where two segments always overlap — coming out darker than the line either side of
 * it. Compositing each stroke over the others instead, the way a canvas does when each
 * is a separate `stroke()` call, was measured against Chromium and moved 24 pixels in
 * 230,400. It is not worth a second buffer.
 *
 * The anti-aliasing is a box approximation: coverage falls linearly across the pixel
 * either side of the true edge. Against Chromium's canvas — which is Skia, and which
 * `src/flipbook/preview/render.ts` is already verified against — this agrees to a mean
 * of 0.43 in 255 over the whole image, differing only along stroke edges and by at
 * most ~78 on an individual edge pixel. Supersampling at 3x3 and 5x5 does not close
 * that gap, so it is a different anti-aliaser rather than a cheaper one; what it is
 * measured against is a quantisation to 16 greys, whose own step is 12.
 */
export function rasterise(strokes, cover, size = { width: GIF_WIDTH, height: GIF_HEIGHT }) {
	for (const stroke of strokes) {
		const { points } = stroke;
		const radius = stroke.width / 2;

		for (let i = 0; i + 3 < points.length; i += 2) {
			const ax = points[i], ay = points[i + 1];
			const bx = points[i + 2], by = points[i + 3];

			// Clipped to the canvas, which is what the viewport does when a flipbook
			// plays: archive pages hold coordinates hundreds of units off the edge.
			const left = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
			const right = Math.min(size.width - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
			const top = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
			const bottom = Math.min(size.height - 1, Math.ceil(Math.max(ay, by) + radius + 1));
			if (right < left || bottom < top) continue;

			const dx = bx - ax, dy = by - ay;
			const lengthSquared = dx * dx + dy * dy || 1;

			for (let py = top; py <= bottom; py++) {
				const row = py * size.width;
				const fy = py + 0.5;

				for (let px = left; px <= right; px++) {
					const fx = px + 0.5;

					// Nearest point on the segment, clamped to its ends — which is what
					// makes the caps round without drawing a cap.
					let t = ((fx - ax) * dx + (fy - ay) * dy) / lengthSquared;
					t = t < 0 ? 0 : t > 1 ? 1 : t;

					const ex = fx - (ax + t * dx);
					const ey = fy - (ay + t * dy);
					const edge = radius + 0.5 - Math.sqrt(ex * ex + ey * ey);
					if (edge <= 0) continue;

					const value = edge > 1 ? 1 : edge;
					if (value > cover[row + px]) cover[row + px] = value;
				}
			}
		}
	}
}

/**
 * Coverage as palette indices.
 *
 * The palette is the ink ramp itself, so this is a rounding rather than a search
 * through a colour cube — the whole reason a flipbook can be quantised without any of
 * the machinery a general GIF encoder needs.
 */
function quantise(cover, indices) {
	const top = GREY_LEVELS - 1;
	for (let i = 0; i < indices.length; i++) indices[i] = Math.round(cover[i] * top);
}

/** White through to ink, evenly. Index 0 is paper, index 15 is a solid stroke. */
export function palette() {
	const table = Buffer.alloc(GREY_LEVELS * 3);
	for (let i = 0; i < GREY_LEVELS; i++) {
		const value = Math.round(PAPER + ((INK - PAPER) * i) / (GREY_LEVELS - 1));
		table[i * 3] = value;
		table[i * 3 + 1] = value;
		table[i * 3 + 2] = value;
	}
	return table;
}


// --- writing the GIF -------------------------------------------------------

function writeHeader(out, frames, size) {
	out.text('GIF89a');
	out.u16(size.width);
	out.u16(size.height);
	// Global colour table present, 4 bits per pixel. The middle three bits are the
	// colour resolution, which no decoder has read since 1989.
	out.u8(0x80 | (CODE_BITS - 1));
	out.u8(0); // background colour index: paper
	out.u8(0); // pixel aspect ratio: square
	out.bytes(palette());

	// The Netscape application extension, which is the only way a GIF says "loop
	// forever". A flipbook without it plays once and stops on its last page.
	if (frames > 1) {
		out.text('\x21\xff\x0bNETSCAPE2.0');
		out.u8(3);
		out.u8(1);
		out.u16(0); // 0 = forever
		out.u8(0);
	}
}

/**
 * One page, as a whole opaque frame.
 *
 * **Deliberately not a diff against the previous frame**, which is the optimisation
 * every GIF encoder reaches for and which is wrong on this content. It was measured:
 * writing only the changed pixels and leaving the rest transparent made a 40-page
 * flipbook *larger*, 815 KB against 563 KB. Consecutive frames of a flipbook are
 * different drawings rather than a moved sprite, so almost every stroke pixel changes
 * — and a diff has to write an explicit white wherever last frame's ink has gone,
 * which scatters isolated pixels through the long runs of paper that are the whole
 * reason a page compresses at all. Whole frames keep those runs intact.
 *
 * Two things follow from it. Transparency is unused, so all 16 palette slots are ink
 * levels and a pixel costs four bits rather than five. And frames are independent, so
 * they can be encoded and dropped one at a time — see `flipbookGif`.
 */
function writeFrame(out, indices, delay, lzw, size) {
	// Graphic control extension: the delay, and nothing else.
	out.text('\x21\xf9');
	out.u8(4);
	out.u8(0x04); // disposal 1 (leave it in place), no transparency, no user input
	out.u16(delay);
	out.u8(0); // transparent colour index, unused
	out.u8(0);

	// Image descriptor: the whole canvas, no local colour table, not interlaced.
	out.u8(0x2c);
	out.u16(0);
	out.u16(0);
	out.u16(size.width);
	out.u16(size.height);
	out.u8(0);

	out.u8(CODE_BITS);
	lzw.encode(out, indices);
}

/**
 * GIF's variable-width LZW.
 *
 * The dictionary is a flat `Int32Array` indexed by `prefix * 16 + symbol` rather than
 * a Map: there are only sixteen symbols, so the whole table is 65,536 slots, and a
 * 200-page flipbook would otherwise build and discard millions of Map entries. Entries
 * hold `code + 1` so that zero can mean empty, and clearing between frames is a
 * `fill(0)`.
 *
 * One instance is reused across frames. It holds no state between `encode` calls
 * beyond the buffers it is avoiding reallocating.
 */
class Lzw {
	constructor() {
		this.table = new Int32Array(4096 * GREY_LEVELS);
		this.block = Buffer.alloc(255);
	}

	encode(out, indices) {
		const CLEAR = 1 << CODE_BITS;
		const END = CLEAR + 1;

		this.table.fill(0);

		let codeSize = CODE_BITS + 1;
		let next = END + 1;
		let accumulator = 0;
		let bits = 0;
		let blockLength = 0;

		const flush = () => {
			if (!blockLength) return;
			out.u8(blockLength);
			out.bytes(this.block.subarray(0, blockLength));
			blockLength = 0;
		};

		const emit = (code) => {
			accumulator |= code << bits;
			bits += codeSize;
			while (bits >= 8) {
				this.block[blockLength++] = accumulator & 0xff;
				accumulator >>>= 8;
				bits -= 8;
				if (blockLength === 255) flush();
			}
		};

		emit(CLEAR);

		let prefix = indices[0];
		for (let i = 1; i < indices.length; i++) {
			const symbol = indices[i];
			const slot = prefix * GREY_LEVELS + symbol;
			const found = this.table[slot];

			if (found) {
				prefix = found - 1;
				continue;
			}

			emit(prefix);

			if (next < 4096) {
				this.table[slot] = next + 1;
				next++;
				// The code just assigned is the widest one that may now be emitted, so
				// the width has to grow before it can be.
				if (next - 1 === 1 << codeSize && codeSize < 12) codeSize++;
			} else {
				// Full. Start again, which the decoder does on seeing the same code.
				emit(CLEAR);
				this.table.fill(0);
				next = END + 1;
				codeSize = CODE_BITS + 1;
			}

			prefix = symbol;
		}

		emit(prefix);
		emit(END);

		while (bits > 0) {
			this.block[blockLength++] = accumulator & 0xff;
			accumulator >>>= 8;
			bits -= 8;
			if (blockLength === 255) flush();
		}

		flush();
		out.u8(0); // end of the sub-block chain
	}
}

/** A Buffer that grows. Doubling, so a 200-page flipbook costs eight reallocations. */
class ByteSink {
	constructor() {
		this.buffer = Buffer.alloc(1 << 16);
		this.length = 0;
	}

	reserve(count) {
		if (this.length + count <= this.buffer.length) return;

		let size = this.buffer.length;
		while (size < this.length + count) size *= 2;

		const grown = Buffer.alloc(size);
		this.buffer.copy(grown, 0, 0, this.length);
		this.buffer = grown;
	}

	u8(value) {
		this.reserve(1);
		this.buffer[this.length++] = value & 0xff;
	}

	/** Little-endian, which is every multi-byte field GIF has. */
	u16(value) {
		this.reserve(2);
		this.buffer.writeUInt16LE(value & 0xffff, this.length);
		this.length += 2;
	}

	bytes(source) {
		this.reserve(source.length);
		source.copy(this.buffer, this.length);
		this.length += source.length;
	}

	/** Latin-1, so `\xff` in a literal is one byte rather than two of UTF-8. */
	text(value) {
		this.reserve(value.length);
		this.length += this.buffer.write(value, this.length, 'latin1');
	}

	take() {
		return this.buffer.subarray(0, this.length);
	}
}

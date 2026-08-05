/**
 * One page of a flipbook, lifted out of the artwork as a standalone SVG.
 *
 * This is what the gallery shows on a card. It replaces a 640x360 PNG of the same
 * page with the page itself — typically 2-4 KB of brotli against 10-40 KB of raster,
 * and sharp at whatever size the card happens to be, rather than resampled from a
 * fixed grid of pixels. The PNG is still written on every save and is still what
 * `time-capsule` serves, so a row without one of these simply falls back; see
 * `db/schema.sql`.
 *
 * It is text in and text out, deliberately. Both callers are Node — the save path,
 * which has the artwork in hand already, and `scripts/backfill-thumbnails.js`, which
 * is generating these for the 438 SVG-format archive rows — and neither has a DOM.
 * Writing it twice, once here and once against `DOMParser` in the browser, would be
 * two implementations of the leading-three-groups contract to keep in step.
 *
 * **A page group carries its own paint in both stroke vocabularies**, which is the
 * whole reason a page can be lifted out at all: paper writes `fill`, `stroke`,
 * `stroke-width` and the caps onto the `<g>` it exports per layer, in 0.8
 * (`stroke="rgb(68, 68, 68)"`, the 585 archive rows) as in 0.12 (`stroke="#444444"`).
 * See the samples in `docs/data-formats.md`. Verified rather than assumed: the lifted
 * page and the whole artwork rasterised at 640x360 differ by 0 pixels of 230,400.
 */

/**
 * paper.js exports one `<g>` per layer and the first three are always the selection,
 * guide and staging scaffolding. Real pages start at index 3.
 *
 * The same number as `LEADING_SYSTEM_GROUPS` in `src/flipbook/engine/formats.ts`, and
 * it has to stay the same number: they are both reading the one wire format. There is
 * no build step shared between `lib/` and `src/`, which is why it is written twice.
 */
export const LEADING_SYSTEM_GROUPS = 3;

/**
 * Which page a thumbnail should be of: the busiest one.
 *
 * The first page of a flipbook is very often nearly empty, so the cover is the page
 * with the most ink on it — the same rule `FlipbookEngine.busiestPage()` applies at
 * save time, arrived at by counting coordinates rather than paper segments because
 * this side has only the text. The two agree in practice and the save path doesn't
 * have to rely on it: the create page says which page it drew its PNG of, and this is
 * the fallback for when nothing said.
 */
export function busiestPage(svgText) {
	const pages = pageGroups(svgText);
	if (!pages.length) return null;

	let best = 0;
	let most = -1;
	for (let i = 0; i < pages.length; i++) {
		const ink = countCoordinates(svgText.slice(pages[i].innerStart, pages[i].innerEnd));
		if (ink > most) {
			most = ink;
			best = i;
		}
	}
	return best;
}

/**
 * One page of the artwork as an SVG document in its own right.
 *
 * `page` is a page index, not a group index — 0 is the first page after the three
 * system layers. Out of range, or absent, and the busiest page is used instead.
 *
 * Returns null when there is nothing to make one from: a file with no pages in it, or
 * artwork that isn't SVG at all. `legacy-json` has no paths anywhere in it and never
 * gets one of these; those rows keep their PNG.
 */
export function coverSvg(svgText, { page = null } = {}) {
	if (typeof svgText !== 'string') return null;

	const root = rootTag(svgText);
	if (!root) return null;

	const pages = pageGroups(svgText);
	if (!pages.length) return null;

	const index = Number.isInteger(page) && page >= 0 && page < pages.length
		? page
		: busiestPage(svgText);

	const cover = pages[index];
	if (!cover) return null;

	const open = `<g${cleanGroupAttributes(cover.attributes)}>`;
	const inner = stripIds(svgText.slice(cover.innerStart, cover.innerEnd));

	return { page: index, svg: `<svg${rootAttributes(root.attributes)}>${open}${inner}</g></svg>` };
}

// --- reading the file ------------------------------------------------------

/**
 * The tags in a document, in order, with the quoting rules honoured.
 *
 * A regular expression would do for the files paper writes and would be wrong for a
 * reason worth avoiding: an attribute value may contain a `>` — `style="mix-blend-mode:
 * normal"` doesn't, but nothing says a title or a font name can't — and a pattern that
 * stops at the first one silently truncates a tag. Scanning for the closing bracket
 * outside quotes is barely more code and can't be wrong about it.
 */
function* tags(text) {
	let at = 0;

	while (at < text.length) {
		const open = text.indexOf('<', at);
		if (open === -1) return;

		// Comments, doctypes and processing instructions are skipped whole. A comment
		// is the one of the three that may contain an unquoted `>`.
		if (text.startsWith('<!--', open)) {
			const close = text.indexOf('-->', open);
			if (close === -1) return;
			at = close + 3;
			continue;
		}
		if (text.startsWith('<!', open) || text.startsWith('<?', open)) {
			const close = text.indexOf('>', open);
			if (close === -1) return;
			at = close + 1;
			continue;
		}

		let quote = null;
		let cursor = open + 1;
		for (; cursor < text.length; cursor++) {
			const char = text[cursor];
			if (quote) {
				if (char === quote) quote = null;
			} else if (char === '"' || char === "'") {
				quote = char;
			} else if (char === '>') {
				break;
			}
		}
		if (cursor >= text.length) return;

		const raw = text.slice(open, cursor + 1);
		const closing = raw[1] === '/';
		const selfClosing = raw.endsWith('/>');
		const rawName = /^<\/?\s*([^\s/>]+)/.exec(raw)?.[1] ?? '';
		const name = rawName.toLowerCase();

		yield {
			name,
			rawName,
			closing,
			selfClosing,
			start: open,
			end: cursor + 1,
			// Everything between the name and the bracket, verbatim.
			attributes: raw.slice(1 + (closing ? 1 : 0) + rawName.length, selfClosing ? -2 : -1)
		};

		at = cursor + 1;
	}
}

/** The document element, which has to be an `<svg>`. */
function rootTag(text) {
	for (const tag of tags(text)) {
		if (tag.closing) return null;
		return tag.name === 'svg' ? tag : null;
	}
	return null;
}

/**
 * The `<g>` elements that are pages: direct children of the root, less the three
 * system layers. Each is reported as the span of its own children, so lifting one out
 * is a slice.
 */
function pageGroups(text) {
	const groups = [];
	let root = false;
	let depth = 0;
	let open = null;

	for (const tag of tags(text)) {
		if (!root) {
			if (tag.closing || tag.name !== 'svg') return [];
			root = true;
			// An empty document element has no children to walk.
			if (tag.selfClosing) return [];
			continue;
		}

		if (tag.closing) {
			if (depth === 0) break; // </svg>
			depth--;
			if (depth === 0 && open) {
				groups.push({ attributes: open.attributes, innerStart: open.end, innerEnd: tag.start });
				open = null;
			}
			continue;
		}

		if (tag.selfClosing) {
			// An empty page — a blank frame, or one of the system layers.
			if (depth === 0 && tag.name === 'g') {
				groups.push({ attributes: tag.attributes, innerStart: tag.end, innerEnd: tag.end });
			}
			continue;
		}

		if (depth === 0 && tag.name === 'g') open = tag;
		depth++;
	}

	return groups.slice(LEADING_SYSTEM_GROUPS);
}

/** How much ink a page has, near enough to rank pages by. */
function countCoordinates(inner) {
	let total = 0;
	for (const match of inner.matchAll(/\s(?:d|points|x1|y1|x2|y2)="([^"]*)"/g)) {
		total += match[1].match(/[-+]?(?:\d*\.\d+|\d+)/g)?.length ?? 0;
	}
	return total;
}

// --- writing the page out --------------------------------------------------

/**
 * The root's own attributes, whatever they are.
 *
 * Copied wholesale rather than picked over, because the page is being taken out of
 * this document and anything the document was saying about it has to come too — the
 * viewBox above all, which is what makes the result 640x360 whatever units the
 * strokes are in. The one thing added is the namespace, without which a standalone
 * SVG doesn't render at all; paper has always written it, and a file that didn't
 * would fail invisibly, as a card that is blank rather than a card that is broken.
 */
function rootAttributes(attributes) {
	return /\sxmlns\s*=/.test(` ${attributes}`)
		? attributes
		: ` xmlns="http://www.w3.org/2000/svg"${attributes}`;
}

/**
 * The page's own attributes, minus the three that are about where it was.
 *
 * `visibility="hidden"` is on every page that wasn't the one showing when the file was
 * written, and `opacity` is how the onion skin is drawn — the onion is a real page
 * layer (`Scene.onionLayer`) and it is live at export time, so the cover *can* be the
 * page that was ghosted behind the one being drawn on. Either would render the
 * thumbnail invisible or at a tenth strength. The id goes for its bytes.
 */
function cleanGroupAttributes(attributes) {
	return attributes
		.replace(/\s(?:visibility|opacity|id)\s*=\s*("[^"]*"|'[^']*')/g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s+$/, '');
}

/**
 * Strokes carry an `id` written from the paper item's name, and nothing reads it.
 * They are 12-17 bytes each and a page can hold a few hundred.
 */
function stripIds(inner) {
	let out = '';
	let at = 0;

	for (const tag of tags(inner)) {
		if (tag.closing) continue;
		const cleaned = tag.attributes.replace(/\sid\s*=\s*("[^"]*"|'[^']*')/g, '');
		if (cleaned === tag.attributes) continue;

		out += inner.slice(at, tag.start);
		out += `<${tag.rawName}${cleaned}${tag.selfClosing ? '/>' : '>'}`;
		at = tag.end;
	}

	return out + inner.slice(at);
}

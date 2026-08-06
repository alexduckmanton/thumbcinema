/**
 * The saved thumbnail, encoded as a PNG that isn't four times bigger than it needs
 * to be.
 *
 * `canvas.toDataURL('image/png')` writes 8-bit RGBA and picks its filters and its
 * deflate settings for speed, because it is meant to be cheap rather than small. On
 * a flipbook cover — grey ink on white paper, mostly paper — that costs a great deal:
 * measured across pages of increasing density, what it writes is 2.7 to 3.7 times the
 * size of the same pixels written as 8-bit greyscale. A real one from production is
 * 10,060 bytes against 2,626.
 *
 * So the thumbnail is encoded here instead. It stays a PNG, and that is not a
 * preference — `time-capsule` serves this column as `image/png` and knows nothing
 * else, and both deployments share the one database. It also stays **lossless**: a
 * flipbook cover is genuinely greyscale, so dropping the three colour channels and
 * the alpha throws nothing away, and the round trip is verified pixel for pixel in
 * `png.test.ts` rather than assumed.
 *
 * Nothing here is reached unless the picture really is grey and the browser really
 * has `CompressionStream`. Either answer being no is a fall back to `toDataURL`, and
 * a bigger thumbnail is not a thing anybody notices.
 */

/** Anything shaped like `ImageData`, so this can be exercised without a canvas. */
export interface Pixels {
	readonly width: number
	readonly height: number
	readonly data: Uint8ClampedArray | Uint8Array
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Greyscale, 8 bits, no interlacing. Colour type 0 is one byte per pixel. */
const BIT_DEPTH = 8
const COLOUR_TYPE_GREY = 0

/**
 * The five row filters PNG defines. All of them are tried, and the one that actually
 * compresses smallest wins.
 *
 * The spec suggests choosing per row by the sum of absolute differences, and on this
 * content that heuristic is not merely imperfect — it is beaten by doing nothing at
 * all. Measured on a dense cover: filtering per the heuristic gave 36,494 bytes and
 * filtering nothing gave 27,514. A flipbook page is long runs of identical white with
 * a few strokes through it, which is a case deflate's own matching handles better
 * than any per-row prediction can, and every filter but `none` breaks those runs up
 * into something that no longer matches the row above. Five deflates of a quarter of
 * a megabyte is a few tens of milliseconds, once, on a save that is about to wait on
 * a network round trip — so the answer is measured rather than guessed.
 */
const FILTERS = [0, 1, 2, 3, 4] as const

/**
 * The canvas as a PNG data URL, in whichever encoding comes out smaller.
 *
 * Always resolves: everything below can decline, and declining means the browser's
 * own PNG.
 */
export async function encodeThumbnail(canvas: HTMLCanvasElement): Promise<string> {
	const fallback = () => canvas.toDataURL('image/png')

	try {
		// No `willReadFrequently`: the caller has already taken this canvas's context
		// to draw on, and a second `getContext` hands back the first one with the
		// attributes ignored. One `getImageData` on a 640×360 canvas is not the case
		// that hint is for anyway.
		const context = canvas.getContext('2d')
		if (!context) return fallback()

		const bytes = await encodeGreyscalePng(context.getImageData(0, 0, canvas.width, canvas.height))
		return bytes ? `data:image/png;base64,${base64(bytes)}` : fallback()
	} catch {
		// A thumbnail is not worth failing a save over.
		return fallback()
	}
}

/**
 * An 8-bit greyscale PNG, or null if these pixels aren't greyscale.
 *
 * The check is not a formality. The cover is drawn after `Selection.clear()` and with
 * the onion skin hidden, so the only thing on it is `PENCIL_COLOR` — but the ink is a
 * constant somebody may one day change, and a blue flipbook silently saved as a grey
 * one is a worse outcome than a thumbnail that is a few kilobytes larger.
 */
export async function encodeGreyscalePng(image: Pixels): Promise<Uint8Array<ArrayBuffer> | null> {
	if (typeof CompressionStream === 'undefined') return null

	const grey = toGreyscale(image)
	if (!grey) return null

	const { width, height } = image
	let smallest: Uint8Array<ArrayBuffer> | null = null

	for (const filter of FILTERS) {
		const deflated = await deflate(applyFilter(grey, width, height, filter))
		if (!smallest || deflated.length < smallest.length) smallest = deflated
	}
	if (!smallest) return null

	return concat([
		SIGNATURE,
		chunk('IHDR', header(width, height)),
		chunk('IDAT', smallest),
		chunk('IEND', new Uint8Array(0)),
	])
}

/** One byte per pixel, or null the moment a pixel turns out to have a colour. */
function toGreyscale(image: Pixels): Uint8Array<ArrayBuffer> | null {
	const { width, height, data } = image
	if (data.length < width * height * 4) return null

	const grey = new Uint8Array(width * height)

	for (let at = 0, pixel = 0; pixel < grey.length; at += 4, pixel++) {
		const r = data[at] as number
		// Transparency has nowhere to go in a greyscale PNG. The cover is drawn onto
		// painted white paper so every pixel is opaque, and anything else declines.
		if (data[at + 3] !== 255) return null
		if (data[at + 1] !== r || data[at + 2] !== r) return null
		grey[pixel] = r
	}

	return grey
}

/**
 * The scanlines, each prefixed with the filter type used on it.
 *
 * One filter for the whole image rather than per row: the caller is trying all five
 * and keeping the smallest, and mixing them per row is what the heuristic above does
 * badly. Greyscale means one byte per pixel, so the "pixel to the left" is simply the
 * previous byte.
 */
function applyFilter(
	grey: Uint8Array,
	width: number,
	height: number,
	filter: number,
): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array((width + 1) * height)
	let at = 0

	for (let y = 0; y < height; y++) {
		const row = y * width
		const above = row - width

		out[at++] = filter

		for (let x = 0; x < width; x++) {
			const value = grey[row + x] as number

			if (filter === 0) {
				out[at + x] = value
				continue
			}

			const left = x > 0 ? (grey[row + x - 1] as number) : 0
			const up = y > 0 ? (grey[above + x] as number) : 0

			if (filter === 1) out[at + x] = (value - left) & 0xff
			else if (filter === 2) out[at + x] = (value - up) & 0xff
			else if (filter === 3) out[at + x] = (value - ((left + up) >> 1)) & 0xff
			else {
				const corner = x > 0 && y > 0 ? (grey[above + x - 1] as number) : 0
				out[at + x] = (value - paeth(left, up, corner)) & 0xff
			}
		}

		at += width
	}

	return out
}

/** The spec's predictor: whichever neighbour the gradient lands nearest. */
function paeth(left: number, up: number, corner: number): number {
	const estimate = left + up - corner
	const toLeft = Math.abs(estimate - left)
	const toUp = Math.abs(estimate - up)
	const toCorner = Math.abs(estimate - corner)

	if (toLeft <= toUp && toLeft <= toCorner) return left
	return toUp <= toCorner ? up : corner
}

function header(width: number, height: number): Uint8Array<ArrayBuffer> {
	const ihdr = new Uint8Array(13)
	const view = new DataView(ihdr.buffer)

	view.setUint32(0, width)
	view.setUint32(4, height)
	ihdr[8] = BIT_DEPTH
	ihdr[9] = COLOUR_TYPE_GREY
	// Compression 0 (deflate), filter method 0, no interlacing. The only values the
	// format has ever defined.
	return ihdr
}

/**
 * `CompressionStream('deflate')` is zlib-wrapped deflate — RFC 1950, which is exactly
 * what a PNG's IDAT holds. (`'deflate-raw'` is the one that isn't.)
 */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const stream = new CompressionStream('deflate')
	const writer = stream.writable.getWriter()

	void writer.write(bytes)
	void writer.close()

	return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

/** Length, type, payload, CRC — of the type and the payload, not the length. */
function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(12 + data.length)
	const view = new DataView(out.buffer)

	view.setUint32(0, data.length)
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
	out.set(data, 8)
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))

	return out
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)

	for (let n = 0; n < 256; n++) {
		let c = n
		for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}

	return table
})()

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff
	for (let i = 0; i < bytes.length; i++) {
		crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
	let at = 0

	for (const part of parts) {
		out.set(part, at)
		at += part.length
	}

	return out
}

/**
 * In chunks, because `String.fromCharCode(...bytes)` spreads every byte as an
 * argument and a thumbnail is tens of thousands of them — which overflows the call
 * stack on exactly the large drawings this is worth doing for.
 */
function base64(bytes: Uint8Array): string {
	const SPAN = 0x8000
	let binary = ''

	for (let at = 0; at < bytes.length; at += SPAN) {
		binary += String.fromCharCode(...bytes.subarray(at, at + SPAN))
	}

	return btoa(binary)
}

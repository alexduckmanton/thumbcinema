/**
 * The encoder, checked by decoding what it wrote.
 *
 * A PNG that is merely well-formed is not the claim being made — the claim is that
 * the thumbnail survives the round trip exactly, since that is what justifies writing
 * one by hand rather than letting the canvas do it. So these tests inflate the IDAT,
 * undo the filter and compare every pixel back against what went in. `node:zlib` is
 * the decoder, which is a different implementation from the `CompressionStream` that
 * wrote it, so agreement means something.
 */

import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { type Pixels, encodeGreyscalePng } from './png'

/** A page of white paper with some grey ink on it, the shape of a real cover. */
function cover(width: number, height: number, ink: (x: number, y: number) => number): Pixels {
	const data = new Uint8ClampedArray(width * height * 4)

	for (let y = 0, at = 0; y < height; y++) {
		for (let x = 0; x < width; x++, at += 4) {
			const value = ink(x, y)
			data[at] = value
			data[at + 1] = value
			data[at + 2] = value
			data[at + 3] = 255
		}
	}

	return { width, height, data }
}

const blank = (w: number, h: number) => cover(w, h, () => 255)
const stroke = (w: number, h: number) =>
	cover(w, h, (x, y) => (Math.abs(y - Math.round(h / 2 + Math.sin(x / 4) * 6)) < 2 ? 0x44 : 255))

// --- a minimal PNG reader, for the tests only ------------------------------

interface Decoded {
	width: number
	height: number
	depth: number
	colourType: number
	pixels: Uint8Array
}

function decode(png: Uint8Array): Decoded {
	expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	const chunks = new Map<string, Uint8Array>()

	for (let at = 8; at < png.length; ) {
		const length = view.getUint32(at)
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
		const body = png.subarray(at + 8, at + 8 + length)

		// Every chunk carries a CRC of its type and body, and a wrong one is how a
		// decoder that isn't this one would reject the file.
		expect(view.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)))

		chunks.set(type, body)
		at += 12 + length
	}

	const ihdr = chunks.get('IHDR')
	if (!ihdr) throw new Error('no IHDR')
	expect(chunks.has('IEND')).toBe(true)

	const head = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
	const width = head.getUint32(0)
	const height = head.getUint32(4)

	const idat = chunks.get('IDAT')
	if (!idat) throw new Error('no IDAT')

	const raw = new Uint8Array(inflateSync(Buffer.from(idat)))
	const pixels = unfilter(raw, width, height)

	return { width, height, depth: ihdr[8] as number, colourType: ihdr[9] as number, pixels }
}

/** One byte per pixel, so the left neighbour is the previous byte. */
function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
	const out = new Uint8Array(width * height)

	for (let y = 0; y < height; y++) {
		const filter = raw[y * (width + 1)] as number
		const row = y * (width + 1) + 1

		for (let x = 0; x < width; x++) {
			const value = raw[row + x] as number
			const left = x > 0 ? (out[y * width + x - 1] as number) : 0
			const up = y > 0 ? (out[(y - 1) * width + x] as number) : 0
			const corner = x > 0 && y > 0 ? (out[(y - 1) * width + x - 1] as number) : 0

			let previous = 0
			if (filter === 1) previous = left
			else if (filter === 2) previous = up
			else if (filter === 3) previous = (left + up) >> 1
			else if (filter === 4) {
				const estimate = left + up - corner
				const a = Math.abs(estimate - left)
				const b = Math.abs(estimate - up)
				const c = Math.abs(estimate - corner)
				previous = a <= b && a <= c ? left : b <= c ? up : corner
			}

			out[y * width + x] = (value + previous) & 0xff
		}
	}

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
	for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

// --- the tests -------------------------------------------------------------

describe('encodeGreyscalePng', () => {
	it('writes a greyscale 8-bit PNG of the right size', async () => {
		const png = await encodeGreyscalePng(stroke(64, 36))
		if (!png) throw new Error('declined')

		const decoded = decode(png)
		expect(decoded.width).toBe(64)
		expect(decoded.height).toBe(36)
		expect(decoded.depth).toBe(8)
		expect(decoded.colourType).toBe(0)
	})

	it('round-trips every pixel', async () => {
		const image = stroke(160, 90)
		const png = await encodeGreyscalePng(image)
		if (!png) throw new Error('declined')

		const { pixels } = decode(png)

		let differing = 0
		for (let pixel = 0; pixel < pixels.length; pixel++) {
			if (pixels[pixel] !== image.data[pixel * 4]) differing++
		}
		expect(differing).toBe(0)
	})

	it('round-trips a picture that defeats every row filter equally', async () => {
		// Noise, so no predictor helps and the encoder has to be right rather than lucky.
		let seed = 1
		const noise = cover(48, 24, () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff
			return seed & 0xff
		})

		const png = await encodeGreyscalePng(noise)
		if (!png) throw new Error('declined')

		const { pixels } = decode(png)
		for (let pixel = 0; pixel < pixels.length; pixel++) {
			expect(pixels[pixel]).toBe(noise.data[pixel * 4])
		}
	})

	it('is a good deal smaller than the RGBA the canvas would write', async () => {
		const png = await encodeGreyscalePng(stroke(640, 360))
		if (!png) throw new Error('declined')

		// Not a comparison against toDataURL, which needs a real canvas — against the
		// raw RGBA it encodes, which is the thing greyscale is throwing away.
		expect(png.length).toBeLessThan((640 * 360 * 4) / 20)
	})

	it('declines a picture with a colour in it rather than flattening it', async () => {
		const image = stroke(32, 18)
		const data = image.data as Uint8ClampedArray
		// One blue pixel is enough: the alternative is silently saving a blue flipbook
		// as a grey one.
		data[400] = 0x22
		data[401] = 0x99
		data[402] = 0xff

		expect(await encodeGreyscalePng(image)).toBe(null)
	})

	it('declines anything not fully opaque', async () => {
		const image = blank(32, 18)
		;(image.data as Uint8ClampedArray)[3] = 0

		expect(await encodeGreyscalePng(image)).toBe(null)
	})

	it('handles a blank page', async () => {
		const png = await encodeGreyscalePng(blank(640, 360))
		if (!png) throw new Error('declined')

		const { pixels } = decode(png)
		expect(pixels.every((value) => value === 255)).toBe(true)
		// 230,400 identical bytes is a case deflate should make very short work of.
		expect(png.length).toBeLessThan(2048)
	})
})

import { describe, expect, it } from 'vitest'

import { LEGACY_PAGE_SIZE, SQUARE_PAGE_SIZE } from './constants'
import { CENTRED, fittedSize, type TracePhoto, type TracePhotos, sameTrace } from './trace'

const photo = (url: string, placement = CENTRED): TracePhoto => ({
	url,
	width: 1200,
	height: 900,
	placement,
})

describe('sameTrace', () => {
	it('is true for the same object', () => {
		const map: TracePhotos = { 1: photo('a') }
		expect(sameTrace(map, map)).toBe(true)
	})

	it('is true for a copy holding the same photos in the same places', () => {
		expect(sameTrace({ 1: photo('a'), 2: photo('b') }, { 1: photo('a'), 2: photo('b') })).toBe(true)
	})

	it('notices a photo that has moved', () => {
		const before = { 1: photo('a') }
		const after = { 1: photo('a', { ...CENTRED, x: 0.2 }) }
		expect(sameTrace(before, after)).toBe(false)
	})

	it('notices a photo that has been scaled or turned', () => {
		expect(sameTrace({ 1: photo('a') }, { 1: photo('a', { ...CENTRED, scale: 2 }) })).toBe(false)
		expect(sameTrace({ 1: photo('a') }, { 1: photo('a', { ...CENTRED, rotation: 1 }) })).toBe(false)
	})

	it('notices a photo that has been replaced', () => {
		expect(sameTrace({ 1: photo('a') }, { 1: photo('b') })).toBe(false)
	})

	it('notices one added and one taken away', () => {
		expect(sameTrace({}, { 1: photo('a') })).toBe(false)
		expect(sameTrace({ 1: photo('a') }, {})).toBe(false)
	})

	/**
	 * The case a length check alone would miss, and the one a duplicate produces: the
	 * photo is handed from the page it was on to the page that took its slot, so the map
	 * is the same size and holds the same picture, against a different id.
	 */
	it('notices a photo handed to a different page', () => {
		expect(sameTrace({ 1: photo('a') }, { 2: photo('a') })).toBe(false)
	})
})

/*
 * The one expression two surfaces size the same photograph from — the DOM layer over the
 * paper, and v11's magnified stage, which draws it into a canvas. They agree only while
 * this does, so it is worth pinning rather than trusting.
 */
describe('fittedSize', () => {
	it('fills the frame exactly when the photo is already 16:9', () => {
		expect(fittedSize({ width: 1600, height: 900 }, LEGACY_PAGE_SIZE)).toEqual({
			width: 1,
			height: 1,
		})
	})

	it('is bound by the height when the photo is squarer than the frame', () => {
		// 4:3 into 16:9: full height, and three quarters of the width.
		expect(fittedSize({ width: 1200, height: 900 }, LEGACY_PAGE_SIZE)).toEqual({
			width: 0.75,
			height: 1,
		})
	})

	it('is bound by the width when the photo is wider than the frame', () => {
		// 32:9 into 16:9: full width, and half the height.
		expect(fittedSize({ width: 3200, height: 900 }, LEGACY_PAGE_SIZE)).toEqual({
			width: 1,
			height: 0.5,
		})
	})

	it('never overflows the frame, whatever shape the photo is', () => {
		const shapes: ReadonlyArray<readonly [number, number]> = [
			[4000, 30],
			[30, 4000],
			[1, 1],
			[1920, 1080],
			[3024, 4032],
		]

		for (const [width, height] of shapes) {
			const fit = fittedSize({ width, height }, LEGACY_PAGE_SIZE)
			expect(fit.width).toBeGreaterThan(0)
			expect(fit.height).toBeGreaterThan(0)
			expect(fit.width).toBeLessThanOrEqual(1)
			expect(fit.height).toBeLessThanOrEqual(1)
			// And it is a *fit*: one of the two axes is filled, or the photo would float.
			expect(Math.max(fit.width, fit.height)).toBeCloseTo(1, 10)
		}
	})

	it('answers rather than dividing by a picture with no size', () => {
		expect(fittedSize({ width: 0, height: 0 }, LEGACY_PAGE_SIZE)).toEqual({ width: 1, height: 1 })
		expect(fittedSize({ width: 100, height: 0 }, LEGACY_PAGE_SIZE)).toEqual({ width: 1, height: 1 })
	})
})

/*
 * A photo is fitted to the paper it is laid on, and the paper is no longer one shape.
 *
 * The same photograph on the two pages is two different placements — which is the point:
 * `fittedSize` is `object-fit: contain` done in numbers, and what it contains into is
 * the flipbook's own frame.
 */
describe('fittedSize on a square page', () => {
	it('fits a 16:9 photo to the width and leaves bars top and bottom', () => {
		const fit = fittedSize({ width: 1600, height: 900 }, SQUARE_PAGE_SIZE)

		expect(fit.width).toBe(1)
		expect(fit.height).toBeCloseTo(9 / 16, 6)
	})

	it('fills a square page with a square photo, where the legacy page cannot', () => {
		expect(fittedSize({ width: 1000, height: 1000 }, SQUARE_PAGE_SIZE)).toEqual({
			width: 1,
			height: 1,
		})
		// The same photo on a 16:9 page is bound by the height instead.
		expect(fittedSize({ width: 1000, height: 1000 }, LEGACY_PAGE_SIZE).width).toBeCloseTo(9 / 16, 6)
	})
})

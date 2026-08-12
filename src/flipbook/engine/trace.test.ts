import { describe, expect, it } from 'vitest'

import { CENTRED, type TracePhoto, type TracePhotos, sameTrace } from './trace'

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

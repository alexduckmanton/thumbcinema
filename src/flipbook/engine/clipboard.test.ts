import { describe, expect, it } from 'vitest'

import { PASTE_JITTER, PASTE_JITTER_MIN, pasteCentre } from './clipboard'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants'

/**
 * The clipboard itself needs paper.js and a project to clone into, so what is tested
 * here is the one part that is a function of a number: where a paste lands.
 *
 * `random` is passed in rather than stubbed, which is what makes "it is never exactly
 * the middle" something that can be asserted at the ends of the range rather than hoped
 * for over a lot of samples.
 */

const CENTRE = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }

/** Feeds `pasteCentre` a fixed sequence: distance, sign, distance, sign. */
function feed(...values: number[]): () => number {
	let index = 0
	return () => values[index++ % values.length] ?? 0
}

describe('pasteCentre', () => {
	it('lands off the middle of the frame in both directions', () => {
		// 0 is the near end of the distance range; 0 and 1 are the two signs.
		expect(pasteCentre(feed(0, 0, 0, 1))).toEqual({
			x: CENTRE.x - PASTE_JITTER_MIN,
			y: CENTRE.y + PASTE_JITTER_MIN,
		})
	})

	it('reaches exactly the stated distance and no further', () => {
		// 1 is the far end of the range, which is the ±10 the offset is quoted as.
		const far = pasteCentre(feed(1, 0, 1, 0))
		expect(far).toEqual({ x: CENTRE.x - PASTE_JITTER, y: CENTRE.y - PASTE_JITTER })
	})

	/*
	 * The property the whole thing exists for. A paste on top of the last paste is
	 * invisible, so every offset has to clear the middle by something you can see — and
	 * `Math.random` will hand back a number near zero often enough to matter.
	 */
	it('never lands on the middle, or within a pixel or two of it', () => {
		for (let i = 0; i < 500; i++) {
			const { x, y } = pasteCentre()

			expect(Math.abs(x - CENTRE.x)).toBeGreaterThanOrEqual(PASTE_JITTER_MIN)
			expect(Math.abs(x - CENTRE.x)).toBeLessThanOrEqual(PASTE_JITTER)
			expect(Math.abs(y - CENTRE.y)).toBeGreaterThanOrEqual(PASTE_JITTER_MIN)
			expect(Math.abs(y - CENTRE.y)).toBeLessThanOrEqual(PASTE_JITTER)
		}
	})

	it('varies, so two pastes are never the same paste', () => {
		const seen = new Set<string>()
		for (let i = 0; i < 50; i++) {
			const { x, y } = pasteCentre()
			seen.add(`${x},${y}`)
		}
		expect(seen.size).toBeGreaterThan(40)
	})
})

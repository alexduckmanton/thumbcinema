/**
 * The photograph a page is being traced over, as data.
 *
 * It lives in the engine's directory and not in `flipbook/trace/` for one reason: the
 * engine holds it. The *picture* is a DOM layer and always will be — nothing here goes
 * near paper.js, the artwork or the save — but which page a photo belongs to, what
 * happens to it when that page is copied or deleted, and whether undo can put it back
 * are questions the engine is already the only thing able to answer. Keeping the record
 * out here and the rendering over there is the same split `engine/formats.ts` makes with
 * `preview/`: the shared, awkward half is the one that gets hoisted.
 *
 * Everything in this file is plain data. No React, no paper, no DOM.
 */

import type { PageSize } from './constants'

/**
 * Where a photo is standing, as a transform of the frame.
 *
 * `x` and `y` are **fractions of the frame**, not pixels: the drawing is shown at
 * whatever the window can spare, and a placement stated in pixels would slide across the
 * picture the moment the phone was turned over. The frame keeps its shape at every
 * width, so
 * dividing x by the width and y by the height scales the pair by the same factor and the
 * photo stays where it was put.
 */
export interface Placement {
	x: number
	y: number
	scale: number
	/** Degrees clockwise. */
	rotation: number
}

export interface TracePhoto {
	/**
	 * An object URL for the downscaled copy.
	 *
	 * Held for the life of the tab rather than revoked when the photo is replaced or
	 * removed, because the undo stack can bring either back — see `useTracePhoto`.
	 */
	readonly url: string
	/** The downscaled copy's own pixels, which is all anything needs it for. */
	readonly width: number
	readonly height: number
	readonly placement: Placement
}

/** One photo per page, by page id. Frozen in the store and swapped rather than mutated. */
export type TracePhotos = Readonly<Record<number, TracePhoto>>

/** Centred, unrotated, and as large as the frame will take it. Where a photo lands. */
export const CENTRED: Placement = { x: 0, y: 0, scale: 1, rotation: 0 }

/**
 * How much of the frame the picture covers before any placement is applied, as fractions.
 *
 * `object-fit: contain`, done in numbers — the frame is 16:9 at every width, so the fit is
 * two `min`s and needs nothing measured. It is here rather than in the layer that draws it
 * because **two surfaces draw the same photograph now**: the DOM layer over the paper,
 * which turns these into percentages, and v11's magnified stage, which turns them into
 * project units for a `drawImage`. A photo that sat at one size on the paper and another
 * in the stage would be a photo you cannot trace, and one expression in one place is what
 * stops that. The dashed outline is the third reading, which is why the layer wants the
 * pair rather than an `object-fit`.
 */
export function fittedSize(
	photo: { width: number; height: number },
	page: PageSize,
): {
	width: number
	height: number
} {
	// A picture with no height is not one anything can fit; `useTracePhoto` won't produce
	// one, and answering with the whole frame beats answering with NaN if it ever does.
	if (!(photo.width > 0) || !(photo.height > 0)) return { width: 1, height: 1 }

	const frame = page.width / page.height
	const ratio = photo.width / photo.height
	return {
		width: Math.min(1, ratio / frame),
		height: Math.min(1, frame / ratio),
	}
}

/**
 * How far a photo may be pinched, and it is deliberately generous at both ends.
 *
 * The floor is not "still visible" — a photo shrunk to a tenth is a thumbnail in the
 * corner of the frame, which is a fair thing to want to trace. The ceiling is what makes
 * tracing one eye out of a portrait possible. What both are actually for is the pinch
 * that gets away: a ratio is unbounded, and a photo scaled by 400 is one that cannot be
 * found again.
 */
export const MIN_SCALE = 0.1
export const MAX_SCALE = 10

/** Whether two maps hold the same photos in the same places. */
export function sameTrace(a: TracePhotos, b: TracePhotos): boolean {
	if (a === b) return true

	const keys = Object.keys(a)
	if (keys.length !== Object.keys(b).length) return false

	for (const key of keys) {
		const one = a[Number(key)]
		const other = b[Number(key)]
		if (!one || !other) return false
		if (one.url !== other.url) return false
		if (!samePlacement(one.placement, other.placement)) return false
	}

	return true
}

function samePlacement(a: Placement, b: Placement): boolean {
	return a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotation === b.rotation
}

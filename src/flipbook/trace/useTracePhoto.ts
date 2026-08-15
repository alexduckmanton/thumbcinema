import { useCallback, useEffect, useRef, useState } from 'react'

import { showMessage } from '../../lib/messages'
import type { FlipbookEngine } from '../engine/FlipbookEngine'
import { CENTRED, type TracePhoto } from '../engine/trace'

/**
 * The largest a trace photo is kept at, on its long edge.
 *
 * A phone camera hands back twelve megapixels, which decodes to about 48 MB in the
 * browser — per photo, and there can be one on every page. The drawing is shown at 640
 * units across and never more than 1280 device pixels, so anything past this is detail
 * that cannot reach the screen. Downscaling on the way in also bakes in the EXIF
 * orientation a phone writes rather than carrying it around: an `<img>` honours that tag
 * and a canvas drawn from one gets the rotation for free.
 */
const MAX_EDGE = 1280

/**
 * How many photographs one batch may bring in.
 *
 * Each one is about 4 MB decoded after the downscale, and each one also gets a frame —
 * whose thumbnail in the strip is a canvas the size of the drawing. Both budgets are the
 * one `HIDPI_PAGE_LIMIT` already lives under, and iOS enforces its per-tab canvas
 * allowance by *blanking* canvases rather than by failing, so overrunning it is invisible
 * until the flipbook is full of white sheets. Twenty-four is a generous sequence and a
 * quarter of that ceiling.
 */
const MAX_BATCH = 24

export interface TracePhotoControls {
	/** True while a batch is being decoded, which for two dozen photos is a few seconds. */
	busy: boolean
	/**
	 * Opens the picker: the camera, or the library with multi-select.
	 *
	 * One photo lands on the page you are on, in hand. Several land one per frame from
	 * this one onwards, making frames as they run off the end — see `addTracePhotos`.
	 */
	take: () => void
}

/**
 * The camera, and what comes back from it.
 *
 * Everything *about* a photo once it exists — which page it is on, where it is standing,
 * whether it is in hand, what happens to it when that page is copied or deleted, and how
 * undo puts it back — belongs to the engine. See `FlipbookState.trace`. What is left here
 * is the part that is genuinely the browser's: a file input, a decode, a downscale, and
 * the object URLs those mint.
 *
 * **Object URLs are held for the life of the page and revoked all at once.** Revoking one
 * when its photo is replaced or removed is the obvious thing and is wrong: the undo stack
 * holds steps that name it, so a photo taken away and then brought back by ⌘Z would come
 * back as a broken image. Every URL minted here is therefore kept until the drawing tool
 * goes away. It costs the few megabytes of however many photographs were actually taken in
 * one sitting — each of which needed the camera opening — and it is the only version of
 * this that undo cannot break.
 */
export function useTracePhoto(engine: FlipbookEngine | null): TracePhotoControls {
	const [busy, setBusy] = useState(false)

	/** Every URL this hook has minted, so the teardown can give all of them back. */
	const minted = useRef<string[]>([])

	useEffect(() => {
		const urls = minted.current
		return () => {
			for (const url of urls) URL.revokeObjectURL(url)
			urls.length = 0
		}
	}, [])

	// Read when a picture comes back rather than closed over: the camera is a different
	// application, and what it hands back may arrive a long time after the press.
	const latest = useRef(engine)
	latest.current = engine

	/**
	 * Whatever the picker handed back, decoded and passed to the engine as one batch.
	 *
	 * **In shot order, not selection order.** `input.files` comes back in *album* order on
	 * iOS however you tapped them, which for a sequence photographed in one go is the wrong
	 * way round about as often as it is the right one. `lastModified` is when the shutter
	 * fired, and a stable sort on it leaves a set of files that all claim the same time —
	 * which is what a download or an AirDrop produces — in the order the picker gave them.
	 *
	 * **Decoded one at a time**, which is the whole reason this is a loop rather than a
	 * `Promise.all`. A twelve-megapixel photo is about 48 MB decoded, and twenty-four of
	 * them at once is a gigabyte held for as long as the slowest one takes; sequentially it
	 * is one at a time and each is thrown away as soon as the downscaled copy exists.
	 *
	 * A file that won't decode is skipped rather than failing the batch: one unreadable
	 * picture out of eight should cost you that picture, not the other seven.
	 */
	const receive = useCallback(async (files: File[]) => {
		setBusy(true)

		const chosen = [...files].sort((a, b) => a.lastModified - b.lastModified).slice(0, MAX_BATCH)

		const taken: TracePhoto[] = []
		let failed = 0

		for (const file of chosen) {
			try {
				const photo = await loadPhoto(file)
				minted.current.push(photo.url)
				taken.push(photo)
			} catch {
				failed++
			}
		}

		setBusy(false)

		if (taken.length > 0) latest.current?.addTracePhotos(taken)

		if (files.length > MAX_BATCH) {
			showMessage({
				copy: `That's a lot of photos — I've taken the first ${MAX_BATCH}.`,
				cta: 'Fair enough',
				type: 'error',
			})
		} else if (failed > 0) {
			showMessage({
				copy:
					taken.length > 0
						? "I couldn't read one of those pictures, so I've left it out."
						: "I couldn't read that picture. Try taking it again.",
				cta: 'Fair enough',
				type: 'error',
			})
		}
	}, [])

	/**
	 * The file input, made by hand and parked in the document.
	 *
	 * Not rendered by React: it is a control that is never seen, and one that would
	 * otherwise sit inside the aiming field matching `CONTROLS` in `pointer.ts` for no
	 * reason. In the document rather than detached because some versions of Safari
	 * decline to open a picker for an input that isn't.
	 */
	const input = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		const element = document.createElement('input')
		element.type = 'file'
		element.accept = 'image/*'
		/*
		 * No `capture`, and `multiple` instead.
		 *
		 * `capture="environment"` opens straight into the viewfinder, which is one tap
		 * better — and it can only ever hand back one photograph, because the OS camera
		 * takes one. **`multiple` is ignored while `capture` is set**, so the two are a
		 * choice rather than a pair. Without it both platforms show their own sheet — Take
		 * Photo, or the library with multi-select — which is the only route a web page has
		 * to more than one picture at a time. The extra tap buys shooting a whole sequence
		 * and laying it across a run of frames in one go.
		 */
		element.multiple = true
		element.hidden = true

		const onChange = () => {
			const files = element.files ? [...element.files] : []
			// Cleared before the work starts, so taking the same picture twice — or
			// cancelling and coming back — still fires a change.
			element.value = ''
			if (files.length > 0) void receive(files)
		}

		element.addEventListener('change', onChange)
		document.body.append(element)
		input.current = element

		return () => {
			element.removeEventListener('change', onChange)
			element.remove()
			input.current = null
		}
	}, [receive])

	const take = useCallback(() => {
		input.current?.click()
	}, [])

	return { busy, take }
}

/**
 * A file from the camera, decoded, turned the right way up and cut down to size.
 *
 * The original object URL is revoked here and only here: it is the one this function
 * minted for its own use, and what it hands back is the copy. Holding both would defeat
 * the point of making one.
 */
async function loadPhoto(file: File): Promise<TracePhoto> {
	const source = URL.createObjectURL(file)

	try {
		const image = await decode(source)

		const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
		const width = Math.max(1, Math.round(image.naturalWidth * scale))
		const height = Math.max(1, Math.round(image.naturalHeight * scale))

		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height

		const context = canvas.getContext('2d')
		if (!context) throw new Error('No 2D context')
		context.drawImage(image, 0, 0, width, height)

		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, 'image/jpeg', 0.85)
		})
		if (!blob) throw new Error('Could not encode the picture')

		return { url: URL.createObjectURL(blob), width, height, placement: CENTRED }
	} finally {
		URL.revokeObjectURL(source)
	}
}

function decode(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('That file is not a picture'))
		image.src = src
	})
}

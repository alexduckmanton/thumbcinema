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

export interface TracePhotoControls {
	/** True while the camera is open and the picture is being read back. */
	busy: boolean
	/** Opens the camera. What comes back lands on the page you are on, in hand. */
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

	const receive = useCallback((file: File) => {
		setBusy(true)

		void loadPhoto(file)
			.then((taken) => {
				minted.current.push(taken.url)
				latest.current?.setTracePhoto(taken)
			})
			.catch(() => {
				showMessage({
					copy: "I couldn't read that picture. Try taking it again.",
					cta: 'Fair enough',
					type: 'error',
				})
			})
			.finally(() => setBusy(false))
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
		// The camera rather than a picker: on both phone platforms this opens straight
		// into the viewfinder, which is what the button says it does.
		element.capture = 'environment'
		element.hidden = true

		const onChange = () => {
			const file = element.files?.[0]
			// Cleared before the work starts, so taking the same picture twice — or
			// cancelling and coming back — still fires a change.
			element.value = ''
			if (file) receive(file)
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

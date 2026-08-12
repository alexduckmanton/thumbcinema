import { useCallback, useEffect, useRef, useState } from 'react'

import { showMessage } from '../../lib/messages'
import type { PageState } from '../engine/pages'
import { CENTRED, type Placement } from './geometry'

export interface TracePhoto {
	/** An object URL for the downscaled copy. Revoked when it is replaced or removed. */
	readonly url: string
	/** The downscaled copy's own pixels, which is all anything here needs it for. */
	readonly width: number
	readonly height: number
	readonly placement: Placement
}

export interface TracePhotoControls {
	/** The photo on the page being drawn on, if there is one. */
	photo: TracePhoto | null
	/** True while it is still in hand rather than lying on the page. */
	placing: boolean
	/** True while the camera is open and the picture is being read back. */
	busy: boolean

	/** Opens the camera. What comes back lands on this page, in hand. */
	take: () => void
	/** Picks the photo on this page back up. */
	edit: () => void
	/** Puts it down where it is. */
	accept: () => void
	/** Takes it off this page for good. */
	remove: () => void
	/** Where a gesture left it. */
	place: (placement: Placement) => void
}

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
 * The trace photos, one per page, for as long as the tab is open.
 *
 * Held here rather than in the engine, and deliberately nowhere near the artwork: a
 * photograph you are tracing over is scaffolding, and a flipbook saved with one on screen
 * has to come out byte-identical to the same flipbook saved without. Nothing in this file
 * touches paper.js, the undo history, the page thumbnails or the save. See `TraceLayer`
 * for the other half of that argument.
 *
 * **Keyed by page id, not by page index.** Inserting, deleting or dragging a page
 * renumbers everything after it, so a photo held against an index would be looking at
 * somebody else's drawing the moment the flipbook changed shape. It is the same reason
 * `History` keys its steps by id.
 *
 * **Not persisted, and that is a decision rather than an omission.** A crash recovery
 * file is already carrying the artwork and a phone camera JPEG is megabytes; a reference
 * photo is also the one thing on this page that can be got back in two taps. So the
 * photos live for as long as the tab does and no longer.
 */
export function useTracePhoto(pages: readonly PageState[], activePage: number): TracePhotoControls {
	const [photos, setPhotos] = useState<Readonly<Record<number, TracePhoto>>>({})
	const [busy, setBusy] = useState(false)

	/**
	 * Which page's photo is in hand, rather than whether one is.
	 *
	 * The same fact, stated so that turning the page puts it down without anything having
	 * to notice that the page turned: a boolean would need an effect to reset it, and an
	 * effect runs *after* the render that changed the page — which is one frame of a
	 * dashed border and a live gesture field over somebody else's drawing.
	 */
	const [inHand, setInHand] = useState<number | null>(null)

	const pageId = pages[activePage]?.id ?? null
	const photo = pageId === null ? null : (photos[pageId] ?? null)
	const placing = photo !== null && inHand === pageId

	// Read when a picture comes back rather than closed over: the camera is a different
	// application, and what it hands back may arrive a long time after the press.
	const current = useRef(pageId)
	current.current = pageId

	// A mirror for the teardown, which cannot read state. Every URL here is one this
	// hook minted and is therefore one it has to give back.
	const live = useRef(photos)
	live.current = photos

	useEffect(() => {
		return () => {
			for (const held of Object.values(live.current)) URL.revokeObjectURL(held.url)
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

	const receive = useCallback((file: File) => {
		setBusy(true)

		void loadPhoto(file)
			.then((taken) => {
				const page = current.current
				if (page === null) {
					URL.revokeObjectURL(taken.url)
					return
				}

				setPhotos((held) => {
					const previous = held[page]
					if (previous) URL.revokeObjectURL(previous.url)
					return { ...held, [page]: taken }
				})
				setInHand(page)
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

	/*
	 * A page that has gone takes its photo with it.
	 *
	 * Deleting a page, or undoing the insert of one, drops its id out of the list for
	 * good — and an object URL nobody can reach is a megabyte the tab keeps until it is
	 * closed. Pages that are merely *leaving* are still in the list, so this waits for
	 * the animation to land on its own.
	 */
	useEffect(() => {
		const alive = new Set(pages.map((page) => page.id))

		setPhotos((held) => {
			const stale = Object.keys(held)
				.map(Number)
				.filter((key) => !alive.has(key))
			if (stale.length === 0) return held

			const next = { ...held }
			for (const key of stale) {
				const gone = next[key]
				if (gone) URL.revokeObjectURL(gone.url)
				delete next[key]
			}
			return next
		})
	}, [pages])

	const take = useCallback(() => {
		input.current?.click()
	}, [])

	const edit = useCallback(() => setInHand(current.current), [])
	const accept = useCallback(() => setInHand(null), [])

	const remove = useCallback(() => {
		const page = current.current
		if (page === null) return

		setPhotos((held) => {
			const previous = held[page]
			if (!previous) return held

			URL.revokeObjectURL(previous.url)
			const next = { ...held }
			delete next[page]
			return next
		})
		setInHand(null)
	}, [])

	const place = useCallback((placement: Placement) => {
		const page = current.current
		if (page === null) return

		setPhotos((held) => {
			const previous = held[page]
			if (!previous) return held
			return { ...held, [page]: { ...previous, placement } }
		})
	}, [])

	return { photo, placing, busy, take, edit, accept, remove, place }
}

/**
 * A file from the camera, decoded, turned the right way up and cut down to size.
 *
 * The original object URL is revoked either way: what is kept is the copy, and holding
 * both would defeat the point of making one.
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

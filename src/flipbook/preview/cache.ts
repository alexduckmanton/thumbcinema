/**
 * The flipbooks the gallery has in hand, shared by every card on the page.
 *
 * A module-level singleton, which is the whole point of it: there is one copy of this
 * code, one cache, and one flipbook per id however many cards ask for it. Hovering a
 * card you have already hovered costs nothing at all, and going to the playback page
 * and coming back finds it still here.
 *
 * Two decisions about when to give up are the substance of this file, and they differ:
 *
 *  - **A fetch in flight is abandoned when the last card lets go of it.** Sweeping a
 *    pointer down a column of cards would otherwise start twenty downloads, and the
 *    twenty of them are the ones nobody is waiting for. The responses are immutable
 *    and CDN-cached, so hovering back onto one costs a conditional request at worst.
 *  - **A decode already under way is finished anyway.** By then the bytes are paid
 *    for and what is left is arithmetic in idle slices. Stopping there would throw
 *    away the download to save the cheap half, and leave a half-built flipbook that
 *    the next hover has to start again from nothing.
 */

import type { FlipbookFormat } from '../../lib/api'
import { type ArtworkReader, type PreviewPage, readArtwork } from './artwork'

/**
 * How many flipbooks to keep.
 *
 * Small on purpose. A page of parsed artwork is `Path2D` — native, compact, and
 * still real memory — and the archive holds flipbooks of two hundred pages. Six is
 * enough that going back to a card you were just on is free, which is the whole of
 * what a cache is for here, and few enough that a long browse can't accumulate.
 */
const MAX_ENTRIES = 6

/** Long enough to get pages built, short enough to leave the frame its time. */
const BUDGET_MS = 8

export type PreviewStatus = 'loading' | 'ready' | 'failed'

export interface PreviewEntry {
	readonly id: string
	/**
	 * How many pages the flipbook has, known from the moment the file is split and
	 * before a single page has been built.
	 *
	 * The scrub maps the pointer across *this* rather than across `pages.length`, or
	 * a long flipbook would remap itself under a stationary pointer as the rest of it
	 * arrived. Zero until the artwork lands.
	 */
	readonly total: number
	/** Built pages, in order, growing from the front. May be shorter than `total`. */
	readonly pages: PreviewPage[]
	readonly status: PreviewStatus
}

type Listener = () => void

interface Entry extends PreviewEntry {
	total: number
	status: PreviewStatus
	/** How many cards are currently holding this. See `retain`. */
	holds: number
	controller: AbortController | null
	/** Set once the bytes have arrived; from here the decode always finishes. */
	decoding: boolean
	listeners: Set<Listener>
}

const entries = new Map<string, Entry>()

export interface PreviewSource {
	id: string
	format: FlipbookFormat
	data_url: string
}

/**
 * Takes hold of a flipbook, starting the load if nobody has yet.
 *
 * Returns the release function. Callers must call it — it is what tells an
 * abandoned download to stop, and what lets the entry be evicted later.
 */
export function retain(source: PreviewSource, onChange: Listener): () => void {
	const entry = open(source)
	entry.holds++
	entry.listeners.add(onChange)

	let released = false
	return () => {
		if (released) return
		released = true

		entry.holds--
		entry.listeners.delete(onChange)

		// Nobody is watching and the bytes haven't arrived: this is the sweep case,
		// and there is nothing yet worth keeping.
		if (entry.holds === 0 && entry.status === 'loading' && !entry.decoding) {
			entry.controller?.abort()
			entries.delete(entry.id)
		}
	}
}

/**
 * Starts a flipbook downloading without taking a hold on it.
 *
 * For the finger, which has no hover to start things off. A tap and a scrub begin
 * with the same touch and are told apart ten pixels later, so the download starts on
 * contact and the gesture decides afterwards what it was for. That is the difference
 * between the flipbook being there as the drag begins and arriving a beat after it.
 *
 * Deliberately not a hold, and so deliberately *not* abandoned when the gesture ends —
 * the opposite of `retain`. The two are answering different risks. A mouse sweeping
 * the grid touches twenty cards nobody wants, which is what `retain` abandons; a
 * finger touches one, and whichever way that gesture goes the bytes are wanted. A
 * scrub is about to draw them, and a tap is about to open the playback page, which
 * needs the same artwork and will find this response in the HTTP cache. Aborting on
 * the tap would throw away a download that had all but arrived, to save nothing.
 *
 * Nothing to release, so nothing for the caller to remember. The entry sits at zero
 * holds and is evicted by the usual LRU when six newer ones have been asked for.
 */
export function prefetch(source: PreviewSource): void {
	open(source)
}

/** What a holder reads. Never null while it holds one. */
export function peek(id: string): PreviewEntry | null {
	return entries.get(id) ?? null
}

function open(source: PreviewSource): Entry {
	const existing = entries.get(source.id)
	if (existing) {
		// Re-inserted so the map's own order is least-recently-used order.
		entries.delete(source.id)
		entries.set(source.id, existing)
		return existing
	}

	const entry: Entry = {
		id: source.id,
		total: 0,
		pages: [],
		status: 'loading',
		holds: 0,
		controller: new AbortController(),
		decoding: false,
		listeners: new Set(),
	}

	entries.set(source.id, entry)
	evict()

	void load(entry, source)
	return entry
}

/**
 * Drops the least recently used entries nobody is holding.
 *
 * A held entry is never evicted however old it is — it is on screen. In practice
 * exactly one is held at a time, because exactly one card is under the pointer.
 */
function evict(): void {
	if (entries.size <= MAX_ENTRIES) return

	for (const [id, entry] of entries) {
		if (entries.size <= MAX_ENTRIES) return
		if (entry.holds > 0) continue

		entry.controller?.abort()
		entries.delete(id)
	}
}

async function load(entry: Entry, source: PreviewSource): Promise<void> {
	try {
		const response = await fetch(source.data_url, { signal: entry.controller?.signal })
		if (!response.ok) throw new Error(`${response.status}`)

		// Text, not JSON, whichever format it is. `/data` serves 2012 flipbooks as
		// text/plain and everything else as SVG, and which one it is comes from the
		// row's `format` rather than from the content type — see `getFlipbookData`.
		const text = await response.text()
		if (entry.controller?.signal.aborted) return

		// From here the download is spent, so the decode finishes whatever happens
		// above it. Reading this flag is how `retain`'s release knows not to abort.
		entry.decoding = true
		entry.controller = null

		const reader = readArtwork(text, source.format)
		entry.total = reader.total
		notify(entry)

		await decode(entry, reader)
	} catch (error) {
		// An abort is a card being left, not a failure — the entry has been dropped
		// from the map already and there is nobody left to tell.
		if (error instanceof DOMException && error.name === 'AbortError') return

		entry.status = 'failed'
		notify(entry)
	}
}

/**
 * Builds pages until there are none left, a frame's work at a time.
 *
 * Published after every slice rather than at the end: a card starts showing the
 * flipbook as soon as page one exists, exactly as the playback page starts playing
 * on the second page rather than on the last.
 */
async function decode(entry: Entry, reader: ArtworkReader): Promise<void> {
	let deadline = performance.now() + BUDGET_MS

	for (const page of reader.pages) {
		entry.pages.push(page)

		if (performance.now() >= deadline) {
			notify(entry)
			await nextFrame()
			deadline = performance.now() + BUDGET_MS
		}
	}

	entry.status = 'ready'
	notify(entry)
}

function notify(entry: Entry): void {
	for (const listener of entry.listeners) listener()
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve())
	})
}

/** Test seam. Nothing in the app empties the cache — a flipbook never changes. */
export function clearPreviewCache(): void {
	for (const entry of entries.values()) entry.controller?.abort()
	entries.clear()
}

/**
 * Flipbooks saved while there was nothing to save them to.
 *
 * A save that never reached the server is written here instead — the whole drawing, in
 * IndexedDB — and `sync.ts` posts it the next time there is a connection. Between those
 * two moments it is a flipbook like any other as far as the rest of the app is
 * concerned: it has an id, it has a permalink, it draws a card in the gallery and it
 * plays on its own page. That is the whole trick, and it is what `pendingSummary` is
 * for.
 *
 * The store is the live half. IndexedDB holds what survives a reload; this holds what
 * has happened to each record *since* the page opened — which of them is uploading,
 * which has just gone up and under which real id, and why one of them wouldn't. None of
 * that is worth persisting: a fresh page load asks the server again from a clean slate.
 */

import { pageSizeFromSvg } from '../flipbook/engine/formats'
import type { FlipbookSummary, Flipbook, SavePayload } from '../lib/api'
import { Store, useStore } from '../lib/store'
import * as db from './db'

/**
 * What a local id looks like, and why it can't be mistaken for a real one.
 *
 * Server ids are `[a-z0-9]` — ten characters from a restricted alphabet for new saves,
 * `a{wordpress_post_id}` for the archive (see `lib/id.js`). Neither can contain a
 * hyphen, so nothing the server will ever mint collides with this prefix. That matters
 * because the two kinds of id share one route: `/f/local-xxxxxxxxxx` is a real URL that
 * reloads, and the playback page tells them apart by this and nothing else.
 */
const LOCAL_PREFIX = 'local-'

/** The server's own alphabet, minus 0/1/l/o. Same reason: ids get read aloud. */
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'

export function isPendingId(id: string): boolean {
	return id.startsWith(LOCAL_PREFIX)
}

function newPendingId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(10))
	let id = LOCAL_PREFIX
	for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length]
	return id
}

/**
 * A save, kept whole.
 *
 * The fields of `SavePayload` and nothing derived from them, because what goes up later
 * has to be the same request that failed — this is the save, held rather than sent.
 */
export interface PendingFlipbook {
	id: string
	title: string
	description: string
	svg: string
	thumbnailDataUrl: string
	cover: number
	/**
	 * Kept, and still honoured on upload.
	 *
	 * You can't *start* a remix offline — the drawing tool has to fetch the flipbook it
	 * is remixing — but a connection that drops halfway through one leaves a perfectly
	 * good remix on the page, and the parent is only an id. The server resolves it when
	 * the save finally lands, exactly as it would have then.
	 */
	remixOf: string | null
	createdAt: string
}

/**
 * Where a queued flipbook has got to, this page view.
 *
 * `published` is not a contradiction: the record is gone from IndexedDB by then and the
 * entry stays in the list on purpose, so the card in the gallery turns solid and links
 * to the real flipbook rather than vanishing under the reader. It goes on the next load,
 * by which time the gallery fetches the real row instead.
 */
export type PendingStatus = 'waiting' | 'uploading' | 'published' | 'failed'

export interface PendingEntry {
	readonly book: PendingFlipbook
	readonly status: PendingStatus
	/** The real id, once it has one. */
	readonly publishedAs: string | null
	/** Why the server refused it, on a `failed` entry. */
	readonly error: string | null
}

const store = new Store<{ entries: PendingEntry[]; loaded: boolean }>({
	entries: [],
	loaded: false,
})

/**
 * The artwork, as something `fetch` can be pointed at.
 *
 * A blob URL rather than a special case in the four places that read a flipbook's
 * artwork: the gallery's preview cache, the playback page and the two that hang off
 * them all take a `data_url` and fetch it, and a `blob:` URL is a URL. The alternative
 * is an "or is it local?" branch in each of them.
 *
 * Held per record and revoked when the record goes, because an object URL is a hold on
 * however many megabytes the drawing is until the tab closes.
 */
const artworkUrls = new Map<string, string>()

function artworkUrl(book: PendingFlipbook): string {
	const existing = artworkUrls.get(book.id)
	if (existing) return existing

	const url = URL.createObjectURL(new Blob([book.svg], { type: 'image/svg+xml' }))
	artworkUrls.set(book.id, url)
	return url
}

function releaseArtwork(id: string): void {
	const url = artworkUrls.get(id)
	if (!url) return
	URL.revokeObjectURL(url)
	artworkUrls.delete(id)
}

/**
 * A queued flipbook wearing the gallery's clothes.
 *
 * Once it is published this answers with the *real* id, so the card the reader is
 * looking at becomes a link to the flipbook that now exists — while still drawing
 * itself from the copy in hand, which is the same drawing and is already local.
 */
export function pendingSummary(entry: PendingEntry): FlipbookSummary {
	const { book } = entry

	return {
		id: entry.publishedAs ?? book.id,
		title: book.title || null,
		source: 'local',
		format: 'svg',
		featured: false,
		// Always false, and not a field on a queued book: the save form's checkbox is
		// gone and flagging is an admin action on a published row.
		nsfw: false,
		created_at: book.createdAt,
		data_url: artworkUrl(book),
		thumbnail_url: book.thumbnailDataUrl,
		// The server cuts the cover page out of the artwork as an SVG on the way in, and
		// nothing here can: that is `lib/thumbnail.js`, server side. The PNG beside it is
		// what a card falls back to, and it is a picture of the same page.
		thumbnail_svg_url: null,
		// Read off the artwork rather than stored beside it: this is the same answer the
		// server would write into the row on upload, from the same rule, so a queued card
		// is the shape the published one will be. See `pageSizeFromSvg`.
		...pageSizeFromSvg(book.svg),
	}
}

/** The same, with the fields the playback page reads. */
export function pendingFlipbook(entry: PendingEntry): Flipbook {
	return {
		...pendingSummary(entry),
		description: entry.book.description || null,
		byline: '',
		views: 0,
		// No lineage until it is a row. A remix that hasn't been published has no
		// siblings to list and nothing to link back to that the reader could be shown.
		remix_of: null,
		remix_root: entry.book.id,
	}
}

/** What `sync.ts` posts. The save, put back together as it was made. */
export function pendingPayload(book: PendingFlipbook): SavePayload {
	return {
		title: book.title,
		description: book.description,
		svg: book.svg,
		thumbnailDataUrl: book.thumbnailDataUrl,
		cover: book.cover,
		remixOf: book.remixOf,
	}
}

function patch(id: string, changes: Partial<Omit<PendingEntry, 'book'>>): void {
	store.set({
		entries: store.snapshot.entries.map((entry) =>
			entry.book.id === id ? { ...entry, ...changes } : entry,
		),
	})
}

/**
 * Reads the queue in from storage, once.
 *
 * Called on boot by `startOfflineSync`. Anything already in the store wins — a save
 * queued in this page view is in memory before it is in IndexedDB, and a slow read
 * landing on top of it would take the card back off the screen.
 */
export async function loadPending(): Promise<void> {
	if (store.snapshot.loaded) return

	let books: PendingFlipbook[] = []
	try {
		books = await db.readAll<PendingFlipbook>()
	} catch {
		// No storage, or a database that won't open. There is nothing queued as far as
		// anyone can tell, which is the only honest answer and the one that lets the
		// gallery get on with drawing itself.
	}

	const known = new Set(store.snapshot.entries.map((entry) => entry.book.id))
	const restored = books
		.filter((book) => !known.has(book.id))
		.map<PendingEntry>((book) => ({ book, status: 'waiting', publishedAs: null, error: null }))

	store.set({
		entries: [...restored, ...store.snapshot.entries].sort((a, b) =>
			b.book.createdAt.localeCompare(a.book.createdAt),
		),
		loaded: true,
	})
}

/**
 * Puts a failed save in the queue. Rejects if it can't be stored, which the create
 * page has to know about — by then the drawing is nowhere else.
 */
export async function queueFlipbook(payload: SavePayload): Promise<PendingEntry> {
	const book: PendingFlipbook = {
		id: newPendingId(),
		title: payload.title,
		description: payload.description,
		svg: payload.svg,
		thumbnailDataUrl: payload.thumbnailDataUrl,
		cover: payload.cover,
		remixOf: payload.remixOf ?? null,
		createdAt: new Date().toISOString(),
	}

	await db.write(book)

	const entry: PendingEntry = { book, status: 'waiting', publishedAs: null, error: null }
	store.set({ entries: [entry, ...store.snapshot.entries] })

	return entry
}

/** One queued flipbook, for a permalink opened cold. */
export async function getPending(id: string): Promise<PendingEntry | null> {
	const known = store.snapshot.entries.find((entry) => entry.book.id === id)
	if (known) return known

	// Not in the store, which on a fresh load simply means the read hasn't happened
	// yet — this page can be the first thing the tab opens.
	try {
		await loadPending()
	} catch {
		return null
	}

	return store.snapshot.entries.find((entry) => entry.book.id === id) ?? null
}

/** Throws it away, for good. The only way to remove one without publishing it. */
export async function discardPending(id: string): Promise<void> {
	try {
		await db.erase(id)
	} catch {
		// It may never have reached storage. Either way it goes from the list, which is
		// what the reader asked for.
	}

	releaseArtwork(id)
	store.set({ entries: store.snapshot.entries.filter((entry) => entry.book.id !== id) })
}

/** `sync.ts` only: the three things that happen to an entry on its way up. */
export function markUploading(id: string): void {
	patch(id, { status: 'uploading', error: null })
}

export async function markPublished(id: string, publishedAs: string): Promise<void> {
	// Out of storage first: a record that has been published and not erased would be
	// published again by the next page load, and there is no key to deduplicate on.
	await db.erase(id)
	patch(id, { status: 'published', publishedAs, error: null })
}

export function markFailed(id: string, error: string | null): void {
	patch(id, { status: error ? 'failed' : 'waiting', error })
}

export function usePending(): PendingEntry[] {
	return useStore(store).entries
}

/** Test seam. Nothing in the app empties the list without emptying storage too. */
export function resetPending(): void {
	for (const id of [...artworkUrls.keys()]) releaseArtwork(id)
	store.set({ entries: [], loaded: false })
}

/**
 * Whether storage still holds this one — which is to say, whether another tab has
 * published it since this tab read the queue in. See `flushPending`.
 */
export async function stillQueued(id: string): Promise<boolean> {
	try {
		return (await db.read<PendingFlipbook>(id)) !== undefined
	} catch {
		// No storage to ask. Better to try the upload than to drop a drawing on the
		// strength of a question that couldn't be put.
		return true
	}
}

/** `sync.ts` only: the queue as it stands, outside React. */
export function pendingEntries(): PendingEntry[] {
	return store.snapshot.entries
}

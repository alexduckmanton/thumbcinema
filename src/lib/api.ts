/**
 * The whole API surface, in one typed client.
 *
 * `lib/router.js` is the server side of every one of these. Its two hard contracts
 * are worth restating here because they're easy to break from this end:
 *
 *  - `POST /saveflipbook` is form-encoded and answers with a bare `/f/{id}` in the
 *    response body, not JSON. It's the 2013 endpoint and the shape is deliberate.
 *  - `GET /api/flipbooks/:id/data` serves `legacy-json` as `text/plain`, so it has
 *    to be read as text and parsed here rather than trusted to be JSON.
 */

export type FlipbookFormat = 'svg' | 'legacy-json'

/**
 * A row as it appears in the gallery grid.
 *
 * `format` and `data_url` are here so a card can play without asking for its
 * metadata first: hovering one fetches the artwork straight away, and the format is
 * what says how to read it. Without them the hover would cost a round trip before it
 * could start one.
 */
export interface FlipbookSummary {
	id: string
	title: string | null
	source: string
	format: FlipbookFormat
	featured: boolean
	nsfw: boolean
	created_at: string
	data_url: string
	thumbnail_url: string
	/**
	 * The cover page as an SVG — what a card shows, when the row has one.
	 *
	 * Null for the three kinds of row that haven't got one: a `time-capsule` save,
	 * which knows nothing about the column; a `legacy-json` flipbook, which has no
	 * SVG anywhere in it to take a page out of; and anything
	 * `npm run db:backfill-thumbnails` hasn't reached. Those fall back to
	 * `thumbnail_url`, which is still written on every save and isn't going anywhere.
	 *
	 * Stated by the server rather than guessed at here, because a card that simply
	 * tried the SVG first would put a 404 in front of every PNG in the grid.
	 */
	thumbnail_svg_url: string | null
}

/** A single flipbook, as the playback page needs it. */
export interface Flipbook extends FlipbookSummary {
	description: string | null
	byline: string
	views: number
}

export interface FlipbookPage {
	items: FlipbookSummary[]
	view: GalleryView
	limit: number
	next_cursor: string | null
}

export type GalleryView = 'featured' | 'all'

export interface AdminFlags {
	id: string
	featured: boolean
	nsfw: boolean
}

/** Anything the API answered with that wasn't a success. */
export class ApiError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = 'ApiError'
		this.status = status
	}
}

export interface RequestOptions {
	/** Aborts the request — the gallery uses this when you switch tabs mid-fetch. */
	signal?: AbortSignal
	/** Admin bearer token, when there is one. Also affects reads: see listFlipbooks. */
	headers?: Record<string, string>
}

async function fail(response: Response): Promise<never> {
	let message = response.statusText || 'Request failed'
	try {
		const body = (await response.json()) as { error?: string }
		if (body?.error) message = body.error
	} catch {
		// A non-JSON error body is fine; the status is the useful part.
	}
	throw new ApiError(response.status, message)
}

async function getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
	const response = await fetch(url, {
		headers: { Accept: 'application/json', ...options.headers },
		signal: options.signal,
	})
	if (!response.ok) return fail(response)
	return (await response.json()) as T
}

/**
 * The gallery listing. `cursor` is opaque keyset pagination — hand back whatever
 * the previous page's `next_cursor` was and don't try to construct one.
 *
 * The admin header matters on this read as well as on writes: it's what makes NSFW
 * rows visible in the All tab, so anything moderated can still be found again.
 */
export function listFlipbooks(
	params: { view: GalleryView; limit: number; cursor?: string | null },
	options: RequestOptions = {},
): Promise<FlipbookPage> {
	const query = new URLSearchParams({ view: params.view, limit: String(params.limit) })
	if (params.cursor) query.set('cursor', params.cursor)

	return getJson<FlipbookPage>(`/api/flipbooks?${query}`, options)
}

/** Metadata for one flipbook. Also increments its view counter, server side. */
export function getFlipbook(id: string, options: RequestOptions = {}): Promise<Flipbook> {
	return getJson<Flipbook>(`/api/flipbooks/${encodeURIComponent(id)}`, options)
}

/**
 * The artwork itself, as text.
 *
 * Deliberately not parsed here. SVG is handed to the DOM parser and legacy JSON to
 * `JSON.parse`, and which one it is comes from the flipbook's `format` — the
 * response's content type is an implementation detail of how it's stored.
 */
export async function getFlipbookData(
	dataUrl: string,
	options: RequestOptions = {},
): Promise<string> {
	const response = await fetch(dataUrl, { signal: options.signal })
	if (!response.ok) return fail(response)
	return response.text()
}

/** Admin only: set either flag, leaving the other alone when it isn't passed. */
export async function setFlipbookFlags(
	id: string,
	flags: { featured?: boolean; nsfw?: boolean },
	options: RequestOptions = {},
): Promise<AdminFlags> {
	const response = await fetch(`/api/admin/flipbooks/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', ...options.headers },
		body: JSON.stringify(flags),
		signal: options.signal,
	})
	if (!response.ok) return fail(response)
	return (await response.json()) as AdminFlags
}

export interface SavePayload {
	title: string
	description: string
	/** paper.js `exportSVG()` output, serialised. */
	svg: string
	/** A `data:image/png;base64,…` URL for the thumbnail. */
	thumbnailDataUrl: string
	/**
	 * Which page that thumbnail is of. The server cuts the same page out of the
	 * artwork as an SVG, which is what the gallery shows; sending the index is what
	 * keeps the two pictures of the same drawing.
	 */
	cover: number
	nsfw: boolean
}

/**
 * The 2013 save endpoint, unchanged: form-encoded in, a bare permalink out.
 *
 * Vercel caps the request at ~4 MB and form encoding inflates the SVG, so the
 * practical ceiling is roughly a 2.5 MB drawing; the server answers 413 past that
 * and the message comes back through `ApiError`.
 */
export async function saveFlipbook(
	payload: SavePayload,
	options: RequestOptions = {},
): Promise<string> {
	const form = new URLSearchParams({
		title: payload.title,
		description: payload.description,
		project: payload.svg,
		imgBase64: payload.thumbnailDataUrl,
		// Additive, and ignored by the 2013 endpoint's own reading of this form —
		// which matters because that endpoint is the contract both deployments post
		// to. See docs/data-formats.md.
		cover: String(payload.cover),
		nsfw: payload.nsfw ? '1' : '0',
	})

	const response = await fetch('/saveflipbook', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: form,
		signal: options.signal,
	})
	if (!response.ok) return fail(response)

	// A bare "/f/{id}". data.js used to assign this straight to location.href.
	return (await response.text()).trim()
}

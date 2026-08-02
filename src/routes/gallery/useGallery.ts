import { useCallback, useEffect, useRef, useState } from 'react'

import { adminHeaders } from '../../lib/admin'
import { listFlipbooks, type FlipbookSummary, type GalleryView } from '../../lib/api'

const PAGE_SIZE = 24

export interface GalleryResult {
	items: FlipbookSummary[]
	loading: boolean
	/** True once there is definitively nothing more to fetch. */
	exhausted: boolean
	failed: boolean
	loadMore: () => void
	/** Retries after a failure, and the only way back once `failed` is set. */
	retry: () => void
	updateItem: (id: string, patch: Partial<FlipbookSummary>) => void
}

/**
 * The browse grid's data.
 *
 * Two things it has to get right:
 *
 *  - **Keyset pagination, not OFFSET.** With an infinite scroll and OFFSET, one
 *    flipbook saved mid-scroll shifts every later row down and the reader sees a
 *    duplicate. Cursors compare on `(created_at, id)`, which is stable under inserts.
 *  - **Abandoning in-flight requests on a tab switch.** Switching tabs empties the
 *    grid, so a response still in flight from the previous tab would otherwise land
 *    in it and splice the two lists together. 2013 counted generations; an
 *    AbortController does the same job and also stops the request.
 */
export function useGallery(view: GalleryView): GalleryResult {
	const [items, setItems] = useState<FlipbookSummary[]>([])
	// True from the outset, not from when the fetch starts. The first page is asked for
	// in an effect, which runs after the first paint, so starting at false means one
	// frame of an empty grid and "Nothing here yet." before the skeleton appears. This
	// hook is never mounted and not loading.
	const [loading, setLoading] = useState(true)
	const [exhausted, setExhausted] = useState(false)
	const [failed, setFailed] = useState(false)

	const cursor = useRef<string | null>(null)
	const inFlight = useRef<AbortController | null>(null)
	// Read inside the fetch so `loadMore` can stay a stable callback.
	const state = useRef({ loading: false, exhausted: false })

	const fetchPage = useCallback(async (currentView: GalleryView) => {
		if (state.current.loading || state.current.exhausted) return

		state.current.loading = true
		setLoading(true)
		setFailed(false)

		const controller = new AbortController()
		inFlight.current = controller

		try {
			const page = await listFlipbooks(
				{ view: currentView, limit: PAGE_SIZE, cursor: cursor.current },
				{ signal: controller.signal, headers: adminHeaders() },
			)

			cursor.current = page.next_cursor
			setItems((previous) => [...previous, ...page.items])

			if (!page.next_cursor) {
				state.current.exhausted = true
				setExhausted(true)
			}
		} catch {
			if (controller.signal.aborted) return

			// Stop, rather than hammering a failing endpoint on every scroll tick.
			// `retry` is what clears this.
			state.current.exhausted = true
			setExhausted(true)
			setFailed(true)
		} finally {
			if (!controller.signal.aborted) {
				state.current.loading = false
				setLoading(false)
			}
		}
	}, [])

	// A tab switch is a fresh list: cancel anything outstanding and start over.
	useEffect(() => {
		inFlight.current?.abort()

		cursor.current = null
		state.current = { loading: false, exhausted: false }

		setItems([])
		setExhausted(false)
		setFailed(false)

		void fetchPage(view)

		return () => inFlight.current?.abort()
	}, [view, fetchPage])

	const loadMore = useCallback(() => {
		void fetchPage(view)
	}, [fetchPage, view])

	const retry = useCallback(() => {
		state.current.exhausted = false
		setExhausted(false)
		void fetchPage(view)
	}, [fetchPage, view])

	const updateItem = useCallback((id: string, patch: Partial<FlipbookSummary>) => {
		setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)))
	}, [])

	return { items, loading, exhausted, failed, loadMore, retry, updateItem }
}

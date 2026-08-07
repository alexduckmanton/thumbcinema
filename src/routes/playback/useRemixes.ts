import { useCallback, useEffect, useState } from 'react'

import { listRemixes, type FlipbookSummary } from '../../lib/api'

/** A page of them. Smaller than the gallery's 24: this is a list inside a column. */
const PAGE_SIZE = 12

export interface Remixes {
	items: FlipbookSummary[]
	/** True until the first page has been answered, one way or the other. */
	loading: boolean
	/** Whether there are more to ask for. */
	more: boolean
	loadMore: () => void
}

/**
 * A page of the list that has been asked for and not yet answered.
 *
 * An object rather than a bare cursor, so that "the first page" — whose cursor is
 * legitimately null — is distinguishable from "nothing asked for yet". The identity of
 * the object is also what re-runs the fetch when `loadMore` is pressed twice with the
 * same cursor after a failure.
 */
interface Request {
	cursor: string | null
}

/**
 * Everything made from one flipbook.
 *
 * `root` is the flipbook's `remix_root` rather than its id, so a remix shows the same
 * list as the original it came from — the lineage is flat and every page in it is
 * looking at the same family.
 *
 * Deliberately quieter than `useGallery`, and the differences are all the same
 * difference: this is a list at the bottom of a page about something else.
 *
 *  - **No skeleton and no error state.** The gallery *is* its list, so a page that
 *    can't fetch one has to say so. Here the flipbook is the page and this is a
 *    footnote to it; a footnote that fails should be absent, not an apology. So a
 *    failed fetch leaves `items` empty and the section renders nothing at all.
 *  - **No infinite scroll.** The bottom of this page is the bottom of the page, and a
 *    scroll that kept extending it would make the flipbook harder to get back to.
 *    A button, and only when there is more.
 *  - **Nothing is fetched until there is a root to ask about**, which is after the
 *    metadata lands. That is one round trip behind the flipbook itself, and it is the
 *    right order: this is below the fold on every layout.
 */
export function useRemixes(root: string | null): Remixes {
	const [items, setItems] = useState<FlipbookSummary[]>([])
	const [cursor, setCursor] = useState<string | null>(null)
	const [more, setMore] = useState(false)
	const [request, setRequest] = useState<Request | null>(null)

	// True from the start rather than false, for the reason `useGallery` starts that
	// way: the first page is asked for in an effect, which runs after the first paint,
	// so the alternative is a frame in which the list has honestly finished and is empty.
	const [loading, setLoading] = useState(true)

	// The first page, and a fresh one whenever the flipbook changes. The route is keyed
	// on the id so this component is rebuilt rather than reused, but the reset is here
	// anyway: it costs four lines and it is what makes the hook correct on its own terms.
	useEffect(() => {
		setItems([])
		setCursor(null)
		setMore(false)
		setLoading(Boolean(root))
		setRequest(root ? { cursor: null } : null)
	}, [root])

	useEffect(() => {
		if (!root || !request) return

		const controller = new AbortController()
		const { cursor: from } = request

		listRemixes(root, { limit: PAGE_SIZE, cursor: from }, { signal: controller.signal })
			.then((page) => {
				if (controller.signal.aborted) return
				// Appended rather than replaced, because `from` is a cursor into a list this
				// already holds the front of. A first page replaces, so a re-fetch of one
				// can't double it up.
				setItems((current) => (from ? [...current, ...page.items] : page.items))
				setCursor(page.next_cursor)
				setMore(Boolean(page.next_cursor))
				setLoading(false)
			})
			.catch(() => {
				if (controller.signal.aborted) return
				// Nothing to say. See above: a footnote that fails is absent.
				setMore(false)
				setLoading(false)
			})

		return () => controller.abort()
	}, [root, request])

	const loadMore = useCallback(() => {
		if (cursor) setRequest({ cursor })
	}, [cursor])

	return { items, loading, more, loadMore }
}

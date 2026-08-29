/**
 * The other half of the queue: getting it up there.
 *
 * One rule, and it is the whole of the design — a flipbook saved offline is posted by
 * the same `saveFlipbook` a flipbook saved online is, with the same body, to the same
 * endpoint. There is no second write path and nothing on the server knows this feature
 * exists. What was missing was a connection, so all this does is wait for one.
 *
 * It runs from `main.tsx` rather than from a route, because the queue is a fact about
 * the tab and not about the page: a flipbook queued on the create page should go up
 * while its author is reading the gallery, or the playback page, or nothing at all.
 */

import { isNetworkFailure, saveFlipbook } from '../lib/api'
import { showMessage } from '../lib/messages'
import {
	discardPending,
	loadPending,
	markFailed,
	markPublished,
	markUploading,
	pendingEntries,
	pendingPayload,
	stillQueued,
} from './pending'

/** True while a flush is in flight, so two triggers can't post the same queue twice. */
let flushing = false

/**
 * The same guarantee across tabs, where `flushing` can't reach.
 *
 * Two tabs open when the connection comes back is two flushes over one queue, and the
 * queue is shared: without this they would both post the same flipbook and it would
 * appear in the gallery twice. The Web Locks API is the cross-tab version of the flag
 * above — one holder at a time, released when the tab that took it goes away — and the
 * check that goes with it is `stillQueued`, which is what makes the second tab notice
 * there is nothing left to do.
 *
 * Where there are no locks (older Safari) the flush simply runs. The duplicate needs
 * two tabs reconnecting in the same instant to happen at all, and a flipbook published
 * twice is a great deal better than one published never.
 */
function withLock<T>(work: () => Promise<T>): Promise<T> {
	if (typeof navigator === 'undefined' || !navigator.locks) return work()
	return navigator.locks.request('thumbcinema-offline-sync', work) as Promise<T>
}

/**
 * Starts watching. Idempotent in the way that matters: `main.tsx` calls it once.
 *
 * The `online` event is the trigger and the boot flush is the backstop, because that
 * event is not reliable on its own — it fires on an interface coming back, which is not
 * the same thing as the internet coming back, and a tab that was closed offline and
 * opened online never sees one at all.
 */
export function startOfflineSync(): void {
	void loadPending().then(() => flushPending())

	window.addEventListener('online', () => {
		void flushPending()
	})
}

/**
 * Posts everything waiting, oldest first, one at a time.
 *
 * Serial rather than parallel, and deliberately: these are megabyte uploads on the
 * connection that has just come back, and a queue of them fired at once is the way to
 * make all of them fail. The first network failure stops the run — if one couldn't
 * reach the server neither will the next, and the queue keeps for the next trigger.
 */
export async function flushPending(): Promise<void> {
	if (flushing) return
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return

	flushing = true
	let published = 0

	try {
		await withLock(async () => {
			// Oldest first, so the gallery ends up ordered the way it would have been if
			// every one of them had been saved when it was drawn.
			const waiting = pendingEntries()
				.filter((entry) => entry.status === 'waiting' || entry.status === 'failed')
				.reverse()

			for (const entry of waiting) {
				// Storage is the source of truth about what is still owed, and this tab is not
				// the only one that can have posted it. Asked inside the lock, so the answer
				// can't go stale between the question and the request. See `withLock`.
				if (!(await stillQueued(entry.book.id))) {
					await discardPending(entry.book.id)
					continue
				}

				markUploading(entry.book.id)

				try {
					const location = await saveFlipbook(pendingPayload(entry.book))
					await markPublished(entry.book.id, location.replace(/^\/f\//, ''))
					published++
				} catch (error) {
					// A server that answered is a server with an opinion — the flipbook is too
					// big, or something is wrong with it — and posting it again on every
					// `online` event for the rest of time won't change that opinion. It stays
					// in the queue, but it says why, and the playback page offers to throw it
					// away. Anything else is the connection, and the connection will be back.
					const reason = isNetworkFailure(error)
						? null
						: error instanceof Error
							? error.message
							: 'Something went wrong.'
					markFailed(entry.book.id, reason)
					if (!reason) break
				}
			}
		})
	} catch {
		// Storage refusing mid-run, or a lock that couldn't be taken. Whatever is left is
		// still in the queue and the next trigger will find it — and swallowing it here is
		// not tidiness: an unhandled rejection is what the drawing tool's crash handler
		// listens for, and a background upload must not be able to put a red screen in
		// front of somebody's work. See `useCrashRecovery`.
	} finally {
		flushing = false
	}

	if (published === 0) return

	showMessage({
		copy:
			published === 1
				? "You're back online and your flipbook's published."
				: `You're back online and your ${published} flipbooks are published.`,
		cta: 'Nice one',
		type: 'success',
	})
}

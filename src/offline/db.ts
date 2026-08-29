/**
 * The queue's storage, and the only place in the app that speaks to IndexedDB.
 *
 * IndexedDB rather than the localStorage everything else here uses, and for one
 * reason: size. A queued flipbook is the whole drawing — up to ~2.5 MB of SVG, plus a
 * PNG of its cover — and localStorage is a ~5 MB budget for the entire origin, shared
 * with the crash-recovery file the drawing tool writes into the same tab. Two offline
 * saves would fill it and the third would throw, which is precisely the moment this
 * feature exists to be reliable in.
 *
 * Deliberately tiny: four functions over one object store, promises instead of event
 * handlers, and no schema beyond a key path. A wrapper library would be more code than
 * this file is.
 *
 * Everything here rejects rather than swallowing: a queue that quietly failed to write
 * would be worse than no queue at all, because the drawing would be gone either way
 * and only one of the two says so.
 */

const DB_NAME = 'thumbcinema'
const DB_VERSION = 1
const STORE = 'pending'

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
	if (opening) return opening

	const attempt = new Promise<IDBDatabase>((resolve, reject) => {
		// Private modes and locked-down browsers have been known to remove it outright.
		if (typeof indexedDB === 'undefined') {
			reject(new Error('No IndexedDB in this browser.'))
			return
		}

		const request = indexedDB.open(DB_NAME, DB_VERSION)

		request.onupgradeneeded = () => {
			const database = request.result
			if (!database.objectStoreNames.contains(STORE)) {
				database.createObjectStore(STORE, { keyPath: 'id' })
			}
		}

		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open.'))
		// Firefox in private browsing answers the open request with this rather than an
		// error, and without it the promise would simply never settle.
		request.onblocked = () => reject(new Error('IndexedDB is blocked.'))
	})

	opening = attempt
	// A failure isn't remembered. Storage can be refused once and granted later — a
	// quota prompt answered, a private window closed — and a cached rejection here
	// would outlive the reason for it for the rest of the page's life.
	attempt.catch(() => {
		if (opening === attempt) opening = null
	})

	return attempt
}

function run<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return open().then(
		(database) =>
			new Promise<T>((resolve, reject) => {
				const transaction = database.transaction(STORE, mode)
				const request = work(transaction.objectStore(STORE))

				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
				// The request's own error doesn't fire for everything that can go wrong —
				// a quota refusal aborts the transaction around it.
				transaction.onabort = () =>
					reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
			}),
	)
}

/** Every queued record, in insertion order. */
export function readAll<T>(): Promise<T[]> {
	return run('readonly', (store) => store.getAll() as IDBRequest<T[]>)
}

/** One record, or undefined when there is no such key. */
export function read<T>(id: string): Promise<T | undefined> {
	return run('readonly', (store) => store.get(id) as IDBRequest<T | undefined>)
}

/** Writes a record, replacing any with the same id. Rejects if there's no room. */
export async function write(record: { id: string }): Promise<void> {
	await run('readwrite', (store) => store.put(record))
}

export async function erase(id: string): Promise<void> {
	await run('readwrite', (store) => store.delete(id))
}

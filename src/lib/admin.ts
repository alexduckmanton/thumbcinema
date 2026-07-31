/**
 * Admin mode.
 *
 * There are no accounts on this site — that whole layer was deliberately deleted —
 * so curation is gated on a single shared secret instead. Visit any page with
 * `?admin=<token>` once and it's remembered in localStorage; from then on the two
 * toggles appear on gallery cards and on flipbook pages, and every write is sent
 * with an Authorization header the API checks.
 *
 * The token affects reads too: it's what makes NSFW rows visible in the All tab, so
 * anything moderated can still be found and un-flagged.
 */

const STORAGE_KEY = 'tc_admin_token'

let token = readToken()

/**
 * `?admin=…` wins over anything stored, and is scrubbed from the URL immediately so
 * the token isn't sitting in the address bar during a screen share.
 *
 * Exported for the tests; the module-level read on import is the real entry point.
 */
export function readToken(search = window.location.search): string | null {
	const supplied = new URLSearchParams(search).get('admin')

	if (supplied) {
		safeWrite(supplied)
		scrubUrl()
		return supplied
	}

	try {
		return window.localStorage.getItem(STORAGE_KEY)
	} catch {
		// Private-mode Safari and friends. Admin mode simply stays off.
		return null
	}
}

function scrubUrl(): void {
	const params = new URLSearchParams(window.location.search)
	params.delete('admin')

	const query = params.toString()
	const clean = window.location.pathname + (query ? `?${query}` : '') + window.location.hash
	window.history.replaceState({}, '', clean)
}

function safeWrite(value: string): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, value)
	} catch {
		// Nothing to do — the token still works for this page view.
	}
}

export function isAdmin(): boolean {
	return token !== null
}

/** Sent on reads as well as writes. Empty when admin mode is off. */
export function adminHeaders(): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Called when the API says the token has stopped working. */
export function signOut(): void {
	try {
		window.localStorage.removeItem(STORAGE_KEY)
	} catch {
		// Already gone as far as this page is concerned.
	}
	token = null
}

/** Test seam: re-reads the URL and storage after either has been changed. */
export function refresh(): void {
	token = readToken()
}

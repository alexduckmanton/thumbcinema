/**
 * Whether there is a connection, as a hook.
 *
 * `navigator.onLine` is a weak claim — it says an interface exists, not that anything
 * is reachable through it, and it is confidently wrong on a captive portal — so nothing
 * here *decides* anything with it. What fails a save is a request failing (see
 * `isNetworkFailure`); this is only ever used to word a message. That is a job it is
 * good enough for: it is right about the case that matters, which is a phone with the
 * radios off.
 */

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
	window.addEventListener('online', onChange)
	window.addEventListener('offline', onChange)
	return () => {
		window.removeEventListener('online', onChange)
		window.removeEventListener('offline', onChange)
	}
}

function getSnapshot(): boolean {
	return navigator.onLine !== false
}

export function useOnline(): boolean {
	// Assumed online on the server side of the check, which is what a browser with no
	// `navigator.onLine` at all should be treated as too: online is the state in which
	// the site behaves exactly as it always has.
	return useSyncExternalStore(subscribe, getSnapshot, () => true)
}

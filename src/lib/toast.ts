import { Store } from './store'
import { useStore } from './store'

/**
 * The toast that slides up from the bottom of the window.
 *
 * Two ways in. `showToast` puts one up now; `registerToast` leaves one for the *next*
 * page, which is what a successful save uses — it navigates to the new flipbook, and
 * the confirmation has to survive the navigation.
 *
 * Two types and no more. `info` is the black one and covers everything that went to
 * plan; `error` is the red one and means something didn't. There is no `success`: a
 * third colour asks the reader to learn a code for information the sentence already
 * carries. There is no per-message call to action either — every toast dismisses with
 * "Got it", and the button says so in the component rather than at each call site,
 * because the wording drifting apart is exactly what this replaced.
 *
 * Before this it was a banner that took over the header and dropped in a word at a
 * time. It was charming once and in the way every time after: it moved the page's own
 * furniture to say something small.
 */

export type ToastType = 'info' | 'error'

export interface Toast {
	copy: string
	type: ToastType
}

const HANDOVER_KEY = 'message'

const store = new Store<{ toast: Toast | null }>({ toast: null })

export function showToast(toast: Toast): void {
	store.set({ toast })
}

export function hideToast(): void {
	store.set({ toast: null })
}

/** Stashes a toast for the next page load. */
export function registerToast(toast: Toast): void {
	try {
		window.localStorage.setItem(HANDOVER_KEY, JSON.stringify(toast))
	} catch {
		// The toast is a nicety; losing it is not worth failing a save over.
	}
}

/** Shows and clears anything a previous page left behind. Called once, on boot. */
export function takeRegisteredToast(): void {
	let raw: string | null = null
	try {
		raw = window.localStorage.getItem(HANDOVER_KEY)
		window.localStorage.removeItem(HANDOVER_KEY)
	} catch {
		return
	}
	if (!raw) return

	try {
		const toast = JSON.parse(raw) as Toast
		// The type check is not only validation: a tab that was open across the deploy
		// can hand over a `success` from the old shape, and there is no such colour now.
		if (toast?.copy && (toast.type === 'info' || toast.type === 'error')) showToast(toast)
	} catch {
		// Somebody else's localStorage key, or a half-written one. Ignore it.
	}
}

export function useToast(): Toast | null {
	return useStore(store).toast
}

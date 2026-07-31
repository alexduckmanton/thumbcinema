import { Store } from './store'
import { useStore } from './store'

/**
 * The banner that drops out of the header a word at a time.
 *
 * Two ways in. `showMessage` puts one up now; `registerMessage` leaves one for the
 * *next* page, which is what a successful save uses — it navigates to the new
 * flipbook, and the congratulations has to survive the navigation.
 */

export type MessageType = 'info' | 'success' | 'error'

export interface Message {
	copy: string
	/** The dismiss link's label. Half the character of the thing is in these. */
	cta: string
	type: MessageType
}

const HANDOVER_KEY = 'message'

const store = new Store<{ message: Message | null }>({ message: null })

export function showMessage(message: Message): void {
	store.set({ message })
}

export function hideMessage(): void {
	store.set({ message: null })
}

/** Stashes a message for the next page load. */
export function registerMessage(message: Message): void {
	try {
		window.localStorage.setItem(HANDOVER_KEY, JSON.stringify(message))
	} catch {
		// The message is a nicety; losing it is not worth failing a save over.
	}
}

/** Shows and clears anything a previous page left behind. Called once, on boot. */
export function takeRegisteredMessage(): void {
	let raw: string | null = null
	try {
		raw = window.localStorage.getItem(HANDOVER_KEY)
		window.localStorage.removeItem(HANDOVER_KEY)
	} catch {
		return
	}
	if (!raw) return

	try {
		const message = JSON.parse(raw) as Message
		if (message?.copy && message?.cta && message?.type) showMessage(message)
	} catch {
		// Somebody else's localStorage key, or a half-written one. Ignore it.
	}
}

export function useMessage(): Message | null {
	return useStore(store).message
}

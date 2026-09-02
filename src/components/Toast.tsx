import { useEffect, useState } from 'react'

import { hideToast, useToast } from '../lib/toast'
import styles from './Toast.module.css'

/**
 * How long an `info` toast stays up before it takes itself away.
 *
 * Errors don't get one. Something that went wrong is usually something the reader has
 * to do about, and a sentence that leaves on its own is a sentence they can miss.
 */
const LINGER_MS = 5000

/** Long enough for the slide-out; the CSS says the same number. */
const EXIT_MS = 200

export interface ToastProps {
	/**
	 * True on a page that keeps a fixed bar along the bottom of the window — the create
	 * page, and only the create page. See `.lifted` in the stylesheet.
	 */
	lift?: boolean
}

/**
 * The toast, bottom centre of the window.
 *
 * `position: fixed`, so it belongs to no page in particular and sits over the create
 * page's tray and page bar rather than moving them. One at a time: the store holds a
 * single toast and a new one replaces whatever is up, which is all this app has ever
 * needed — there is no path that raises two things worth saying at once.
 *
 * No window-level key handler. The 2013 banner took Escape, Enter and Space because it
 * was a bar across the top with one action and nothing else on the page wanted them;
 * a toast isn't modal, and Escape belongs to the save form and the trace menu, which
 * are. The button is in the tab order and answers Enter and Space on its own.
 */
export function Toast({ lift = false }: ToastProps) {
	const toast = useToast()

	// Mirrors the store one beat behind, so the toast can animate out after the store
	// has already let go of it. `shown` is what's on screen; `toast` is what should be.
	const [shown, setShown] = useState(toast)
	const leaving = toast === null && shown !== null

	useEffect(() => {
		if (toast) setShown(toast)
	}, [toast])

	useEffect(() => {
		if (!leaving) return
		const timer = window.setTimeout(() => setShown(null), EXIT_MS)
		return () => window.clearTimeout(timer)
	}, [leaving])

	useEffect(() => {
		if (toast?.type !== 'info') return
		const timer = window.setTimeout(hideToast, LINGER_MS)
		return () => window.clearTimeout(timer)
	}, [toast])

	if (!shown) return null

	return (
		<div
			className={[
				styles.toast,
				styles[shown.type],
				lift ? styles.lifted : '',
				leaving ? styles.leaving : '',
			]
				.filter(Boolean)
				.join(' ')}
			// An error is assertive (`alert`) and everything else polite (`status`): the
			// black one is a receipt for something the reader just did and can wait for a
			// gap, the red one is news they didn't ask for.
			role={shown.type === 'error' ? 'alert' : 'status'}
		>
			<p className={styles.copy}>{shown.copy}</p>
			<button type="button" className={styles.dismiss} onClick={hideToast}>
				Got it
			</button>
		</div>
	)
}

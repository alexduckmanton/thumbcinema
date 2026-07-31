import { useEffect } from 'react'

import { hideMessage, useMessage } from '../lib/messages'
import styles from './Messages.module.css'

/**
 * Renders whatever message is up, over the header.
 *
 * Escape, Enter and Space all dismiss it, as they did in 2013 — it's a banner with
 * one action, and any of the three keys a reader might reach for should do it.
 */
export function Messages() {
	const message = useMessage()

	useEffect(() => {
		if (!message) return

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== ' ') return
			event.preventDefault()
			hideMessage()
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [message])

	if (!message) return null

	return (
		<>
			<div className={`${styles.backdrop} ${styles[message.type]}`} aria-hidden="true" />
			<ul className={`${styles.messages} ${styles[message.type]}`} role="status" aria-live="polite">
				{/* One <li> per word: each drops in on its own timing. */}
				{message.copy.split(' ').map((word, index) => (
					<li key={`${index}-${word}`} className={styles.word}>
						{/* The space belongs in the text, not in the gap between the list
						    items: a screen reader reads the words and would otherwise run
						    the whole sentence together. */}
						{word}&nbsp;
					</li>
				))}
				<li className={styles.word}>
					<button type="button" className={styles.dismiss} onClick={hideMessage}>
						{message.cta}
					</button>
				</li>
			</ul>
		</>
	)
}

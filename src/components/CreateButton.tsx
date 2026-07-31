import { useEffect, useState } from 'react'

import { Link } from '../router/Router'
import styles from './CreateButton.module.css'

/**
 * Far enough that a stray trackpad nudge doesn't collapse the button, close enough
 * that it has folded before the header has left the screen.
 */
const THRESHOLD = 48

/**
 * Extended while you're at the top of the page, folded to a plain circle once you
 * start scrolling.
 *
 * The scroll position is read on a timer rather than on every event: the class only
 * changes twice in a whole page's worth of scrolling, so the throttle is about not
 * touching `scrollY` sixty times a second, not about the write.
 */
export function CreateButton() {
	const [scrolled, setScrolled] = useState(() => window.scrollY > THRESHOLD)

	useEffect(() => {
		let ticking = false

		const update = () => {
			setScrolled(window.scrollY > THRESHOLD)
		}

		const onScroll = () => {
			if (ticking) return
			ticking = true
			window.setTimeout(() => {
				ticking = false
				update()
			}, 100)
		}

		// A reload partway down a page restores the scroll position, so the button
		// has to start folded rather than expanded and then jump.
		update()

		window.addEventListener('scroll', onScroll, { passive: true })
		window.addEventListener('resize', onScroll)
		return () => {
			window.removeEventListener('scroll', onScroll)
			window.removeEventListener('resize', onScroll)
		}
	}, [])

	return (
		<Link
			to="/create"
			className={scrolled ? `${styles.fab} ${styles.scrolled}` : styles.fab}
			aria-label="New flipbook"
			title="New flipbook"
		>
			<span className={styles.label}>New</span>
		</Link>
	)
}

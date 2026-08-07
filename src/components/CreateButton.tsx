import { useEffect, useState } from 'react'

import { Link } from '../router/Router'
import { createPath } from '../router/routes'
import styles from './CreateButton.module.css'

/**
 * Far enough that a stray trackpad nudge doesn't collapse the button, close enough
 * that it has folded before the header has left the screen.
 */
const THRESHOLD = 48

export interface CreateButtonProps {
	/**
	 * The flipbook to open the drawing tool on, if any.
	 *
	 * With one, this is the Remix button: same button, same corner, same errand — the
	 * difference is only what the tool starts with. Which is why it is one component
	 * rather than two, and why the label changes rather than the shape.
	 */
	remixOf?: string
}

/**
 * Extended while you're at the top of the page, folded to a plain circle once you
 * start scrolling.
 *
 * The scroll position is read on a timer rather than on every event: the class only
 * changes twice in a whole page's worth of scrolling, so the throttle is about not
 * touching `scrollY` sixty times a second, not about the write.
 */
export function CreateButton({ remixOf }: CreateButtonProps = {}) {
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

	/*
	 * "Remix" is a longer word than "New" and the label is capped at 120px, which is
	 * comfortably past either at 30px Pecita — so the button simply grows to fit and
	 * folds to the same disc on the same scroll. Nothing about the layout changes.
	 */
	const label = remixOf ? 'Remix' : 'New'
	const description = remixOf ? 'Remix this flipbook' : 'New flipbook'

	return (
		<Link
			to={createPath(remixOf)}
			className={scrolled ? `${styles.fab} ${styles.scrolled}` : styles.fab}
			aria-label={description}
			title={description}
		>
			<span className={styles.label}>{label}</span>
		</Link>
	)
}

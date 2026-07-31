import { useEffect, useState } from 'react'

import type { GalleryView } from '../../lib/api'
import styles from './ViewToggle.module.css'

export interface ViewToggleProps {
	view: GalleryView
	onChange: (view: GalleryView) => void
}

const SEGMENTS: { view: GalleryView; label: string; href: string }[] = [
	{ view: 'featured', label: 'Featured', href: '/' },
	{ view: 'all', label: 'All', href: '/?view=all' },
]

export function ViewToggle({ view, onChange }: ViewToggleProps) {
	// The pill's transition is switched on a frame after its initial position is
	// set, so landing on /?view=all shows it already on the right rather than
	// sliding there.
	const [animated, setAnimated] = useState(false)
	useEffect(() => {
		const id = window.setTimeout(() => setAnimated(true), 0)
		return () => window.clearTimeout(id)
	}, [])

	const pill = [styles.pill, animated ? styles.animated : '', view === 'all' ? styles.onSecond : '']
		.filter(Boolean)
		.join(' ')

	return (
		<div className={styles.track} role="tablist" aria-label="Which flipbooks to show">
			<span className={pill} aria-hidden="true" />

			{SEGMENTS.map((segment) => (
				<a
					key={segment.view}
					// A real href, so the tab can be opened in a new window and shared,
					// even though the click is handled here.
					href={segment.href}
					role="tab"
					aria-selected={view === segment.view}
					className={
						view === segment.view ? `${styles.segment} ${styles.selected}` : styles.segment
					}
					onClick={(event) => {
						if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
						event.preventDefault()
						onChange(segment.view)
					}}
				>
					{segment.label}
				</a>
			))}
		</div>
	)
}

import { useEffect } from 'react'

import { Button } from '../../components/Button'
import { FlipbookCard } from '../../flipbook/card/FlipbookCard'
import { loadPreview } from '../../flipbook/card/preview'
import { useCardGesture } from '../../flipbook/card/useCardGesture'
import type { FlipbookSummary } from '../../lib/api'
import styles from './PlaybackPage.module.css'

export interface RemixListProps {
	items: FlipbookSummary[]
	more: boolean
	onLoadMore: () => void
}

/**
 * What people have made from this flipbook.
 *
 * **In its own chunk, and that is the whole reason this is a separate file.** The card
 * and its gestures are ~2.4 kB gzipped shared with the gallery, and a plain import of
 * them here would put that in the playback route's preload set — fetched in front of
 * the artwork on every visit to every flipbook, to draw a list that most flipbooks
 * haven't got. It is the small version of the mistake `scene.ts` used to make with
 * paper.js, and the same answer applies: reach it by `import()` so it downloads
 * alongside what needs it rather than ahead of what doesn't.
 *
 * Mounted only when there is something in it, so the Suspense boundary above resolves
 * against a list that is already known to be worth drawing.
 *
 * The gallery's card, unchanged, which is the point of it having moved out of the
 * gallery: a remix is an ordinary flipbook and this is an ordinary list of them, so it
 * hovers, plays and scrubs here exactly as it does there. Its own `useCardGesture`
 * rather than the grid's, because there isn't one — and one instance drives one list.
 *
 * No admin toggles on these. They are on the cards in the grid and on the flipbook
 * above, which is every route to a flipbook that needs moderating; a third copy on a
 * card that is also on the home page is a second place to keep the same two switches
 * in step.
 */
export function RemixList({ items, more, onLoadMore }: RemixListProps) {
	const gesture = useCardGesture()

	// Warmed here rather than on the playback page, because this is the only thing on
	// that page with cards on it — and by the time this has mounted, the flipbook above
	// is already playing and nothing is competing for the connection.
	useEffect(() => {
		loadPreview().catch(() => {})
	}, [])

	return (
		<section className={styles.remixes}>
			{/*
			 * No count. The list is paginated, so the only number available here is how
			 * many have been fetched — and "12 remixes" above twelve of thirty is worse
			 * than not saying.
			 */}
			<h2 className={styles.remixesHeading}>Remixes</h2>

			<div className={styles.remixGrid}>
				{items.map((item) => (
					<FlipbookCard key={item.id} item={item} gesture={gesture} />
				))}
			</div>

			{/* Only when there is more. The bottom of this page is the bottom of the page —
			    an infinite scroll here would keep moving the flipbook further out of reach. */}
			{more ? (
				<div className={styles.remixesFoot}>
					<Button onClick={onLoadMore}>Load more</Button>
				</div>
			) : null}
		</section>
	)
}

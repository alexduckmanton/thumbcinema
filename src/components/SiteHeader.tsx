import type { ReactNode } from 'react'

import { Link } from '../router/Router'
import { Messages } from './Messages'
import styles from './SiteHeader.module.css'

export interface SiteHeaderProps {
	/**
	 * `wide` is the gallery, which spans the window; `narrow` tracks the 640px
	 * column the create and playback pages are built on, so the wordmark starts
	 * exactly where the canvas does.
	 */
	width?: 'wide' | 'narrow'
	/** Whatever this page can do, on the right. */
	children?: ReactNode
	/** True when the actions are a group that should wrap to its own row. */
	actionsWrap?: boolean
	/**
	 * False on the create page, which is the one page that is not somewhere you read.
	 *
	 * It is a 70px word and a header's worth of padding, and what it buys there is a
	 * link home that the drawing tool has to interrupt anyway — `guardNavigation()` asks
	 * before it lets go of unsaved work. The room is worth more than the sign: a square
	 * page is taller than a 16:9 one at the same width, and this is most of what it
	 * needed. Removed rather than hidden, so it is out of the tab order too.
	 */
	wordmark?: boolean
}

export function SiteHeader({
	width = 'wide',
	children,
	actionsWrap = false,
	wordmark = true,
}: SiteHeaderProps) {
	const container = width === 'narrow' ? `${styles.container} ${styles.narrow}` : styles.container
	const actions = actionsWrap ? `${styles.actions} ${styles.actionsWide}` : styles.actions

	return (
		<header className={styles.header}>
			{/*
			 * The row is dropped altogether when it would be empty, rather than rendered
			 * empty. Its padding is 40px of air that exists to sit above a wordmark, and
			 * on a page with neither wordmark nor actions that is 40px taken off the
			 * drawing for nothing. `Messages` below is not in the row and is unaffected.
			 */}
			{wordmark || children ? (
				<div className={container}>
					{wordmark ? (
						<Link to="/" className={styles.wordmark}>
							thumbcinema
						</Link>
					) : null}

					{children ? <div className={actions}>{children}</div> : null}
				</div>
			) : null}

			<Messages />
		</header>
	)
}

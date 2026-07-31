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
}

export function SiteHeader({ width = 'wide', children, actionsWrap = false }: SiteHeaderProps) {
	const container = width === 'narrow' ? `${styles.container} ${styles.narrow}` : styles.container
	const actions = actionsWrap ? `${styles.actions} ${styles.actionsWide}` : styles.actions

	return (
		<header className={styles.header}>
			<div className={container}>
				<Link to="/" className={styles.wordmark}>
					thumbcinema
				</Link>

				{children ? <div className={actions}>{children}</div> : null}
			</div>

			<Messages />
		</header>
	)
}

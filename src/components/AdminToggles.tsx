import { useState } from 'react'

import { adminHeaders, isAdmin, signOut } from '../lib/admin'
import { ApiError, setFlipbookFlags } from '../lib/api'
import { showMessage } from '../lib/messages'
import icons from '../styles/icons.module.css'
import styles from './AdminToggles.module.css'

export interface AdminFlagsState {
	featured: boolean
	nsfw: boolean
}

export interface AdminTogglesProps {
	id: string
	flags: AdminFlagsState
	onChange: (flags: AdminFlagsState) => void
	/** Placement is the caller's job — a card corner, or a row of metadata. */
	className?: string
}

/**
 * Featured and NSFW, for the one person with the token.
 *
 * NSFW hides a flipbook from both browse tabs but leaves it working on its own URL,
 * exactly as the 2013 reporting flow did — and it's the moderation lever, because
 * saves are public the moment they land.
 */
export function AdminToggles({ id, flags, onChange, className }: AdminTogglesProps) {
	const [busy, setBusy] = useState<keyof AdminFlagsState | null>(null)

	if (!isAdmin()) return null

	async function toggle(field: keyof AdminFlagsState) {
		if (busy) return
		setBusy(field)

		try {
			const updated = await setFlipbookFlags(
				id,
				{ [field]: !flags[field] },
				{ headers: adminHeaders() },
			)
			onChange({ featured: updated.featured, nsfw: updated.nsfw })
		} catch (error) {
			const status = error instanceof ApiError ? error.status : 0

			// 404 as well as 401: the admin routes fail closed and disappear entirely
			// when the server has no token configured.
			if (status === 401 || status === 404) {
				signOut()
				showMessage({
					copy: "That admin token isn't working any more.",
					cta: 'Fine',
					type: 'error',
				})
			} else {
				showMessage({ copy: "Couldn't save that. Try again?", cta: 'Dang', type: 'error' })
			}
		} finally {
			setBusy(null)
		}
	}

	return (
		<span className={className ? `${styles.toggles} ${className}` : styles.toggles}>
			<button
				type="button"
				className={styles.toggle}
				disabled={busy !== null}
				title="Featured on the home page"
				aria-pressed={flags.featured}
				onClick={(event) => {
					// Cards are links; don't follow them.
					event.preventDefault()
					event.stopPropagation()
					void toggle('featured')
				}}
			>
				<span className={flags.featured ? icons.heartOn : icons.heartOff} aria-hidden="true" />
				<span className="visuallyHidden">Featured</span>
			</button>

			<button
				type="button"
				className={styles.toggle}
				disabled={busy !== null}
				title="Adult content — hidden from both tabs"
				aria-pressed={flags.nsfw}
				onClick={(event) => {
					event.preventDefault()
					event.stopPropagation()
					void toggle('nsfw')
				}}
			>
				<span className={flags.nsfw ? icons.flagOn : icons.flagOff} aria-hidden="true" />
				<span className="visuallyHidden">Adult content</span>
			</button>
		</span>
	)
}

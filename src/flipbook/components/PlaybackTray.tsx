import { AdminToggles, type AdminFlagsState } from '../../components/AdminToggles'
import { isTouch } from '../../lib/device'
import icons from '../../styles/icons.module.css'
import type { FlipbookEngine, FlipbookState } from '../engine/FlipbookEngine'
import { CirclePlayButton, PlayButton } from './CreateTray'
import styles from './Tray.module.css'

export interface PlaybackTrayProps {
	engine: FlipbookEngine
	state: FlipbookState
	id: string
	flags: AdminFlagsState
	onFlagsChange: (flags: AdminFlagsState) => void
	onPrint: () => void
}

/**
 * The playback page's tray: print, and the two ways of playing.
 *
 * It used to carry a Twitter link, a Facebook link and a view count as well, and all
 * three are gone. The share links were 2013's — one of those networks no longer exists
 * under that name and neither has been the way anybody sends a link for a decade, and
 * both were an intent URL wrapped round a page that already has a perfectly good
 * address bar. The view count was a number about the flipbook that told you nothing
 * about the flipbook.
 *
 * What is left on the left is the admin toggles, which render nothing at all unless
 * you are in admin mode. They stay because moderation happens where you notice
 * something needs it, which is looking at the thing.
 *
 * On a phone the two playback buttons go too, exactly as they do in the create page's
 * tray, and for the same reason: the page bar underneath is the play button there. See
 * `.playbackKey`.
 */
export function PlaybackTray({
	engine,
	state,
	id,
	flags,
	onFlagsChange,
	onPrint,
}: PlaybackTrayProps) {
	const canPlay = state.pages.length > 1

	return (
		<div className={styles.tray}>
			<ul className={`${styles.group} ${styles.meta}`}>
				<li>
					<AdminToggles id={id} flags={flags} onChange={onFlagsChange} />
				</li>
			</ul>

			<ul className={`${styles.group} ${styles.actions}`}>
				{/* Printing lays the flipbook out as a cut-and-staple booklet. There is
				    no useful touch equivalent, so it isn't offered there. */}
				{!isTouch ? (
					<li>
						<button type="button" className={styles.action} title="Print" onClick={onPrint}>
							<span className={icons.print} aria-hidden="true" />
							<span className="visuallyHidden">Print</span>
						</button>
					</li>
				) : null}

				<CirclePlayButton
					engine={engine}
					playback={state.playback}
					enabled={canPlay}
					className={styles.playbackKey}
				/>
				<PlayButton
					engine={engine}
					playback={state.playback}
					enabled={canPlay}
					className={styles.playbackKey}
				/>
			</ul>
		</div>
	)
}

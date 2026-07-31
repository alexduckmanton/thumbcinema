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
	title: string
	views: number
	flags: AdminFlagsState
	onFlagsChange: (flags: AdminFlagsState) => void
	onPrint: () => void
}

export function PlaybackTray({
	engine,
	state,
	id,
	title,
	views,
	flags,
	onFlagsChange,
	onPrint,
}: PlaybackTrayProps) {
	const canPlay = state.pages.length > 1
	const shareUrl = typeof window === 'undefined' ? '' : window.location.href

	return (
		<div className={styles.tray}>
			<ul className={`${styles.group} ${styles.meta}`}>
				<li>
					<a
						className={styles.action}
						href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(shareUrl)}`}
						target="_blank"
						rel="noopener"
						title="Share on Twitter"
					>
						<span className={icons.twitter} aria-hidden="true" />
						<span className="visuallyHidden">Share on Twitter</span>
					</a>
				</li>
				<li>
					<a
						className={styles.action}
						href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
						target="_blank"
						rel="noopener"
						title="Share on Facebook"
					>
						<span className={icons.facebook} aria-hidden="true" />
						<span className="visuallyHidden">Share on Facebook</span>
					</a>
				</li>

				<li>{views} views</li>

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

				{!isTouch ? (
					<CirclePlayButton engine={engine} playback={state.playback} enabled={canPlay} />
				) : null}

				<PlayButton engine={engine} playback={state.playback} enabled={canPlay} />
			</ul>
		</div>
	)
}

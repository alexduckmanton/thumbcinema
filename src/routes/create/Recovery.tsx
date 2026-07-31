import { Button } from '../../components/Button'
import styles from './Recovery.module.css'

export interface RecoveryProps {
	/** False until the work-in-progress has actually been written to storage. */
	saved: boolean
}

/**
 * Shown when the drawing tool throws.
 *
 * By the time this appears the flipbook has been written to localStorage minus the
 * page that was being drawn on — which is the page most likely to contain whatever
 * went wrong. Reloading picks it back up.
 */
export function Recovery({ saved }: RecoveryProps) {
	return (
		<div className={styles.overlay} role="alertdialog" aria-label="Something broke">
			<div className={`center ${styles.panel}`}>
				<img src="/images/fail.png" width={201} height={176} alt="" />

				<h1>Something broke.</h1>
				<p>
					But don&rsquo;t worry, I&rsquo;m recovering your beautiful work-in-progress as we speak.
					It&rsquo;ll be missing the page you&rsquo;re working on right now (sorry about that), but
					everything else should be tip top.
				</p>
				<p>
					Nothing was lost. If you&rsquo;d like to give me a further piece of your mind you can do
					so via{' '}
					<a href="https://alexduckmanton.com" target="_blank" rel="noopener">
						my website
					</a>
					.
				</p>

				<Button loading={!saved} onClick={() => window.location.reload()}>
					Recover flipbook
				</Button>
			</div>
		</div>
	)
}

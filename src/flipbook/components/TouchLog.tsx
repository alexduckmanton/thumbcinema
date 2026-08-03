import { useTouchLog, verdict } from '../touchLog'
import styles from './TouchLog.module.css'

/**
 * The last gesture's touch numbers, on screen.
 *
 * On screen rather than in the console because the question is about a phone, and
 * getting a phone onto a remote inspector to read four numbers is most of an evening.
 * They go to the console as well, for when the cable is already plugged in.
 *
 * Rendered only when `?touchlog=1` has been visited. See `touchLog.ts` for what the
 * numbers mean and which cause each one points at.
 */
export function TouchLog() {
	const { enabled, last } = useTouchLog()
	if (!enabled) return null

	return (
		<div className={styles.log} aria-hidden="true">
			{last ? (
				<>
					<div className={styles.verdict}>{verdict(last)}</div>
					<div>
						gap {last.gap}ms · {last.deltas.length} moves · {last.contacts} finger
						{last.contacts === 1 ? '' : 's'}
					</div>
					<div className={styles.numbers}>px {last.deltas.slice(0, 12).join(' ')}</div>
					<div className={styles.numbers}>ms {last.intervals.slice(0, 12).join(' ')}</div>
				</>
			) : (
				<div className={styles.verdict}>touch log on — draw something</div>
			)}
		</div>
	)
}

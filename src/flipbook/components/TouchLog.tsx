import { useEffect, useState } from 'react'

import { pinchGuarded } from '../../lib/zoom'
import { getDrawMode } from '../drawModes'
import { type TouchSummary, useTouchLog, verdict } from '../touchLog'
import styles from './TouchLog.module.css'

/** How long "copied" stays up before the numbers come back. */
const CONFIRM_DURATION = 1500

/**
 * The last gesture's touch numbers, on screen, and copyable with a tap.
 *
 * On screen rather than in the console because the question is about a phone, and
 * getting a phone onto a remote inspector to read four numbers is most of an evening.
 * They go to the console as well, for when the cable is already plugged in — and a tap
 * on the panel puts the whole lot on the clipboard, which is the only way numbers read
 * off a phone get anywhere useful.
 *
 * What is copied is more than what is shown: the display truncates the two series to
 * twelve so it fits over a drawing, and the clipboard gets all of them, plus the mode
 * and the user agent. A gesture's numbers mean very little without knowing which
 * browser produced them.
 *
 * Rendered only when `?touchlog=1` has been visited. See `touchLog.ts` for what the
 * numbers mean and which cause each one points at.
 */
export function TouchLog() {
	const { enabled, last } = useTouchLog()
	const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')

	useEffect(() => {
		if (copied === 'idle') return
		const timer = window.setTimeout(() => setCopied('idle'), CONFIRM_DURATION)
		return () => window.clearTimeout(timer)
	}, [copied])

	if (!enabled) return null

	const message = copied === 'done' ? 'copied' : copied === 'failed' ? "couldn't copy" : null

	return (
		<button
			type="button"
			className={styles.log}
			onClick={() => {
				void copy(transcribe(last)).then((ok) => setCopied(ok ? 'done' : 'failed'))
			}}
		>
			{message ? <span className={styles.verdict}>{message}</span> : null}

			{last ? (
				<>
					{message ? null : <span className={styles.verdict}>{verdict(last)}</span>}
					<span className={styles.line}>
						gap {last.gap}ms · {last.deltas.length} moves · {last.contacts} finger
						{last.contacts === 1 ? '' : 's'}
					</span>
					<span className={styles.numbers}>px {last.deltas.slice(0, 12).join(' ')}</span>
					<span className={styles.numbers}>ms {last.intervals.slice(0, 12).join(' ')}</span>
					<span className={styles.line}>tap to copy</span>
				</>
			) : message ? null : (
				<span className={styles.verdict}>touch log on — draw something</span>
			)}
		</button>
	)
}

/** Everything worth pasting somewhere else, including what the display leaves out. */
function transcribe(last: TouchSummary | null): string {
	const where = [
		`mode: ${getDrawMode()}`,
		// Which side of the pinch-guard experiment this gesture was recorded on. See
		// `allowPinchZoom`; without it two logs are indistinguishable.
		`guard: ${pinchGuarded() ? 'on' : 'off'}`,
		`agent: ${navigator.userAgent}`,
	]

	if (!last) return ['touchlog — no gesture recorded yet', ...where].join('\n')

	return [
		`touchlog — ${verdict(last)}`,
		`gap: ${last.gap}ms to the first move`,
		`moves: ${last.deltas.length}, up to ${last.contacts} contact${last.contacts === 1 ? '' : 's'}`,
		`px: ${last.deltas.join(' ')}`,
		`ms: ${last.intervals.join(' ')}`,
		...where,
	].join('\n')
}

/**
 * The clipboard, with the old way as a fallback.
 *
 * `navigator.clipboard` needs a secure context, and the likeliest way to have this
 * panel open on a phone is a dev server on a local address over plain HTTP — where it
 * is simply not there. The deprecated route still works everywhere that matters, and
 * a debugging tool that can't hand its numbers over on the machine it was built for
 * isn't one.
 */
async function copy(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		return selectAndCopy(text)
	}
}

function selectAndCopy(text: string): boolean {
	const area = document.createElement('textarea')
	area.value = text
	// Read-only and off-screen: on iOS a writable field would raise the keyboard, and
	// `setSelectionRange` is what makes the selection stick there at all.
	area.readOnly = true
	area.style.position = 'fixed'
	area.style.top = '-1000px'
	document.body.append(area)

	area.select()
	area.setSelectionRange(0, text.length)

	let copied = false
	try {
		copied = document.execCommand('copy')
	} catch {
		copied = false
	}

	area.remove()
	return copied
}

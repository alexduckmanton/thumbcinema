import { Store, useStore } from '../lib/store'

/**
 * A readout of what the touch stream actually delivers, for one gesture at a time.
 *
 * The relative drawing modes stall for the first moment of a drag on a real phone,
 * and the cause is not in this code: the handler runs in under half a millisecond and
 * the cursor is repositioned within two of the event arriving, measured. What that
 * leaves is the browser's own touch pipeline, and there is no way to see into it from
 * a desktop — synthetic touch events are injected straight into the renderer and skip
 * every part of it that could be responsible.
 *
 * So this measures it from inside, on the device, where the problem actually is. Two
 * numbers tell the two candidate causes apart:
 *
 *  - **A large first delta.** The browser withheld `touchmove` until the finger had
 *    travelled a threshold — touch slop — and then delivered the whole distance at
 *    once. Invisible in a direct mode, where the finger *is* the cursor and is
 *    therefore already right; a lurch in a relative one, where the delta is the whole
 *    input.
 *  - **A late first event.** The first move arrived tens of milliseconds after the
 *    finger went down. That is the main-thread round trip a blocking touch handler
 *    forces at the start of a gesture, and it says the pipeline was slow rather than
 *    that the browser was waiting for the finger.
 *
 * Off unless asked for, because it is a debugging instrument: `?touchlog=1` on the
 * create page turns it on and `?touchlog=0` turns it off again, and the answer is
 * remembered so a phone doesn't have to be told twice.
 *
 * **Samples are collected into a plain array and published once, at the end of the
 * gesture.** Writing to the store per move would re-render the cursor a second time
 * on every event and put the instrument inside the thing it is measuring.
 */
export interface TouchSummary {
	/** Milliseconds from the finger landing to the first movement being reported. */
	gap: number
	/** How far the cursor was asked to travel on each event, in CSS pixels. */
	deltas: number[]
	/** Milliseconds between one event and the next. */
	intervals: number[]
	/** The most contacts seen at once during the gesture. */
	contacts: number
}

const KEY = 'tc:touchLog'

function read(): boolean {
	if (typeof window === 'undefined') return false

	try {
		const asked = new URLSearchParams(window.location.search).get('touchlog')
		if (asked !== null) {
			const on = asked !== '0' && asked !== 'false'
			localStorage.setItem(KEY, on ? '1' : '0')
			return on
		}
		return localStorage.getItem(KEY) === '1'
	} catch {
		return false
	}
}

const store = new Store<{ enabled: boolean; last: TouchSummary | null }>({
	enabled: read(),
	last: null,
})

export function touchLogEnabled(): boolean {
	return store.snapshot.enabled
}

/** The last gesture's numbers, for the readout. */
export function useTouchLog(): { enabled: boolean; last: TouchSummary | null } {
	return useStore(store)
}

/* The gesture in progress, held outside the store so sampling costs nothing. */
let start = 0
let previous = 0
let deltas: number[] = []
let intervals: number[] = []
let gap = 0
let contacts = 0

export function beginTouchLog(): void {
	if (!store.snapshot.enabled) return

	start = performance.now()
	previous = start
	deltas = []
	intervals = []
	gap = 0
	contacts = 1
}

/**
 * One movement event: how far the cursor was asked to go, and how many fingers were
 * on the glass when it was asked.
 *
 * The distance is the *cursor's*, not any one finger's — in `twoFinger` those differ,
 * and what a stall is a stall of is the cursor.
 */
export function sampleTouch(dx: number, dy: number, fingers: number): void {
	if (!store.snapshot.enabled || start === 0) return

	const now = performance.now()
	if (deltas.length === 0) gap = now - start
	else intervals.push(now - previous)

	previous = now
	deltas.push(Math.hypot(dx, dy))
	contacts = Math.max(contacts, fingers)
}

/** Publishes the gesture, once, and only if there was anything in it. */
export function endTouchLog(): void {
	if (!store.snapshot.enabled || start === 0) return
	start = 0

	if (deltas.length === 0) return

	const summary: TouchSummary = {
		gap: round(gap),
		deltas: deltas.map(round),
		intervals: intervals.map(round),
		contacts,
	}

	// Also to the console, for whoever has the phone on a cable.
	console.info('[touchlog]', verdict(summary), summary)
	store.set({ last: summary })
}

function round(value: number): number {
	return Math.round(value * 10) / 10
}

/**
 * What the numbers say, in one line.
 *
 * Deliberately blunt, and deliberately about the two causes worth telling apart. A
 * first delta several times the typical one is the browser having held the finger's
 * movement back and then handed it over in a lump; a long gap with an ordinary first
 * delta is the event itself arriving late.
 */
export function verdict(summary: TouchSummary): string {
	const [first] = summary.deltas
	if (first === undefined) return 'nothing moved'

	const rest = summary.deltas.slice(1)
	const typical = rest.length ? median(rest) : first

	const lumpy = typical > 0 && first > typical * 3
	const late = summary.gap > 40

	if (lumpy && late) return 'slop and a late first event'
	if (lumpy) return `slop: first move ${summary.gap}ms in, ${first}px at once`
	if (late) return `late first event: ${summary.gap}ms, and only ${first}px`
	return 'clean start'
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)] ?? 0
}

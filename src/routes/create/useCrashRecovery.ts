import { useEffect, useRef, useState } from 'react'

import type { FlipbookEngine } from '../../flipbook/engine/FlipbookEngine'

const STORAGE_KEY = 'flipbook'

export interface CrashState {
	crashed: boolean
	/** True once the work-in-progress is safely in storage. */
	saved: boolean
}

/**
 * Crash recovery for the drawing tool.
 *
 * If anything throws while someone is drawing, the flipbook is written to
 * localStorage minus the page in hand — the page most likely to contain whatever
 * threw — and the reader is shown a red screen offering a reload. The next load
 * finds the file and replays it back into the tool.
 *
 * It's a blunt instrument and that's the point: there are no accounts and no
 * autosave, so the alternative to this is losing the lot.
 */
export function useCrashRecovery(engine: FlipbookEngine | null): CrashState {
	const [crashed, setCrashed] = useState(false)
	const [saved, setSaved] = useState(false)
	const restored = useRef(false)

	// Restore, once, as soon as there's an engine to restore into.
	useEffect(() => {
		if (!engine || restored.current) return
		restored.current = true

		let stored: string | null = null
		try {
			stored = window.localStorage.getItem(STORAGE_KEY)
			// Cleared before it's used, not after: a file that crashes the loader
			// would otherwise crash every subsequent load too.
			window.localStorage.removeItem(STORAGE_KEY)
		} catch {
			return
		}
		if (!stored) return

		void engine.loadSvg(stored).catch(() => {
			// Nothing useful to offer here — the recovery file is the only copy and
			// it didn't parse. Better an empty canvas than a wedged one.
		})
	}, [engine])

	useEffect(() => {
		if (!engine) return

		const handle = () => {
			// Only the first one: the recovery itself may well throw again.
			if (crashed) return
			setCrashed(true)

			try {
				window.localStorage.setItem(STORAGE_KEY, engine.exportForRecovery())
				setSaved(true)
			} catch {
				// Quota, private mode, or an export that threw. The screen still says
				// what happened; it just can't promise the work back.
				setSaved(true)
			}
		}

		const onError = () => handle()
		const onRejection = () => handle()

		window.addEventListener('error', onError)
		window.addEventListener('unhandledrejection', onRejection)

		return () => {
			window.removeEventListener('error', onError)
			window.removeEventListener('unhandledrejection', onRejection)
		}
	}, [engine, crashed])

	return { crashed, saved }
}

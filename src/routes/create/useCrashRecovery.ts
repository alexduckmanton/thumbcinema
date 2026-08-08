import { useEffect, useRef, useState } from 'react'

import type { FlipbookEngine } from '../../flipbook/engine/FlipbookEngine'

const STORAGE_KEY = 'flipbook'

/**
 * What the recovered work was a remix of, stored beside the artwork itself.
 *
 * Written and read as a pair with `STORAGE_KEY`, and it exists because the recovery
 * file is the whole of the work in progress and a remix's parentage is part of that.
 * The alternative — reading the parent back off the URL, which does survive the reload
 * — is right in the common case and wrong in the one that matters: a *stale* recovery
 * file, restored onto a page opened with somebody else's `?remix=` on it, would take
 * the artwork from one flipbook and the credit from another.
 */
const REMIX_KEY = 'tc:remix-of'

export interface CrashState {
	crashed: boolean
	/** True once the work-in-progress is safely in storage. */
	saved: boolean
	/**
	 * Whether the question "is there work to restore?" has been answered yet.
	 *
	 * It is answered in an effect, so there is a beat after mount in which nothing is
	 * known — and during that beat the page must not start loading a remix, or a
	 * recovered flipbook and a freshly-fetched one would both be replayed into the
	 * same scene. Nothing to show for it: the engine is null for that beat anyway.
	 */
	decided: boolean
	/** True when a recovery file was found, which is what suppresses the remix load. */
	restored: boolean
	/**
	 * The flipbook the drawing on screen is a remix of, whatever put it there.
	 *
	 * The recovery file's, when there was one — including its *absence*, which is how
	 * a recovered original stays an original. The URL's otherwise.
	 */
	remixOf: string | null
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
 *
 * `remixOf` is what the URL asked for, and is used only when there is nothing to
 * recover — see `REMIX_KEY`.
 */
export function useCrashRecovery(
	engine: FlipbookEngine | null,
	remixOf: string | null,
): CrashState {
	const [crashed, setCrashed] = useState(false)
	const [saved, setSaved] = useState(false)
	const [recovered, setRecovered] = useState<{ restored: boolean; remixOf: string | null } | null>(
		null,
	)
	const restored = useRef(false)

	// Restore, once, as soon as there's an engine to restore into. The ref is what
	// makes it once — StrictMode runs this effect twice in development, and the file is
	// cleared by the first pass.
	useEffect(() => {
		if (!engine || restored.current) return
		restored.current = true

		let stored: string | null = null
		let storedRemix: string | null = null
		try {
			stored = window.localStorage.getItem(STORAGE_KEY)
			storedRemix = window.localStorage.getItem(REMIX_KEY)
			// Cleared before they're used, not after: a file that crashes the loader
			// would otherwise crash every subsequent load too. Both keys go together,
			// or a later crash-free visit would inherit this one's parentage.
			window.localStorage.removeItem(STORAGE_KEY)
			window.localStorage.removeItem(REMIX_KEY)
		} catch {
			// No storage at all — private mode, or a full quota. Nothing to restore, and
			// the page still has to be told so, or it would never load its remix.
			setRecovered({ restored: false, remixOf })
			return
		}

		if (!stored) {
			setRecovered({ restored: false, remixOf })
			return
		}

		setRecovered({ restored: true, remixOf: storedRemix })

		void engine.loadSvg(stored).catch(() => {
			// Nothing useful to offer here — the recovery file is the only copy and
			// it didn't parse. Better an empty canvas than a wedged one.
		})
	}, [engine, remixOf])

	useEffect(() => {
		if (!engine) return

		const handle = () => {
			// Only the first one: the recovery itself may well throw again.
			if (crashed) return
			setCrashed(true)

			try {
				window.localStorage.setItem(STORAGE_KEY, engine.exportForRecovery())
				// Whatever the drawing on screen is a remix of right now, which after a
				// restore is the recovery file's own answer rather than the URL's. Removed
				// rather than written empty, so "not a remix" is the absence of a key.
				const parent = recovered ? recovered.remixOf : remixOf
				if (parent) window.localStorage.setItem(REMIX_KEY, parent)
				else window.localStorage.removeItem(REMIX_KEY)
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
	}, [engine, crashed, recovered, remixOf])

	return {
		crashed,
		saved,
		decided: recovered !== null,
		restored: recovered?.restored ?? false,
		remixOf: recovered ? recovered.remixOf : remixOf,
	}
}

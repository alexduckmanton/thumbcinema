import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { FlipbookEngine, type EngineOptions, type FlipbookState } from './engine/FlipbookEngine'
import type { PaperCore } from './engine/scene'

/**
 * paper.js, asked for the moment this module evaluates rather than when the effect
 * runs — and fetched rather than imported. See the note on `PaperCore` in `scene.ts`
 * for why it isn't a static import.
 *
 * Started here, at module scope, so it is on the wire while React is still doing its
 * first render and while the playback page's metadata request is in flight. Awaiting
 * it inside the effect instead would put 71 kB behind a paint that has already
 * happened, for no reason.
 *
 * One promise for the life of the tab: a second engine — a route change, or
 * StrictMode's double mount — gets the resolved module with no second round trip.
 *
 * The unwrap is not defensive clutter. paper's `.d.ts` declares `paper-core` with
 * `export =`, so TypeScript types this import as the scope object itself and
 * `module.PaperScope` typechecks — but paper-core is a UMD bundle, and Vite's interop
 * hands back a namespace with the whole of it on `default`. Following the types
 * builds a Scene whose `new paperCore.PaperScope()` is `undefined`, which is a page
 * that sits on its placeholder for ever. Reconciled here rather than trusted either
 * way, so it stays true whichever shape arrives.
 */
const paperCore: Promise<PaperCore> = import('paper/dist/paper-core').then((module) => {
	const loaded = module as unknown as PaperCore & { default?: PaperCore }
	return loaded.default ?? loaded
})

// Handled here as well as in the effect, so a failure between this module evaluating
// and the effect attaching isn't an unhandled rejection. The effect still sees it.
paperCore.catch(() => {})

/**
 * Builds the engine once the canvas is in the DOM and paper has arrived, and tears it
 * down cleanly.
 *
 * The teardown is not ceremony: paper.js registers a project and a view globally, so
 * an engine that outlives its canvas keeps drawing into a detached element. React's
 * StrictMode mounts every effect twice in development precisely to catch that, and
 * this survives it.
 */
export function useFlipbookEngine(options: EngineOptions) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [engine, setEngine] = useState<FlipbookEngine | null>(null)
	const [failed, setFailed] = useState<Error | null>(null)

	// An effect rather than a layout effect, which it was while paper was a static
	// import: the engine cannot be built before paint any more, so there is nothing
	// left for a layout effect to be early for. Both pages already cover the canvas
	// until `engine` exists — the placeholder on playback, a blank sheet on create.
	//
	// `options` is deliberately not a dependency. It is read once, at construction, and
	// callers pass an object literal — depending on it would build a new paper.js scene
	// on every render. Changing mode mid-life isn't a thing the tool does: the route
	// remounts instead.
	// biome-ignore lint/correctness/useExhaustiveDependencies: built once, on mount. See above.
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		let created: FlipbookEngine | null = null
		let cancelled = false

		// `.catch` after `.then`, not `.then(ok, fail)`: the two-argument form only
		// catches paper failing to *arrive*, so anything thrown while building the
		// engine becomes an unhandled rejection nobody sees and the page pulses on.
		paperCore
			.then((paper) => {
				// The cleanup may already have run — paper can land after the route has
				// gone, and building a scene on a detached canvas is exactly what the
				// teardown below exists to prevent.
				if (cancelled) return
				created = new FlipbookEngine(canvas, options, paper)
				setEngine(created)
			})
			.catch((error: unknown) => {
				if (!cancelled) setFailed(error instanceof Error ? error : new Error(String(error)))
			})

		return () => {
			cancelled = true
			created?.destroy()
			setEngine(null)
		}
	}, [])

	const state = useEngineState(engine)

	// Thrown in render so the app's ErrorBoundary catches it. paper used to arrive as
	// part of the route's chunk, where a failed load surfaced as "Well, that went
	// wrong."; without this it would be a page that pulses for ever instead.
	//
	// After every hook, not at the top: a throw above `useEffect` would leave this
	// render one hook short of the last one.
	if (failed) throw failed

	return { engine, state, canvasRef }
}

const NO_SUBSCRIBE = () => () => {}

/** The engine's state, or null before it exists. */
export function useEngineState(engine: FlipbookEngine | null): FlipbookState | null {
	return useSyncExternalStore(
		engine ? engine.store.subscribe : NO_SUBSCRIBE,
		() => (engine ? engine.store.snapshot : null),
		() => (engine ? engine.store.snapshot : null),
	)
}

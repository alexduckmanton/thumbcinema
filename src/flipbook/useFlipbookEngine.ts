import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { FlipbookEngine, type EngineOptions, type FlipbookState } from './engine/FlipbookEngine'

/**
 * Builds the engine once the canvas is in the DOM, and tears it down cleanly.
 *
 * The teardown is not ceremony: paper.js registers a project and a view globally, so
 * an engine that outlives its canvas keeps drawing into a detached element. React's
 * StrictMode mounts every effect twice in development precisely to catch that, and
 * this survives it.
 */
export function useFlipbookEngine(options: EngineOptions) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const [engine, setEngine] = useState<FlipbookEngine | null>(null)

	// Layout effect, not effect: the engine sizes the canvas and draws the first
	// frame, and doing that after paint shows a flash of an unsized canvas.
	//
	// `options` is deliberately not a dependency. It is read once, at construction, and
	// callers pass an object literal — depending on it would build a new paper.js scene
	// on every render. Changing mode mid-life isn't a thing the tool does: the route
	// remounts instead.
	// biome-ignore lint/correctness/useExhaustiveDependencies: built once, on mount. See above.
	useLayoutEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		const created = new FlipbookEngine(canvas, options)
		setEngine(created)

		return () => {
			created.destroy()
			setEngine(null)
		}
	}, [])

	return { engine, state: useEngineState(engine), canvasRef }
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

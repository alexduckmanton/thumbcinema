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
	useLayoutEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		const created = new FlipbookEngine(canvas, options)
		setEngine(created)

		return () => {
			created.destroy()
			setEngine(null)
		}
		// Options are read once, at construction. Changing mode mid-life isn't a
		// thing the tool does — the route remounts instead.
		// eslint-disable-next-line react-hooks/exhaustive-deps
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

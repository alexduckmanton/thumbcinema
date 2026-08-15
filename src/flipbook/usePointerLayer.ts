import { useEffect, useState, useSyncExternalStore } from 'react'

import type { DrawMode } from './drawModes'
import type { FlipbookEngine } from './engine/FlipbookEngine'
import { type Cursor, PointerLayer } from './pointer'

export interface PointerLayerOptions {
	engine: FlipbookEngine | null
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Which of the drawing modes is switched on. Handed over, never rebuilt around. */
	mode: DrawMode
	/** The tool in hand, which changes what the cursor *is* without moving anything. */
	tool: string | null
	/**
	 * Everywhere a finger may aim from — the page, less the controls on it.
	 *
	 * Only the modes that nudge a standing cursor use the whole page; the rest keep to
	 * the drawing, and v11 to its two canvases. `PointerLayer` decides which, so this is
	 * the widest surface rather than the right one. Defaults to the drawing itself.
	 */
	fieldRef?: React.RefObject<HTMLElement | null>
}

/**
 * Builds the one `PointerLayer` the create page has, for the life of the page.
 *
 * It used to be built inside `InkCursor`, which was right while the cursor was the only
 * thing reading it. v11 put a second drawing surface on the page with a cursor of its
 * own, and two components cannot each own the object that decides what a finger means —
 * so it is built here and handed to both.
 *
 * Not rebuilt when anything about it changes: the mode goes across by `setMode` and the
 * tool by `refresh`, because rebuilding would drop whatever gesture was in flight and
 * put the standing cursor back in the middle of the page. The one thing that *does*
 * rebuild it is the engine arriving, which is the thing it drives.
 *
 * **Called unconditionally, and that is load-bearing rather than tidy.** The layer is the
 * only subscriber to `setToolPressed`, and on a phone the tray is driven by touch events
 * that call `preventDefault()` — so there is no click behind them to fall back on. While
 * it was built inside `InkCursor` the three tools went completely dead at any moment that
 * component wasn't rendered, which a trace photo being placed is exactly: no tool in hand,
 * so no cursor, so nothing to draw. Up here there is no condition to get wrong.
 */
export function usePointerLayer({
	engine,
	canvasRef,
	mode,
	tool,
	fieldRef,
}: PointerLayerOptions): PointerLayer | null {
	const [layer, setLayer] = useState<PointerLayer | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: `mode` is the starting value only; `setMode` below carries changes across. See above.
	useEffect(() => {
		const canvas = canvasRef.current
		// `.book`, which wraps the canvas. The listeners have to be on an ancestor to be
		// sure of running before paper's own — at the target element, capture and bubble
		// listeners are called in the order they were added, so registering on the canvas
		// itself would be a race against whichever ran first.
		const book = canvas?.parentElement
		if (!engine || !canvas || !book) return

		const created = new PointerLayer(fieldRef?.current ?? book, book, canvas, engine, mode)
		setLayer(created)

		return () => {
			created.destroy()
			setLayer(null)
		}
	}, [engine, canvasRef, fieldRef])

	useEffect(() => {
		layer?.setMode(mode)
	}, [layer, mode])

	// Picking a tool up changes what the cursor is, and on a desktop that is a button
	// press rather than a pointer moving — so nothing would republish until it did.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tool` is the trigger rather than a value the effect reads; that is the whole point of it.
	useEffect(() => {
		layer?.refresh()
	}, [layer, tool])

	return layer
}

/** Where the pointer is and what it is doing, for React. Null before the layer exists. */
export function useCursor(layer: PointerLayer | null): Cursor | null {
	return useSyncExternalStore(
		layer ? layer.subscribe : NO_SUBSCRIBE,
		() => layer?.snapshot ?? null,
		() => null,
	)
}

const NO_SUBSCRIBE = () => () => {}

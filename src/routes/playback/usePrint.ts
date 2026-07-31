import { useCallback, useEffect, useRef } from 'react'

import type { FlipbookEngine } from '../../flipbook/engine/FlipbookEngine'
import { buildPrintSheets } from '../../flipbook/engine/print'

/**
 * Builds the printable booklet on demand and hands it to the browser.
 *
 * On demand, rather than up front: the 2013 version built the sheets as soon as the
 * flipbook finished loading, which meant every visitor to every flipbook page paid
 * for a layout nobody was going to print.
 */
export function usePrint(engine: FlipbookEngine | null) {
	const container = useRef<HTMLDivElement | null>(null)

	// Print sheets are a couple of hundred cloned nodes; don't leave them in the
	// document once the dialog has gone.
	useEffect(() => {
		const clear = () => {
			if (container.current) container.current.replaceChildren()
		}
		window.addEventListener('afterprint', clear)
		return () => window.removeEventListener('afterprint', clear)
	}, [])

	const print = useCallback(() => {
		const target = container.current
		if (!engine || !target) return

		target.replaceChildren(...buildPrintSheets(engine.exportSvgElement()))
		window.print()
	}, [engine])

	return { print, container }
}

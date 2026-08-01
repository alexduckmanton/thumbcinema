import { useEffect } from 'react'

import type { FlipbookEngine } from './engine/FlipbookEngine'

export interface ShortcutOptions {
	/** Off while the save form is up, so typing a title doesn't switch tools. */
	enabled: boolean
	/** Playback has pages and undo but no tools to switch between. */
	tools: boolean
}

/**
 * Every keyboard shortcut, in one place.
 *
 * 2013 spread these across three layers: a `keydown` on `document` that searched the
 * toolbox for a matching key code, a second handler inside each paper.js tool, and a
 * third in the header for dismissing messages. Each layer could see events the
 * others had already acted on.
 *
 * Keys are matched on `event.key` rather than `keyCode`, which is deprecated and
 * was never right on a non-US layout.
 */
export function useKeyboardShortcuts(
	engine: FlipbookEngine | null,
	options: ShortcutOptions,
): void {
	const { enabled, tools } = options

	useEffect(() => {
		if (!engine) return

		const onKeyDown = (event: KeyboardEvent) => {
			engine.setModifiers({ alt: event.altKey, shift: event.shiftKey })

			if (!enabled || isTyping(event.target)) return

			// Undo first: it's the one shortcut with a modifier, and the plain-letter
			// checks below would otherwise swallow ⌘Z as a "z".
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault()
				engine.undo()
				return
			}
			if (event.metaKey || event.ctrlKey) return

			switch (event.key) {
				case 'ArrowLeft':
					event.preventDefault()
					engine.previousPage()
					return
				case 'ArrowRight':
					event.preventDefault()
					engine.nextPage()
					return
			}

			if (!tools) return

			switch (event.key.toLowerCase()) {
				case 'b':
				case 'p':
					engine.selectTool('pencil')
					break
				case 'e':
					engine.selectTool('eraser')
					break
				case 'v':
					engine.selectTool('transform')
					break
				case 'n':
					void engine.addBlankPage()
					break
				case 'd':
					void engine.duplicatePage()
					break
				case '[':
					engine.setPencilWidth(engine.store.snapshot.pencilWidth - 1)
					break
				case ']':
					engine.setPencilWidth(engine.store.snapshot.pencilWidth + 1)
					break
				case 'escape':
					engine.clearSelection()
					break
				case 'backspace':
				case 'delete':
					// Backspace still navigates back in some browsers.
					event.preventDefault()
					engine.deleteSelection()
					break
			}
		}

		const onKeyUp = (event: KeyboardEvent) => {
			engine.setModifiers({ alt: event.altKey, shift: event.shiftKey })
		}

		// Modifiers held while the window was in the background are stale on return.
		const onBlur = () => engine.setModifiers({ alt: false, shift: false })

		window.addEventListener('keydown', onKeyDown)
		window.addEventListener('keyup', onKeyUp)
		window.addEventListener('blur', onBlur)

		return () => {
			window.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('keyup', onKeyUp)
			window.removeEventListener('blur', onBlur)
		}
	}, [engine, enabled, tools])
}

function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	return (
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT' ||
		target.isContentEditable
	)
}

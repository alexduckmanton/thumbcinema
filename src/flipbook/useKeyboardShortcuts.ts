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

			// Undo and redo first: they're the shortcuts with a modifier, and the
			// plain-letter checks below would otherwise swallow ⌘Z as a "z".
			//
			// Both spellings of redo, because both are in use: ⇧⌘Z is the Mac's and
			// ⌘Y/Ctrl-Y is what Windows software has always used, and neither is worth
			// making anyone look up.
			if (event.metaKey || event.ctrlKey) {
				const key = event.key.toLowerCase()

				if (key === 'z') {
					event.preventDefault()
					if (event.shiftKey) engine.redo()
					else engine.undo()
					return
				}
				if (key === 'y') {
					event.preventDefault()
					engine.redo()
					return
				}

				/*
				 * Copy and paste, which are the same two buttons the phone layout puts in
				 * its footer — the keyboard's way in, and the reason those buttons name a
				 * shortcut in their tooltips.
				 *
				 * The default is prevented either way rather than only when something
				 * happens. There is nothing on this page to copy but a drawing: the one
				 * place with text in it is the save form, and the shortcuts are off while
				 * that is up. So the browser's own copy has nothing to take, and a paste it
				 * handled would be a picture of somebody's desktop arriving in a flipbook.
				 */
				if (tools && key === 'c') {
					event.preventDefault()
					engine.copySelection()
					return
				}
				if (tools && key === 'v') {
					event.preventDefault()
					engine.pasteClipboard()
				}
				return
			}

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
					// Picks it up, and cycles transform ⇄ push from there. See `cycleTransform`.
					engine.cycleTransform()
					break
				case 'n':
					void engine.addBlankPage()
					break
				case 'd':
					void engine.duplicatePage()
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

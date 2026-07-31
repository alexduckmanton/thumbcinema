/**
 * The three modal tools — the ones that stay switched on and own the pointer.
 * Everything else in the tray (new page, duplicate, delete, print) is a one-shot
 * action and is just a method on the engine, not a tool.
 */
export type ModalToolId = 'pencil' | 'eraser' | 'transform'

export interface ModalTool {
	/**
	 * Prepares the tool and says whether it may be activated at all.
	 *
	 * Push returns false when nothing is selected, which is what makes the
	 * transform button cycle back to plain transform instead of switching to a mode
	 * that would have nothing to do.
	 */
	init(): boolean
	activate(): void
	deactivate(): void
}

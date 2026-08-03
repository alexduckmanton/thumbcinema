/**
 * The three modal tools — the ones that stay switched on and own the pointer.
 * Everything else in the tray (new page, duplicate, delete, print) is a one-shot
 * action and is just a method on the engine, not a tool.
 */
export type ModalToolId = 'pencil' | 'eraser' | 'transform'

export interface ModalTool {
	/**
	 * The paper tool the gesture is dispatched to.
	 *
	 * All four have always had one; it is declared here because the drawing modes
	 * that take a gesture away from paper have to hand the events over themselves,
	 * and `FlipbookEngine.toolDown` does that through this without caring which tool
	 * it is holding. See `pointer.ts`.
	 */
	readonly tool: paper.Tool

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

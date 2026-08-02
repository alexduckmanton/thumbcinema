import type { FlipbookEngine, FlipbookState } from '../engine/FlipbookEngine'
import type { ModalToolId } from '../engine/tools/types'
import icons from '../../styles/icons.module.css'
import styles from './Tray.module.css'

export interface CreateTrayProps {
	engine: FlipbookEngine
	state: FlipbookState
	/** True while the save form is up: the controls fly away and leave it alone. */
	stowed?: boolean
}

/**
 * The create page's tray: three modal tools on the left, three page actions on the
 * right.
 *
 * The transform button is one button with two modes: pressing it again cycles into
 * push, and push refuses to switch on when nothing is selected, so it cycles straight
 * back.
 *
 * One layout at every width, and shorter than it was. 2013 ended this row with play and
 * circleplay; the page bar under the drawing is both of those now — a tap on its handle
 * plays, and dragging it is the scrub — so the tray is the six controls that are the
 * drawing and nothing else. The pencil's width popover went the same way: see
 * `DEFAULT_PENCIL_WIDTH`.
 */
export function CreateTray({ engine, state, stowed = false }: CreateTrayProps) {
	const { tool, transformIndex } = state

	// Only while a page is actually arriving or leaving. Playing doesn't disable
	// these — the press stops playback instead, and the next one goes through.
	const canChangePages = !state.busy

	const toolClass = (id: ModalToolId) =>
		tool === id ? `${styles.tool} ${styles.toolActive}` : styles.tool

	const trayClass = [styles.tray, stowed ? styles.stowed : ''].filter(Boolean)

	return (
		<div className={trayClass.join(' ')}>
			<ul className={`${styles.group} ${styles.tools}`}>
				<li>
					<button
						type="button"
						className={toolClass('pencil')}
						title="Draw (b)"
						aria-pressed={tool === 'pencil'}
						onClick={() => engine.selectTool('pencil')}
					>
						<span className={`${styles.blade} ${icons.pencil}`} aria-hidden="true" />
						<span className="visuallyHidden">Draw</span>
					</button>
				</li>

				<li>
					<button
						type="button"
						className={toolClass('eraser')}
						title="Erase (e)"
						aria-pressed={tool === 'eraser'}
						onClick={() => engine.selectTool('eraser')}
					>
						<span className={`${styles.blade} ${icons.eraser}`} aria-hidden="true" />
						<span className="visuallyHidden">Erase</span>
					</button>
				</li>

				<li>
					<button
						type="button"
						className={[
							styles.tool,
							styles.transform,
							tool === 'transform' ? styles.transformActive : '',
						]
							.filter(Boolean)
							.join(' ')}
						title="Transform (v)"
						aria-pressed={tool === 'transform'}
						onClick={() => engine.selectTool('transform')}
					>
						{/* Four stacked images: the hand, and three arrows that fan out
						    from behind it when the tool is on. */}
						{/* No `blade` here, unlike the pencil and the eraser: on a phone this
						    button is turned over as a whole, arrows and all. */}
						<span className={`${styles.layer} ${icons.transform}`} aria-hidden="true" />
						<span
							className={`${styles.layer} ${
								tool === 'transform' && transformIndex === 0
									? icons.translateActive
									: icons.translate
							}`}
							aria-hidden="true"
						/>
						<span
							className={`${styles.layer} ${
								tool === 'transform' && transformIndex === 0 ? icons.rotateActive : icons.rotate
							}`}
							aria-hidden="true"
						/>
						<span
							className={`${styles.layer} ${
								tool === 'transform' && transformIndex === 1 ? icons.nudgeActive : icons.nudge
							}`}
							aria-hidden="true"
						/>
						<span className="visuallyHidden">Transform</span>
					</button>
				</li>
			</ul>

			<ul className={`${styles.group} ${styles.actions}`}>
				<li>
					<button
						type="button"
						className={styles.action}
						title="Delete page"
						disabled={!canChangePages}
						onClick={() => void engine.deletePage()}
					>
						<span className={icons.delete} aria-hidden="true" />
						<span className="visuallyHidden">Delete page</span>
					</button>
				</li>

				<li>
					<button
						type="button"
						className={styles.action}
						title="Blank page (n)"
						disabled={!canChangePages}
						onClick={() => void engine.addBlankPage()}
					>
						<span className={icons.blank} aria-hidden="true" />
						<span className="visuallyHidden">New blank page</span>
					</button>
				</li>

				<li>
					<button
						type="button"
						className={`${styles.action} ${styles.duplicate}`}
						title="Duplicate page (d)"
						disabled={!canChangePages}
						onClick={() => void engine.duplicatePage()}
					>
						<span className={icons.duplicate} aria-hidden="true" />
						<span className="visuallyHidden">Duplicate page</span>
					</button>
				</li>
			</ul>
		</div>
	)
}

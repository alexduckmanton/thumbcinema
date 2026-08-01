import type { FlipbookEngine, FlipbookState } from '../engine/FlipbookEngine'
import { settledPageCount } from '../engine/pages'
import type { ModalToolId } from '../engine/tools/types'
import icons from '../../styles/icons.module.css'
import { WidthSlider } from './WidthSlider'
import styles from './Tray.module.css'

export interface CreateTrayProps {
	engine: FlipbookEngine
	state: FlipbookState
	/** True while the save form is up: the controls fly away and leave it alone. */
	stowed?: boolean
}

/**
 * The create page's tray.
 *
 * Three modal tools on the left, page actions and playback on the right — the same
 * split as 2013. The transform button is one button with two modes: pressing it
 * again cycles into push, and push refuses to switch on when nothing is selected, so
 * it cycles straight back.
 */
export function CreateTray({ engine, state, stowed = false }: CreateTrayProps) {
	const { tool, transformIndex, playback, pages } = state
	const canPlay = settledPageCount(pages) > 1

	// Only while a page is actually arriving or leaving. Playing doesn't disable
	// these — the press stops playback instead, and the next one goes through.
	const canChangePages = !state.busy

	const toolClass = (id: ModalToolId) =>
		tool === id ? `${styles.tool} ${styles.toolActive}` : styles.tool

	return (
		<div className={stowed ? `${styles.tray} ${styles.stowed}` : styles.tray}>
			<ul className={`${styles.group} ${styles.tools}`}>
				<li>
					<button
						type="button"
						className={toolClass('pencil')}
						title="Draw (b)"
						aria-pressed={tool === 'pencil'}
						onClick={() => engine.selectTool('pencil')}
					>
						<span className={icons.pencil} aria-hidden="true" />
						<span className="visuallyHidden">Draw</span>
					</button>

					{/* Not while the form is up: the tools have flown away and a settings
					    popover with nothing above it is just a floating box. */}
					{tool === 'pencil' && !stowed ? (
						<WidthSlider value={state.pencilWidth} onChange={(w) => engine.setPencilWidth(w)} />
					) : null}
				</li>

				<li>
					<button
						type="button"
						className={toolClass('eraser')}
						title="Erase (e)"
						aria-pressed={tool === 'eraser'}
						onClick={() => engine.selectTool('eraser')}
					>
						<span className={icons.eraser} aria-hidden="true" />
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
						<span className={`${styles.layer} ${icons.transform}`} aria-hidden="true" />
						<span
							className={`${styles.layer} ${
								tool === 'transform' && transformIndex === 0 ? icons.translateActive : icons.translate
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

				<CirclePlayButton engine={engine} playback={playback} enabled={canPlay} />
				<PlayButton engine={engine} playback={playback} enabled={canPlay} />
			</ul>
		</div>
	)
}

export function PlayButton({
	engine,
	playback,
	enabled,
}: {
	engine: FlipbookEngine
	playback: FlipbookState['playback']
	enabled: boolean
}) {
	const on = playback === 'play'

	return (
		<li>
			<button
				type="button"
				className={`${styles.action} ${styles.playback}`}
				title={on ? 'Pause' : 'Play'}
				aria-pressed={on}
				disabled={!enabled}
				onClick={() => engine.togglePlay()}
			>
				<span className={on ? icons.pause : icons.play} aria-hidden="true" />
				<span className="visuallyHidden">{on ? 'Pause' : 'Play'}</span>
			</button>
		</li>
	)
}

/**
 * Circleplay: scrub the flipbook by drawing circles with the pointer. There is no
 * touch equivalent — you'd be covering the thing you're scrubbing — so it isn't
 * offered there.
 */
export function CirclePlayButton({
	engine,
	playback,
	enabled,
}: {
	engine: FlipbookEngine
	playback: FlipbookState['playback']
	enabled: boolean
}) {
	const on = playback === 'circleplay'

	return (
		<li>
			<button
				type="button"
				className={`${styles.action} ${styles.playback} ${on ? styles.circleplayOn : styles.circleplay}`}
				title={on ? 'Stop circleplay' : 'Circleplay'}
				aria-pressed={on}
				disabled={!enabled}
				onClick={() => engine.toggleCircleplay()}
			>
				<span className={on ? icons.pause : icons.circleplay} aria-hidden="true" />
				<span className="visuallyHidden">Circleplay</span>
			</button>
		</li>
	)
}

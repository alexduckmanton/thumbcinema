import { useEffect, useRef } from 'react'

import { type DrawMode, setToolPressed, TAP_SLOP } from '../drawModes'
import type { FlipbookEngine, FlipbookState } from '../engine/FlipbookEngine'
import type { ModalToolId } from '../engine/tools/types'
import icons from '../../styles/icons.module.css'
import styles from './Tray.module.css'

export interface CreateTrayProps {
	engine: FlipbookEngine
	state: FlipbookState
	/** True while the save form is up: the controls fly away and leave it alone. */
	stowed?: boolean
	/** Scaffolding: in `holdTool` all three tools are held down to use them. */
	mode: DrawMode
}

/**
 * The create page's tray: three modal tools on the left, three page actions on the
 * right.
 *
 * The transform button is one button with two tools: pressing it again cycles into
 * push and back. Push used to refuse to switch on unless something was selected — it
 * selects for itself now, so the cycle always goes round.
 *
 * One layout at every width, and shorter than it was. 2013 ended this row with play and
 * circleplay; the page bar under the drawing is both of those now — a tap on its handle
 * plays, and dragging it is the scrub — so the tray is the six controls that are the
 * drawing and nothing else. The pencil's width popover went the same way: see
 * `DEFAULT_PENCIL_WIDTH`.
 */
export function CreateTray({ engine, state, stowed = false, mode }: CreateTrayProps) {
	const { tool, transformIndex } = state

	// Only while a page is actually arriving or leaving. Playing doesn't disable
	// these — the press stops playback instead, and the next one goes through.
	const canChangePages = !state.busy

	const toolClass = (id: ModalToolId) =>
		tool === id ? `${styles.tool} ${styles.toolActive}` : styles.tool

	const holdToUse = mode === 'holdTool'

	// A held button that outlives the mode, the page or the tray would leave the tool
	// working for ever with nothing on screen saying so.
	useEffect(() => {
		if (!holdToUse) setToolPressed(null)
		return () => setToolPressed(null)
	}, [holdToUse])

	/**
	 * Press and hold to use the tool, in `holdTool` and nowhere else.
	 *
	 * All this does is report which button is down. What a press *means* — pick the
	 * tool up, or use the one already in hand — depends on whether a finger is on the
	 * canvas, which only `PointerLayer` knows, so it decides. See `onToolPressed`.
	 *
	 * The mouse's half only. A finger goes through `useToolTouch` below, and its
	 * `pointerType` guard is what keeps the two from both reporting the same press.
	 *
	 * **The pointer is captured** on the way down, so the release is heard even if the
	 * cursor has slid off the button by then — which it will have, because selecting a
	 * tool slides the button 50px down out from under it. A missed release is a tool
	 * that never stops.
	 */
	const holdProps = (id: ModalToolId) =>
		holdToUse
			? {
					onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
						if (event.pointerType === 'touch') return
						setToolPressed(id)
						event.currentTarget.setPointerCapture(event.pointerId)
					},
					onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
						if (event.pointerType === 'touch') return
						setToolPressed(null)
					},
					onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
						if (event.pointerType === 'touch') return
						setToolPressed(null)
					},
				}
			: null

	const pencilRef = useToolTouch('pencil', holdToUse, engine)
	const eraserRef = useToolTouch('eraser', holdToUse, engine)
	const transformRef = useToolTouch('transform', holdToUse, engine)

	/**
	 * The mouse's tap, and the keyboard's. A finger's never reaches here.
	 *
	 * `useToolTouch` calls `preventDefault()` on the way down, so a touch produces no
	 * click at all; what this still has to refuse is the *mouse* click in `holdTool`,
	 * which the pointer handlers above have already dealt with — and letting it run as
	 * well would select twice, which for transform is not a no-op: it is the cycle into
	 * push mode, arriving unasked at the end of every hold. `detail` is the click
	 * count, and it is 0 for the synthetic click a keyboard activation produces, which
	 * is exactly the one that still has to work.
	 */
	const press = (id: ModalToolId) => (event: React.MouseEvent<HTMLButtonElement>) => {
		if (holdToUse && event.detail > 0) return
		engine.selectTool(id)
	}

	const trayClass = [styles.tray, stowed ? styles.stowed : ''].filter(Boolean)

	return (
		<div className={trayClass.join(' ')}>
			<ul className={`${styles.group} ${styles.tools}`}>
				<li>
					<button
						ref={pencilRef}
						type="button"
						className={toolClass('pencil')}
						title={holdToUse ? 'Draw (b) — hold to draw' : 'Draw (b)'}
						aria-pressed={tool === 'pencil'}
						onClick={press('pencil')}
						{...holdProps('pencil')}
					>
						<span className={`${styles.blade} ${icons.pencil}`} aria-hidden="true" />
						<span className="visuallyHidden">Draw</span>
					</button>
				</li>

				<li>
					<button
						ref={eraserRef}
						type="button"
						className={toolClass('eraser')}
						title={holdToUse ? 'Erase (e) — hold to rub out' : 'Erase (e)'}
						aria-pressed={tool === 'eraser'}
						onClick={press('eraser')}
						{...holdProps('eraser')}
					>
						<span className={`${styles.blade} ${icons.eraser}`} aria-hidden="true" />
						<span className="visuallyHidden">Erase</span>
					</button>
				</li>

				<li>
					<button
						ref={transformRef}
						type="button"
						className={[
							styles.tool,
							styles.transform,
							tool === 'transform' ? styles.transformActive : '',
						]
							.filter(Boolean)
							.join(' ')}
						title={holdToUse ? 'Transform (v) — hold to select and move' : 'Transform (v)'}
						aria-pressed={tool === 'transform'}
						onClick={press('transform')}
						{...holdProps('transform')}
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

/**
 * A tool button, driven by touch events rather than by a click or a pointer event.
 *
 * **A tap on a tool while another finger is on the canvas is a multi-touch gesture, and
 * a browser owes it neither a `click` nor a mouse event.** That is the whole reason this
 * exists: the compatibility mouse events, and the click synthesised from them, are for a
 * single-finger tap, so every one of the modes that has you keep a finger on the glass —
 * which is every relative mode, and `holdTool` is the default — had a tray that could
 * only be reached by putting the drawing hand down first. Switching tools mid-gesture is
 * exactly what those modes are for. Touch events have no such rule: every finger fires
 * them, and a touch's events all target the element it started on however far it travels
 * and whatever moves underneath it.
 *
 * That last part matters twice over here, because selecting a tool **slides its button
 * 50px down** (`.toolActive`) out from under the finger that just pressed it. A click
 * needs the press and the release on the same element and would be lost; touch's
 * implicit capture means the release lands here regardless. It is why the mouse's half
 * of `holdTool` calls `setPointerCapture` for the same reason.
 *
 * `preventDefault()` on the way down is what keeps the two paths from both firing: no
 * synthesised click, and with it no long-press callout or text selection landing in the
 * middle of somebody's stroke.
 *
 * Native listeners rather than React's `onTouchStart`, because React's are passive by
 * delegation at the root and a passive listener may not call `preventDefault()`.
 */
function useToolTouch(id: ModalToolId, holdToUse: boolean, engine: FlipbookEngine) {
	const ref = useRef<HTMLButtonElement>(null)

	// Read at the moment a finger lands rather than closed over, so that switching mode
	// or page mid-press doesn't leave the listeners rebound around a live touch.
	const latest = useRef({ holdToUse, engine })
	latest.current = { holdToUse, engine }

	useEffect(() => {
		const button = ref.current
		if (!button) return

		let active: number | null = null
		let startX = 0
		let startY = 0
		let travel = 0

		const onStart = (event: TouchEvent) => {
			const touch = event.changedTouches[0]
			if (!touch || active !== null) return

			event.preventDefault()
			active = touch.identifier
			startX = touch.clientX
			startY = touch.clientY
			travel = 0

			if (latest.current.holdToUse) setToolPressed(id)
		}

		const onMove = (event: TouchEvent) => {
			if (active === null) return
			for (const touch of Array.from(event.changedTouches)) {
				if (touch.identifier !== active) continue
				travel = Math.max(travel, Math.hypot(touch.clientX - startX, touch.clientY - startY))
			}
		}

		const onEnd = (event: TouchEvent) => {
			if (active === null) return
			if (!Array.from(event.changedTouches).some((touch) => touch.identifier === active)) return
			active = null

			// In `holdTool` the layer decides what the press meant — the tool being used,
			// or an ordinary tap picking it up — because only it knows whether a finger
			// was on the canvas. Everywhere else a tap is a tap. See `onToolPressed`.
			if (latest.current.holdToUse) {
				setToolPressed(null)
				return
			}

			if (event.type === 'touchend' && travel <= TAP_SLOP) latest.current.engine.selectTool(id)
		}

		button.addEventListener('touchstart', onStart, { passive: false })
		button.addEventListener('touchmove', onMove, { passive: false })
		button.addEventListener('touchend', onEnd)
		button.addEventListener('touchcancel', onEnd)

		return () => {
			button.removeEventListener('touchstart', onStart)
			button.removeEventListener('touchmove', onMove)
			button.removeEventListener('touchend', onEnd)
			button.removeEventListener('touchcancel', onEnd)
			// A button that goes away mid-hold must not leave the tool working.
			if (active !== null && latest.current.holdToUse) setToolPressed(null)
		}
	}, [id])

	return ref
}

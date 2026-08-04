import { useEffect, useRef } from 'react'

import type { FlipbookEngine, FlipbookState } from '../engine/FlipbookEngine'
import type { ModalToolId } from '../engine/tools/types'
import { setToolPressed } from '../pointer'
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
 * The transform tool is three controls in one picture: the hand is the tool, and the two
 * halves of the fan behind it are its two modes. It was one button that cycled — see
 * `.transform` in the stylesheet for why it could not stay that way once a finger on the
 * page could press it.
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

	// A held button that outlives the page or the tray would leave the tool working for
	// ever with nothing on screen saying so.
	useEffect(() => () => setToolPressed(null), [])

	/**
	 * Press and hold to use the tool.
	 *
	 * All this does is report which button is down. What a press *means* — pick the
	 * tool up, or use the one already in hand — depends on whether a finger is on the
	 * page, which only `PointerLayer` knows, so it decides. See `onToolPressed`.
	 *
	 * The mouse's half only. A finger goes through `useToolTouch` below, and its
	 * `pointerType` guard is what keeps the two from both reporting the same press.
	 *
	 * **The pointer is captured** on the way down, so the release is heard even if the
	 * cursor has slid off the button by then — which it will have, because selecting a
	 * tool slides the button 50px down out from under it. A missed release is a tool
	 * that never stops.
	 */
	const holdProps = (id: ModalToolId) => ({
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
	})

	const pencilRef = useToolTouch('pencil')
	const eraserRef = useToolTouch('eraser')
	const transformRef = useToolTouch('transform')

	/**
	 * The two halves of the transform fan, which switch mode and never use the tool.
	 *
	 * `mode` is the mouse's and the keyboard's; `useModeTouch` is a finger's, and exists
	 * for the same reason `useToolTouch` does — a tap while another finger is on the page
	 * is a multi-touch gesture, and a browser owes it no click at all.
	 */
	const mode = (index: 0 | 1) => () => engine.setTransformMode(index)
	const moveRef = useModeTouch(() => engine.setTransformMode(0))
	const pushRef = useModeTouch(() => engine.setTransformMode(1))

	/**
	 * The keyboard's tap. A finger's never reaches here, and a mouse's is handled above.
	 *
	 * `useToolTouch` calls `preventDefault()` on the way down, so a touch produces no
	 * click at all; what this still has to refuse is the *mouse* click, which the pointer
	 * handlers above have already dealt with. `detail` is the click count, and it is 0 for
	 * the synthetic click a keyboard activation produces, which is exactly the one that
	 * still has to work.
	 */
	const press = (id: ModalToolId) => (event: React.MouseEvent<HTMLButtonElement>) => {
		if (event.detail > 0) return
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
						title="Draw (b) — hold to draw"
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
						title="Erase (e) — hold to rub out"
						aria-pressed={tool === 'eraser'}
						onClick={press('eraser')}
						{...holdProps('eraser')}
					>
						<span className={`${styles.blade} ${icons.eraser}`} aria-hidden="true" />
						<span className="visuallyHidden">Erase</span>
					</button>
				</li>

				<li>
					{/* Three controls in one picture: the hand is the tool, and the two halves
					    of the fan are its two modes. See `.transform` in the stylesheet for why
					    they are separate, which is the whole of how transform and push are told
					    apart while a finger is on the page. */}
					<div
						className={[
							styles.tool,
							styles.transform,
							tool === 'transform' ? styles.transformActive : '',
						]
							.filter(Boolean)
							.join(' ')}
					>
						<button
							ref={transformRef}
							type="button"
							className={styles.hand}
							title="Transform (v) — hold to select and move"
							aria-pressed={tool === 'transform'}
							onClick={press('transform')}
							{...holdProps('transform')}
						>
							<span className={`${styles.layer} ${icons.transform}`} aria-hidden="true" />
							<span className="visuallyHidden">Transform</span>
						</button>

						<button
							ref={moveRef}
							type="button"
							className={styles.mode}
							title="Move, scale and rotate"
							aria-pressed={tool === 'transform' && transformIndex === 0}
							disabled={tool !== 'transform'}
							onClick={mode(0)}
						>
							<span
								className={`${styles.layer} ${styles.spokeTranslate} ${
									tool === 'transform' && transformIndex === 0
										? icons.translateActive
										: icons.translate
								}`}
								aria-hidden="true"
							/>
							<span
								className={`${styles.layer} ${styles.spokeRotate} ${
									tool === 'transform' && transformIndex === 0 ? icons.rotateActive : icons.rotate
								}`}
								aria-hidden="true"
							/>
							<span className="visuallyHidden">Move, scale and rotate</span>
						</button>

						<button
							ref={pushRef}
							type="button"
							className={styles.mode}
							title="Push the line about"
							aria-pressed={tool === 'transform' && transformIndex === 1}
							disabled={tool !== 'transform'}
							onClick={mode(1)}
						>
							<span
								className={`${styles.layer} ${styles.spokePush} ${
									tool === 'transform' && transformIndex === 1 ? icons.nudgeActive : icons.nudge
								}`}
								aria-hidden="true"
							/>
							<span className="visuallyHidden">Push the line about</span>
						</button>
					</div>
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
 * **A tap on a tool while another finger is on the page is a multi-touch gesture, and a
 * browser owes it neither a `click` nor a mouse event.** That is the whole reason this
 * exists: the compatibility mouse events, and the click synthesised from them, are for a
 * single-finger tap — so the tray could only be reached by putting the drawing hand down
 * first, and holding a tool while a finger aims is the entire mechanism. Touch events
 * have no such rule: every finger fires them, and a touch's events all target the element
 * it started on however far it travels and whatever moves underneath it.
 *
 * That last part matters twice over here, because selecting a tool **slides its button
 * 50px down** (`.toolActive`) out from under the finger that just pressed it. A click
 * needs the press and the release on the same element and would be lost; touch's
 * implicit capture means the release lands here regardless. It is why the mouse's half
 * calls `setPointerCapture`, for the same reason.
 *
 * `preventDefault()` on the way down is what keeps the two paths from both firing: no
 * synthesised click, and with it no long-press callout or text selection landing in the
 * middle of somebody's stroke.
 *
 * All this reports is that the button is down. What the press *meant* — the tool being
 * used, or an ordinary tap picking it up — is settled by `PointerLayer.onToolPressed`,
 * which is the only thing that knows whether a finger was aiming at the time.
 *
 * Native listeners rather than React's `onTouchStart`, because React's are passive by
 * delegation at the root and a passive listener may not call `preventDefault()`.
 */
function useToolTouch(id: ModalToolId) {
	const ref = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		const button = ref.current
		if (!button) return

		let active: number | null = null

		const onStart = (event: TouchEvent) => {
			const touch = event.changedTouches[0]
			if (!touch || active !== null) return

			event.preventDefault()
			active = touch.identifier
			setToolPressed(id)
		}

		const onEnd = (event: TouchEvent) => {
			if (active === null) return
			if (!Array.from(event.changedTouches).some((touch) => touch.identifier === active)) return

			active = null
			setToolPressed(null)
		}

		button.addEventListener('touchstart', onStart, { passive: false })
		button.addEventListener('touchend', onEnd)
		button.addEventListener('touchcancel', onEnd)

		return () => {
			button.removeEventListener('touchstart', onStart)
			button.removeEventListener('touchend', onEnd)
			button.removeEventListener('touchcancel', onEnd)
			// A button that goes away mid-hold must not leave the tool working.
			if (active !== null) setToolPressed(null)
		}
	}, [id])

	return ref
}

/**
 * A mode button in the transform fan, driven by touch for the reason `useToolTouch` is:
 * a tap made while another finger is on the page produces no `click`.
 *
 * Much less to it than a tool, though, because there is nothing to decide. It has one
 * meaning, it is over on the way up, and it never touches the drawing — which is exactly
 * why the mode lives here rather than on a second press of the tool.
 */
function useModeTouch(pick: () => void) {
	const ref = useRef<HTMLButtonElement>(null)

	const latest = useRef(pick)
	latest.current = pick

	useEffect(() => {
		const button = ref.current
		if (!button) return

		let active: number | null = null

		const onStart = (event: TouchEvent) => {
			const touch = event.changedTouches[0]
			if (!touch || active !== null || button.disabled) return

			event.preventDefault()
			active = touch.identifier
		}

		const onEnd = (event: TouchEvent) => {
			if (active === null) return
			if (!Array.from(event.changedTouches).some((touch) => touch.identifier === active)) return

			active = null
			if (event.type === 'touchend') latest.current()
		}

		button.addEventListener('touchstart', onStart, { passive: false })
		button.addEventListener('touchend', onEnd)
		button.addEventListener('touchcancel', onEnd)

		return () => {
			button.removeEventListener('touchstart', onStart)
			button.removeEventListener('touchend', onEnd)
			button.removeEventListener('touchcancel', onEnd)
		}
	}, [])

	return ref
}

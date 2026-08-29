import { useEffect, useRef } from 'react'

import { type DrawMode, holdsTool } from '../drawModes'
import type { FlipbookEngine, FlipbookState } from '../engine/FlipbookEngine'
import type { ModalToolId } from '../engine/tools/types'
import { setToolPressed } from '../pointer'
import styles from './ToolPanel.module.css'

export interface ToolPanelProps {
	engine: FlipbookEngine
	state: FlipbookState
	/** True while the save form is up: the panel flies away and leaves it alone. */
	stowed?: boolean
	/** Which drawing mode is on, which is only whether holding a tool means anything. */
	mode: DrawMode
	/** Whether the drawing tool is the thing on screen, rather than the save form. */
	drawing: boolean
	/** The trace photo's button: what it says, whether it is lit, and what it does. */
	trace: { label: string; on: boolean; enabled: boolean; onPress: () => void }
	/** Save, which is the one control here that keeps its word. */
	save: { enabled: boolean; onPress: () => void }
}

/**
 * Every control on the create page, in one panel: down the left on a desktop, along the
 * bottom on a phone.
 *
 * This is the 2025 layout and it is deliberately not 2013's. What it replaces is a tray
 * of hand-drawn tools standing under the paper, four edit actions up beside the wordmark
 * on a desktop and along the bottom of the window on a phone, and a save button in a
 * third place again — three groups in three places, none of which could see each other.
 * Here they are one column in one order: what marks the page, what changes the page,
 * what undoes it, and what finishes it.
 *
 * **Every button is 40×40 and wears a Pecita glyph.** The tools were 304px pictures
 * anchored by their tips, cut off at the tray's top edge so a pencil appeared to hang off
 * the bottom of the paper — the best thing on the old page and the thing that could not
 * come with it, because a rail 72px wide has no length for a pencil to run up. What
 * carries the hand instead is the face: Pecita is the wordmark's, its dingbats are drawn
 * rather than geometric, and ✎ ⌫ ✜ ✍ are the same pen as ↺ ↻ ↥ ↧, which were already
 * here. One family, at one size, in one place.
 *
 * The glyphs are chosen against the font rather than from the usual set — Pecita has no
 * scissors, no overlapping sheets and no play triangle, so anything that leans on those
 * would silently fall through to a system fallback and stop looking like this website.
 * Where the obvious mark is missing the tooltip and the label carry the actual words:
 * ⊡ for duplicate is a page with its drawing still on it, which is a compromise and is
 * worth knowing is one.
 */
export function ToolPanel({
	engine,
	state,
	stowed = false,
	mode,
	drawing,
	trace,
	save,
}: ToolPanelProps) {
	const { tool, transformIndex } = state

	/*
	 * Whether these buttons are held or tapped, which is the drawing mode's answer and
	 * not this component's.
	 *
	 * It changes nothing about how a press is *reported* — every mode reports it, and
	 * `PointerLayer.onToolPressed` is the one place that decides what a press meant, so
	 * that a mode where holding means nothing simply reads every press as an ordinary
	 * tap. What it changes is what the tooltip claims, and a control that describes a
	 * gesture the mode you are in doesn't have is worse than one that says nothing.
	 */
	const holdToUse = holdsTool(mode)

	// Only while a page is actually arriving or leaving. Playing doesn't disable
	// these — the press stops playback instead, and the next one goes through.
	const canChangePages = !state.busy

	// A held button that outlives the page or the panel would leave the tool working for
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
	 * cursor has slid off the button by then. The tools no longer move out from under it
	 * — a 40px button in a rail has nowhere to slide to, and says it is in hand by taking
	 * the ink instead — but a pointer that wanders during a hold is still a release this
	 * has to hear, and a missed release is a tool that never stops.
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
	 * The two halves of the transform fan, which do one thing each and say which by being
	 * lit or not.
	 *
	 * **The unlit one names the other mode, and switching is all it does.** Not switching
	 * *and* engaging, the way pressing a different tool does: engaging push at the cursor
	 * runs its mousedown there, and away from the strokes that means `selection.clear()`
	 * — which is the selection this press was most likely on its way to bend.
	 *
	 * **The lit one is the mode you are already in, which is the tool in hand**, so it
	 * does what the hand does: press and hold to use it.
	 *
	 * They were a fan of spokes behind the transform tool's picture and are two ordinary
	 * buttons now, indented under the tool they belong to and shown only while it is in
	 * hand — which is the same rule the fan had, said with layout instead of with art.
	 */
	const fanProps = (index: 0 | 1) => ({
		onClick: () => engine.setTransformMode(index),
		...(transformIndex === index ? holdProps('transform') : {}),
	})

	const moveRef = useFanTouch(0, transformIndex, engine)
	const pushRef = useFanTouch(1, transformIndex, engine)

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

	const toolHint = (verb: string, key: string, held: string) =>
		holdToUse ? `${verb} (${key}) — hold to ${held}` : `${verb} (${key})`

	return (
		<div className={stowed ? `${styles.panel} ${styles.stowed}` : styles.panel}>
			<div className={styles.rail}>
				<div className={styles.group}>
					<PanelButton
						ref={pencilRef}
						label="Draw"
						glyph="✎"
						hint={toolHint('Draw', 'b', 'draw')}
						on={tool === 'pencil'}
						onClick={press('pencil')}
						{...holdProps('pencil')}
					/>
					<PanelButton
						ref={eraserRef}
						label="Erase"
						glyph="⌫"
						hint={toolHint('Erase', 'e', 'rub out')}
						on={tool === 'eraser'}
						onClick={press('eraser')}
						{...holdProps('eraser')}
					/>
					<PanelButton
						ref={transformRef}
						label="Transform"
						glyph="✜"
						hint={toolHint('Transform', 'v', 'select and move')}
						on={tool === 'transform'}
						onClick={press('transform')}
						{...holdProps('transform')}
					/>

					{/* The tool's own two modes, and only ever while it is the tool in hand.
					    Not disabled-but-present, as the fan's spokes were: a rail is a list you
					    read down, and two permanently dim buttons in the middle of it read as
					    two controls that are broken rather than as one tool's settings. */}
					{tool === 'transform' ? (
						<div className={styles.modes}>
							<PanelButton
								ref={moveRef}
								label="Move, scale and rotate"
								glyph="✥"
								hint={
									holdToUse && transformIndex === 0
										? 'Move, scale and rotate — hold to use'
										: 'Move, scale and rotate'
								}
								on={transformIndex === 0}
								{...fanProps(0)}
							/>
							<PanelButton
								ref={pushRef}
								label="Push the line about"
								glyph="✍"
								hint={
									holdToUse && transformIndex === 1
										? 'Push the line about — hold to use'
										: 'Push the line about'
								}
								on={transformIndex === 1}
								{...fanProps(1)}
							/>
						</div>
					) : null}
				</div>

				<div className={styles.group}>
					<PanelButton
						label="New blank page"
						glyph="✚"
						hint="Blank page (n)"
						enabled={canChangePages}
						onClick={() => void engine.addBlankPage()}
					/>
					<PanelButton
						label="Duplicate page"
						glyph="⊡"
						hint="Duplicate page (d)"
						enabled={canChangePages}
						onClick={() => void engine.duplicatePage()}
					/>
					<PanelButton
						label="Delete page"
						glyph="✕"
						hint="Delete page"
						enabled={canChangePages}
						onClick={() => void engine.deletePage()}
					/>
				</div>

				<div className={styles.group}>
					{/* Undo, redo, copy, paste: the two that spend the history first, then the
					    two that spend the clipboard. Copy is dim until something is selected and
					    paste until something has been copied, which between them are the whole
					    of the instructions. */}
					<PanelButton
						label="Undo"
						glyph="↺"
						hint="Undo (⌘Z)"
						enabled={drawing && state.canUndo}
						onClick={() => engine.undo()}
					/>
					<PanelButton
						label="Redo"
						glyph="↻"
						hint="Redo (⇧⌘Z)"
						enabled={drawing && state.canRedo}
						onClick={() => engine.redo()}
					/>
					<PanelButton
						label="Copy"
						glyph="↥"
						hint="Copy (⌘C)"
						enabled={drawing && state.canCopy}
						onClick={() => engine.copySelection()}
					/>
					<PanelButton
						label="Paste"
						glyph="↧"
						hint="Paste (⌘V)"
						enabled={drawing && state.canPaste}
						onClick={() => engine.pasteClipboard()}
					/>
				</div>

				{/* The trace photo's front door, which used to exist at phone width only —
				    there was nowhere on the desktop layout to put it. There is now, and a file
				    picker is a camera on a machine that hasn't got one, so it is here at both
				    widths rather than only where the hardware is. */}
				<div className={styles.group}>
					<PanelButton
						label={trace.label}
						glyph="⊙"
						hint={trace.label}
						enabled={trace.enabled}
						pressed={trace.on}
						on={trace.on}
						onClick={trace.onPress}
					/>
				</div>
			</div>

			{/*
			 * Save, which keeps its word and its yellow.
			 *
			 * Sticky rather than merely last: the rail scrolls when the window is too short
			 * for the list, and the one control you must be able to reach without going
			 * looking for it is the one that ends the errand. It is the same yellow at the
			 * same rounding as the gallery's create button for the reason it always was —
			 * the two are the ends of one errand.
			 *
			 * One page isn't a flipbook. The button stays in the layout so nothing jumps
			 * when the second page arrives; it just isn't offering anything yet.
			 */}
			<div className={save.enabled ? styles.saveSlot : `${styles.saveSlot} ${styles.noSave}`}>
				<button
					type="button"
					className={styles.saveButton}
					onClick={save.onPress}
					disabled={!save.enabled}
				>
					<span className={styles.saveLabel}>Save</span>
				</button>
			</div>
		</div>
	)
}

/**
 * One control: a 40×40 white tile wearing a single Pecita character.
 *
 * `on` and `pressed` are not the same claim and only one of them is a lie if they are
 * confused. `on` is how it looks — the tool in hand, or the photo still in hand — and
 * `pressed` is what it tells a screen reader, which is only true of a control that is
 * actually a toggle. A one-shot like undo is never *in* a state, so it gets no
 * `aria-pressed` at all rather than a permanent "false" claiming it is a toggle it isn't.
 * The tools do get one, because a modal tool genuinely is.
 */
const PanelButton = ({
	ref,
	label,
	glyph,
	hint,
	enabled = true,
	on = false,
	pressed,
	onClick,
	...rest
}: {
	ref?: React.Ref<HTMLButtonElement>
	label: string
	glyph: string
	hint: string
	enabled?: boolean
	/** Lit: this is the tool in hand, or the state this button is currently in. */
	on?: boolean
	pressed?: boolean
	onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
} & React.ComponentPropsWithoutRef<'button'>) => (
	<button
		{...rest}
		ref={ref}
		type="button"
		className={on ? `${styles.button} ${styles.buttonOn}` : styles.button}
		title={hint}
		disabled={!enabled}
		aria-pressed={pressed ?? (on ? true : undefined)}
		onClick={onClick}
	>
		<span className={styles.glyph} aria-hidden="true">
			{glyph}
		</span>
		<span className="visuallyHidden">{label}</span>
	</button>
)

/**
 * A tool button, driven by touch events rather than by a click or a pointer event.
 *
 * **A tap on a tool while another finger is on the page is a multi-touch gesture, and a
 * browser owes it neither a `click` nor a mouse event.** That is the whole reason this
 * exists: the compatibility mouse events, and the click synthesised from them, are for a
 * single-finger tap — so the panel could only be reached by putting the drawing hand down
 * first, and holding a tool while a finger aims is the entire mechanism. Touch events
 * have no such rule: every finger fires them, and a touch's events all target the element
 * it started on however far it travels and whatever moves underneath it.
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
 * Half of the transform fan, driven by touch for the reason `useToolTouch` is: a tap made
 * while another finger is on the page produces no `click`.
 *
 * Which of its two jobs it does is decided by *which button this is*, not by anything
 * about the press — see `fanProps` above. Unlit, it switches the mode and stops there.
 * Lit, it is the tool in hand and behaves exactly like the hand: it reports the press and
 * lets `PointerLayer` put the tool to work at the cursor for as long as it is held.
 */
function useFanTouch(index: 0 | 1, transformIndex: 0 | 1, engine: FlipbookEngine) {
	const ref = useRef<HTMLButtonElement>(null)

	// Read when a finger lands rather than closed over, so switching mode mid-press
	// doesn't leave the listeners rebound around a live touch.
	const latest = useRef({ transformIndex, engine })
	latest.current = { transformIndex, engine }

	useEffect(() => {
		const button = ref.current
		if (!button) return

		let active: number | null = null
		let holding = false

		const onStart = (event: TouchEvent) => {
			const touch = event.changedTouches[0]
			if (!touch || active !== null || button.disabled) return

			event.preventDefault()
			active = touch.identifier

			if (latest.current.transformIndex !== index) {
				latest.current.engine.setTransformMode(index)
				return
			}

			holding = true
			setToolPressed('transform')
		}

		const onEnd = (event: TouchEvent) => {
			if (active === null) return
			if (!Array.from(event.changedTouches).some((touch) => touch.identifier === active)) return

			active = null
			if (!holding) return
			holding = false
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
			if (holding) setToolPressed(null)
		}
	}, [index])

	return ref
}

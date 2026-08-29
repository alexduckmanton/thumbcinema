import { useEffect, useRef } from 'react'

import { type DrawMode, holdsTool } from '../drawModes'
import { DrawModeSwitch } from './DrawModeSwitch'
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
	/**
	 * v14's aiming pad, and whether it is on screen. `null` in every mode that hasn't got
	 * one, which is every mode but v14 — see `usesAimPad`.
	 */
	pad?: { on: boolean; onToggle: () => void } | null
}

/**
 * Every control on the create page, in one panel: down the left on a desktop, along the
 * bottom on a phone.
 *
 * A rail at every width, which it was not at first: the phone had the same buttons lying
 * down in a bar along the bottom. Standing them up put them back on the same axis as the
 * flipbook they are used on, and gave the row's overflow somewhere sensible to go — a
 * column that runs past the bottom of a phone is a list you scroll, where a row that runs
 * off the right-hand edge is a list nobody knows is there.
 *
 * What it replaces is a tray of hand-drawn tools standing under the paper, four edit
 * actions up beside the wordmark on a desktop and along the bottom of the window on a
 * phone, and a save button in a third place again — three groups in three places, none of
 * which could see each other. Here they are one column in one order: what marks the page,
 * what changes the page, what undoes it, and what it is traced from. Save is not in it:
 * it went back to being the floating button it has always been, which is the create
 * page's own note to explain.
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
 *
 * **There are four tools, not three.** Transform's two modes used to be a fan of spokes
 * behind one picture, and then two buttons indented under one tile — both of which made
 * you open a thing before you could reach either half of it. They are ordinary tools now,
 * standing in the row with the pencil and the eraser: ✥ moves, scales and rotates, ✍
 * pushes the line about, and pressing either one picks transform up in that mode. What
 * that costs is one row of rail; what it buys is that every tool this page has is one
 * press away, and that the panel no longer has a control whose only job is to reveal
 * other controls.
 */
export function ToolPanel({
	engine,
	state,
	stowed = false,
	mode,
	drawing,
	trace,
	pad = null,
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
	const holdProps = (id: ModalToolId, before?: () => void) => ({
		onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
			if (event.pointerType === 'touch') return
			// The transform tools' `before` sets which of the two modes the press means,
			// and it has to run first: the layer reads the tool in hand the moment it is
			// told a button is down.
			before?.()
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
	const moveRef = useToolTouch('transform', () => engine.selectTransform(0))
	const pushRef = useToolTouch('transform', () => engine.selectTransform(1))

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

	/**
	 * The keyboard's tap on one of the two transform tools.
	 *
	 * `selectTransform` rather than the pair of calls, because picking the tool up resets
	 * the mode and setting the mode is refused until the tool is up — see the engine, where
	 * the whole of that is written down.
	 */
	const pressTransform = (index: 0 | 1) => (event: React.MouseEvent<HTMLButtonElement>) => {
		if (event.detail > 0) return
		engine.selectTransform(index)
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
					{/*
					 * Transform's two modes, standing in the row as two tools.
					 *
					 * Each press does both halves at once — set the mode, pick the tool up —
					 * which is what makes them independent: there is no state in which one of
					 * them is unreachable, and no order they have to be pressed in. Held, they
					 * behave exactly as the pencil does, because by the time the layer reads
					 * the press the mode is already set. See `holdProps`.
					 */}
					<PanelButton
						ref={moveRef}
						label="Move, scale and rotate"
						glyph="✥"
						hint={toolHint('Move, scale and rotate', 'v', 'select and move')}
						on={tool === 'transform' && transformIndex === 0}
						onClick={pressTransform(0)}
						{...holdProps('transform', () => engine.selectTransform(0))}
					/>
					<PanelButton
						ref={pushRef}
						label="Push the line about"
						glyph="✍"
						hint={holdToUse ? 'Push the line about — hold to use' : 'Push the line about'}
						on={tool === 'transform' && transformIndex === 1}
						onClick={pressTransform(1)}
						{...holdProps('transform', () => engine.selectTransform(1))}
					/>
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

				{/*
				 * The aiming pad's switch, and it is a view control rather than a tool: it puts
				 * the pad away and gives the band it was standing in back to the drawing.
				 *
				 * Which is a real trade rather than a tidy-up, and the button says so by lighting
				 * when the pad is *up*: with it down there is nowhere for a finger to aim from and
				 * v14 has no cursor control at all. That is the right thing to offer anyway —
				 * there is drawing you want the room for, and the tools and the paper still work
				 * — but it is not a preference, it is a thing you turn back on.
				 *
				 * Its own group, and it hides itself above the phone breakpoint, where the pad
				 * does too. `⌗` is Pecita's, checked against the font: the face has no trackpad
				 * and no rectangle, and a glyph it hasn't got falls silently through to a system
				 * one and stops looking like this website.
				 */}
				{pad ? (
					<div className={`${styles.group} ${styles.padOnly}`}>
						<PanelButton
							label={pad.on ? 'Hide the aiming pad' : 'Show the aiming pad'}
							glyph="⌗"
							hint={pad.on ? 'Hide the aiming pad' : 'Show the aiming pad'}
							on={pad.on}
							pressed={pad.on}
							onClick={pad.onToggle}
						/>
					</div>
				) : null}

				{/*
				 * The drawing-mode switch, at the bottom of the rail and for admins only —
				 * `DrawModeSwitch` renders nothing at all for anybody else, so this is a group
				 * that usually isn't there.
				 *
				 * It floated in the top right of the window until Save took that corner. Down
				 * here is where it belongs anyway: it is scaffolding, it is the least urgent
				 * thing on the page, and a rail that runs off the bottom of a phone is exactly
				 * the right place for a control you should have to go looking for. It is still
				 * dressed as scaffolding rather than as a tile — see its own stylesheet.
				 */}
				<DrawModeSwitch mode={mode} />
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
function useToolTouch(id: ModalToolId, before?: () => void) {
	const ref = useRef<HTMLButtonElement>(null)

	// Read when a finger lands rather than closed over, so a re-render mid-press doesn't
	// leave the listeners rebound around a live touch. The two transform tools are the
	// only callers that pass one, and what it does is set which mode the press means.
	const latest = useRef(before)
	latest.current = before

	useEffect(() => {
		const button = ref.current
		if (!button) return

		let active: number | null = null

		const onStart = (event: TouchEvent) => {
			const touch = event.changedTouches[0]
			if (!touch || active !== null) return

			event.preventDefault()
			active = touch.identifier
			latest.current?.()
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

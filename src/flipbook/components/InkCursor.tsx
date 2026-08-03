import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { DrawMode } from '../drawModes'
import { CANVAS_WIDTH, PENCIL_COLOR } from '../engine/constants'
import type { FlipbookEngine } from '../engine/FlipbookEngine'
import { ERASE_TOLERANCE } from '../engine/tools/eraser'
import { DEFAULT_PENCIL_WIDTH } from '../engine/tools/pencil'
import type { ModalToolId } from '../engine/tools/types'
import { type Cursor, PointerLayer } from '../pointer'
import styles from './InkCursor.module.css'

export interface InkCursorProps {
	engine: FlipbookEngine | null
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Null on the playback page, and while a page animation holds the tools. */
	tool: ModalToolId | null
	/** Which of the eight answers to "a finger is opaque" is being tried. */
	mode: DrawMode
}

/**
 * What the pointer looks like over the drawing.
 *
 * The ring is the constant: a circle the diameter of the mark about to be made, which
 * replaces the arrow outright on every layout and at every setting. A pencil whose
 * cursor is an arrow tells you where the line will start and nothing about what it
 * will be.
 *
 * Everything else here is one of the drawing modes trying to answer the same
 * question — a finger is opaque, so the thing you are aiming at is under the thing
 * you are aiming with — and this component is where the ones that are *pictures*
 * live. A magnifier over the fingertip, a magnifier pinned in a corner, a ring that
 * greys out while a gesture isn't marking yet. The ones that change where the ink
 * goes rather than what you can see are in `pointer.ts`, and the two halves meet in
 * the `Cursor` this subscribes to.
 *
 * Nothing here reads the scene: the magnifier is drawn from the live canvas, so what
 * it shows is exactly what is on the paper — the stroke in progress, the onion skin,
 * the selection, all of it — and this file knows nothing about paper.js.
 */
export function InkCursor({ engine, canvasRef, tool, mode }: InkCursorProps) {
	const loupe = useRef<HTMLCanvasElement | null>(null)
	const [layer, setLayer] = useState<PointerLayer | null>(null)

	// The pencil and the eraser mark the page; the transform tool moves what is
	// already on it, and has a set of cursors of its own that say which handle you are
	// over. A ring there would be describing a stroke nobody is about to draw.
	const marking = tool === 'pencil' || tool === 'eraser'

	/*
	 * One layer for the life of the page, not one per tool.
	 *
	 * It has to outlive the ring it feeds: `offset` is applied inside the scene and
	 * `zoom` is applied to the canvas element, and a layer that came and went with the
	 * transform tool would put both back to their defaults every time you picked it
	 * up. The mode is handed over separately, below, for the same reason — rebuilding
	 * the layer to change a setting would drop whatever gesture was in flight.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `mode` is the starting value only; `setMode` below carries changes across. See above.
	useEffect(() => {
		const canvas = canvasRef.current
		// `.book`, which wraps the canvas. The listeners have to be on an ancestor to
		// be sure of running before paper's own — at the target element, capture and
		// bubble listeners are called in the order they were added, so registering on
		// the canvas itself would be a race against whichever ran first.
		const surface = canvas?.parentElement
		if (!engine || !canvas || !surface) return

		const created = new PointerLayer(surface, canvas, engine, mode)
		setLayer(created)

		return () => {
			created.destroy()
			setLayer(null)
		}
	}, [engine, canvasRef])

	useEffect(() => {
		layer?.setMode(mode)
	}, [layer, mode])

	const cursor = useSyncExternalStore(
		layer ? layer.subscribe : NO_SUBSCRIBE,
		() => layer?.snapshot ?? null,
		() => null,
	)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || !marking) return

		// The ring *is* the cursor, so the arrow goes. Written on the element rather
		// than set in the stylesheet because the transform tool writes its own cursors
		// there too, and an inline style is the only thing that can be sure of beating
		// one.
		const previous = canvas.style.cursor
		canvas.style.cursor = 'none'

		return () => {
			canvas.style.cursor = previous
		}
	}, [canvasRef, marking])

	/**
	 * What the tool is about to put down, in project units — 640 of them across.
	 *
	 * The pencil is one width now, so what this still says is which of the two marking
	 * tools is in hand: an eraser's bite is 20 units against a stroke's 3, and the ring
	 * changing size is the clearest statement either makes about itself.
	 */
	const ink = tool === 'eraser' ? ERASE_TOLERANCE * 2 : DEFAULT_PENCIL_WIDTH

	/*
	 * The magnifier is a finger's, in the two modes that have one, and it is asked of
	 * the *pointer* rather than of the device. `isTouch` answers for the whole machine
	 * — a tablet with a keyboard and a trackpad is a touch device all day, including
	 * while somebody is using the trackpad — and what matters here is what is on the
	 * glass right now. A mouse gets the ring and nothing else.
	 */
	const magnifying = marking && cursor?.touching && (mode === 'loupe' || mode === 'corner')

	// The frame loop below reads this rather than closing over `cursor`, so a moving
	// pointer doesn't restart the loop sixty times a second.
	const cursorRef = useRef(cursor)
	cursorRef.current = cursor

	// Redrawn every frame rather than on every move: the magnifier is showing a stroke
	// being drawn, and most of what changes inside it between two pointer events is
	// the line arriving, not the pointer moving.
	useEffect(() => {
		if (!magnifying) return

		let frame = 0
		const draw = () => {
			paint(loupe.current, canvasRef.current, cursorRef.current, ink)
			frame = requestAnimationFrame(draw)
		}
		draw()

		return () => cancelAnimationFrame(frame)
	}, [magnifying, canvasRef, ink])

	if (!marking || !cursor) return null

	/*
	 * In the two hold modes the ring is also a state: light grey while the gesture is
	 * only aiming, black the moment it starts marking. That is the whole feedback for
	 * a changeover you can't otherwise see — half a second is long enough to wonder
	 * whether it happened.
	 *
	 * Only those two. Everywhere else a ring means the same thing whether the pointer
	 * is down or not, and one that changed colour under a resting mouse would be
	 * saying something it doesn't mean.
	 */
	const holding = mode === 'holdToDraw' || mode === 'holdToMove'
	const state = holding ? (cursor.marking ? styles.inking : styles.waiting) : ''

	return (
		<>
			<span
				className={state ? `${styles.ring} ${state}` : styles.ring}
				aria-hidden="true"
				style={{ left: cursor.inkX, top: cursor.inkY, '--ink': ink } as React.CSSProperties}
			/>

			{/* No `aria-hidden` on the canvas, unlike the ring above it: a `<canvas>` can
			    take focus, and hiding a focusable element from the tree is worse than
			    leaving this one in it — with no role and no accessible name there is
			    nothing here for a reader to announce anyway. */}
			{magnifying ? (
				<canvas
					ref={loupe}
					className={styles.loupe}
					width={LOUPE * ratio()}
					height={LOUPE * ratio()}
					style={mode === 'corner' ? intoCorner(cursor) : liftAbove(cursor)}
				/>
			) : null}
		</>
	)
}

const NO_SUBSCRIBE = () => () => {}

/** The loupe, in CSS pixels. Big enough to aim with, small enough not to be the page. */
const LOUPE = 80

/**
 * How much bigger the drawing is inside the loupe than outside it.
 *
 * Twice, so 80px of loupe covers 40px of screen. Three times is sharper and shows so
 * little of the drawing that it stops being obvious which part of it you are looking
 * at, which is the one thing a loupe must never be.
 */
const ZOOM = 2

/**
 * How far above the finger the loupe floats, centre to touch point.
 *
 * A fingertip's contact patch is around 10mm, so the bottom edge of the circle clears
 * it by about a finger's width again — near enough to read the two together as one
 * thing, far enough that the hand isn't over it.
 */
const LIFT = 76

/** The air between a corner-pinned loupe and the two edges it sits in. */
const INSET = 8

/**
 * Above the finger. Always above the finger.
 *
 * It is allowed to hang off the top of the paper to stay there, and that is the whole
 * decision. A phone's drawing is 193px tall and the loupe needs 116 of them to clear a
 * finger, so anything in the top half of the page has nowhere on the paper to go — and
 * the obvious answer, dropping below the touch point when the room runs out, puts it
 * under the hand it exists to see past. A thumb comes from below.
 *
 * Hanging off the top costs nothing: the loupe paints its own paper, so it reads the
 * same over the header as it does over the drawing. The only clamp is the top of the
 * window, so it can't leave the screen.
 *
 * Sideways it is kept within the drawing, and only the circle moves — what it *shows*
 * stays centred on the finger, because that is the thing being aimed.
 */
function liftAbove(at: Cursor): React.CSSProperties {
	return {
		left: Math.min(Math.max(at.x, LOUPE / 2), at.size - LOUPE / 2),
		// `at.top` is the paper's own distance from the top of the window, and this box
		// is positioned against the paper — so the floor has to be expressed in the
		// paper's coordinates, which is what subtracting it does.
		top: Math.max(at.y - LIFT, LOUPE / 2 - at.top + 4),
	}
}

/**
 * The other way of doing it: pinned in a top corner, and never anywhere else.
 *
 * What it buys is that it can't be under the hand and can't jump — the two complaints
 * that eventually retired Paper by FiftyThree's follower loupe and had Apple pull the
 * text magnifier for two versions of iOS. What it costs is that the magnified view is
 * no longer where you are looking, so aiming means watching one part of the screen
 * while your finger is on another.
 *
 * It swaps corners at the halfway line so it is always on the side the finger isn't,
 * which is the one concession to the hand: a loupe in the top left with a left hand
 * drawing under it is showing the inside of somebody's wrist. Always the top, though,
 * for the same reason `liftAbove` is — a thumb comes from below.
 */
function intoCorner(at: Cursor): React.CSSProperties {
	const left = at.x < at.size / 2 ? at.size - LOUPE / 2 - INSET : LOUPE / 2 + INSET
	return { left, top: LOUPE / 2 + INSET }
}

function ratio(): number {
	return typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3)
}

/**
 * One frame of the loupe: the paper, the drawing under the finger, and the ring.
 *
 * The arithmetic goes through three coordinate spaces and it is worth naming them.
 * `at` is in CSS pixels on the page; the artwork is 640 units wide however wide the
 * canvas is shown; and the canvas's own backing store is a device-pixel multiple of
 * that again, which is where `drawImage` has to be told to read from.
 *
 * Centred on where the *ink* lands rather than on the fingertip. In six modes those
 * are the same point; in `offset` and `steady` they are not, and what is worth
 * magnifying is the end of the line, not the finger dragging it.
 */
function paint(
	loupe: HTMLCanvasElement | null,
	source: HTMLCanvasElement | null,
	at: Cursor | null,
	ink: number,
): void {
	if (!loupe || !source || !at || at.size <= 0) return

	const context = loupe.getContext('2d')
	if (!context) return

	const dpr = ratio()
	context.setTransform(dpr, 0, 0, dpr, 0, 0)

	// A flipbook is ink on paper, and the edges of the canvas — where the loupe is
	// showing part of the page that isn't drawing — have to be paper too.
	context.fillStyle = '#fff'
	context.fillRect(0, 0, LOUPE, LOUPE)

	// Backing-store pixels per CSS pixel of canvas. Not `devicePixelRatio`: paper sizes
	// the backing store from the *project*, so on a phone showing 640 units in 343px
	// this is nearer 4 than 2.
	const density = source.width / at.size
	const window_ = (LOUPE / ZOOM) * density

	context.drawImage(
		source,
		at.inkX * density - window_ / 2,
		at.inkY * density - window_ / 2,
		window_,
		window_,
		0,
		0,
		LOUPE,
		LOUPE,
	)

	// The ring again, magnified with everything else — the loupe is where the aiming
	// actually happens, so the thing being aimed has to be in it. Floored at the same
	// six pixels as the ring on the page, which is stated in the stylesheet: CSS can't
	// hand a number to a canvas, so this is the one place the two have to agree by
	// being written down twice.
	const radius = ((ink * at.size) / CANVAS_WIDTH / 2) * ZOOM
	context.beginPath()
	context.arc(LOUPE / 2, LOUPE / 2, Math.max(radius, 3), 0, Math.PI * 2)
	context.strokeStyle = PENCIL_COLOR
	context.globalAlpha = 0.5
	context.lineWidth = 1
	context.stroke()
	context.globalAlpha = 1
}

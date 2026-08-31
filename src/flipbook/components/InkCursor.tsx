import { useEffect, useRef } from 'react'

import type { DrawMode } from '../drawModes'
import { DEFAULT_PAGE_SIZE, PENCIL_COLOR } from '../engine/constants'
import { ERASE_TOLERANCE } from '../engine/tools/eraser'
import { DEFAULT_PENCIL_WIDTH } from '../engine/tools/pencil'
import type { ModalToolId } from '../engine/tools/types'
import type { Cursor } from '../pointer'
import type { PointerLayer } from '../pointer'
import { useCursor } from '../usePointerLayer'
import styles from './InkCursor.module.css'

export interface InkCursorProps {
	layer: PointerLayer | null
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Null while a page animation holds the tools. */
	tool: ModalToolId | null
	/** Which of the drawing modes is switched on. Two of them draw a magnifier. */
	mode: DrawMode
}

/**
 * What the pointer looks like over the drawing, on both layouts and every input.
 *
 * Two shapes, one per kind of tool. The pencil and the eraser get a **ring** the
 * diameter of the mark about to be made, which replaces the arrow outright: a pencil
 * whose cursor is an arrow tells you where the line will start and nothing about what it
 * will be. The transform tool gets one of **four drawn shapes** saying what a drag from
 * here would grab — see `TransformCursor`, and note that it is drawn for a mouse as well
 * as for a finger: a mouse has had the native `move`/`nwse-resize` set since 2013, and
 * these say the same four things in the site's own hand and at the point the tool is
 * actually working from.
 *
 * Everything else here is one of the drawing modes trying to answer the same question — a
 * finger is opaque, so the thing you are aiming at is under the thing you are aiming with
 * — and this component is where the ones that are *pictures* live: a magnifier over the
 * fingertip, a magnifier pinned in a corner, a cursor that greys out while a gesture
 * isn't marking yet. The ones that change where the ink goes rather than what you can see
 * are in `pointer.ts`, and the two halves meet in the `Cursor` this subscribes to.
 *
 * **This is the paper's cursor and only the paper's.** v11 draws in a second canvas under
 * the tools with a cursor of its own, and `Cursor.surface` is what tells them apart — see
 * `ZoomStage`, which renders the same two shapes at a different scale.
 *
 * Nothing here reads the scene: the magnifier is drawn from the live canvas, so what it
 * shows is exactly what is on the paper — the stroke in progress, the onion skin, the
 * selection, all of it — and this file knows nothing about paper.js.
 */
export function InkCursor({ layer, canvasRef, tool, mode }: InkCursorProps) {
	const loupe = useRef<HTMLCanvasElement | null>(null)
	const cursor = useCursor(layer)

	const shown = marks(tool) || tool === 'transform'

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || !shown) return

		// The drawn cursor *is* the cursor, so the arrow goes — for the transform tool as
		// much as for the two that mark, which is why the selection no longer writes a
		// native cursor of its own. Written on the element rather than in the stylesheet
		// because paper writes inline styles onto this canvas and an inline style is the
		// only thing sure of beating one.
		const previous = canvas.style.cursor
		canvas.style.cursor = 'none'

		return () => {
			canvas.style.cursor = previous
		}
	}, [canvasRef, shown])

	/*
	 * The magnifier is a finger's, in the two modes that have one, and it is asked of the
	 * *pointer* rather than of the device. `isTouch` answers for the whole machine — a
	 * tablet with a keyboard and a trackpad is a touch device all day, including while
	 * somebody is using the trackpad — and what matters here is what is on the glass right
	 * now. A mouse gets the ring and nothing else.
	 */
	const magnifying =
		marks(tool) && cursor?.touching && cursor.surface === 'book' && (mode === 'v1' || mode === 'v3')

	// The frame loop below reads this rather than closing over `cursor`, so a moving
	// pointer doesn't restart the loop sixty times a second.
	const cursorRef = useRef(cursor)
	cursorRef.current = cursor

	const ink = inkWidth(tool)

	// Redrawn every frame rather than on every move: the magnifier is showing a stroke
	// being drawn, and most of what changes inside it between two pointer events is the
	// line arriving, not the pointer moving.
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

	if (!shown || !cursor || cursor.surface !== 'book') return null

	return (
		<>
			<DrawnCursor at={cursor} tool={tool} />

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
					style={mode === 'v3' ? intoCorner(cursor) : liftAbove(cursor)}
				/>
			) : null}
		</>
	)
}

/**
 * The cursor itself: a ring for the two tools that mark, a shape for the one that grabs.
 *
 * Shared by the two surfaces that have a pointer on them — the paper, and v11's magnified
 * stage — because a tool that drew itself differently depending on which canvas it was
 * over would be a tool you had to learn twice. What differs between the two is only
 * `span`: the ring is stated in project units and drawn as a fraction of the box it is
 * in, so a box showing 160 units of a 640-unit page draws the same stroke four times the
 * size, which is exactly what the zoomed drawing does with it.
 *
 * The default is a page's *width*, and both page shapes are 640 across — which is why
 * `SQUARE_PAGE_SIZE` is 640×640 rather than 360×360. A page of some third width would
 * have to pass `span` rather than take this.
 */
export function DrawnCursor({
	at,
	tool,
	span = DEFAULT_PAGE_SIZE.width,
}: {
	at: Cursor
	tool: ModalToolId | null
	span?: number
}) {
	/*
	 * The standing cursor is also a state: light grey while a gesture is only aiming,
	 * black the moment the tool starts working. That is the whole feedback for a
	 * changeover you can't otherwise see — half a second of stillness, a second finger
	 * somewhere else on the page, or a tool button held by the other hand, none of which
	 * is something you are looking at.
	 *
	 * Only the modes that have one. Everywhere else a cursor means the same thing whether
	 * the pointer is down or not, and one that changed colour under a resting mouse or a
	 * drawing finger would be saying something it doesn't mean.
	 */
	const state = at.standing ? (at.marking ? styles.inking : styles.waiting) : ''

	if (tool === 'transform') {
		return (
			<TransformCursor
				at={at}
				affordance={at.affordance}
				className={state ? `${styles.grip} ${state}` : styles.grip}
			/>
		)
	}

	return (
		<span
			className={state ? `${styles.ring} ${state}` : styles.ring}
			aria-hidden="true"
			style={
				{
					left: at.inkX,
					top: at.inkY,
					'--ink': inkWidth(tool),
					'--span': span,
				} as React.CSSProperties
			}
		/>
	)
}

/**
 * What the tool is about to put down, in project units — 640 of them across the page.
 *
 * The pencil is one width now, so what this still says is which of the two marking tools
 * is in hand: an eraser's bite is 20 units against a stroke's 3, and the ring changing
 * size is the clearest statement either makes about itself.
 */
function inkWidth(tool: ModalToolId | null): number {
	return tool === 'eraser' ? ERASE_TOLERANCE * 2 : DEFAULT_PENCIL_WIDTH
}

/** The pencil and the eraser mark the page; the transform tool moves what is on it. */
function marks(tool: ModalToolId | null): boolean {
	return tool === 'pencil' || tool === 'eraser'
}

/**
 * The transform tool's cursor: four shapes, one per thing a drag would do.
 *
 * A mouse has had this since 2013 — `Selection.updateTransformType` wrote `move`,
 * `alias`, `nwse-resize` and the rest onto the canvas as the pointer crossed the box,
 * and it is most of how the tool explains itself. On a phone none of it existed, because
 * there was no cursor to name one on and because once the cursor stopped being the
 * fingertip the native ones would have been describing the wrong point. These are the
 * same four statements, drawn where the cursor actually is — and now that they exist
 * they are what the mouse gets too, so the tool says the same thing on both.
 *
 * Inline SVG rather than the 2013 sprite, and that is a deliberate exception to "icons
 * come from the sheet": the sheet is drawings of *things* at fixed sizes, and these are
 * neither things nor fixed — the scale arrows have to point along whichever axis the
 * handle moves, which is a rotation applied per frame. Everything is `currentColor`, so
 * the same two classes that grey and blacken the ring drive these.
 */
function TransformCursor({
	at,
	affordance,
	className,
}: {
	at: Cursor
	affordance: Cursor['affordance']
	className: string | undefined
}) {
	// Nothing under the cursor: the crosshair, which says where a press would land
	// without promising it would grab anything.
	if (affordance.kind === 'none') {
		return (
			<svg
				className={className}
				style={{ left: at.inkX, top: at.inkY }}
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
			</svg>
		)
	}

	return (
		<svg
			className={className}
			style={{
				left: at.inkX,
				top: at.inkY,
				// The rotation has to come *after* the centring translate, or the box is
				// swung about its own top-left corner and the cursor orbits the point it is
				// meant to be standing on.
				transform: `translate(-50%, -50%) rotate(${affordance.angle}deg)`,
			}}
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			{affordance.kind === 'move' ? (
				<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
			) : null}

			{affordance.kind === 'scale' ? (
				<path d="M3 12h18M3 12l4-3.5M3 12l4 3.5M21 12l-4-3.5M21 12l-4 3.5" />
			) : null}

			{/* Not rotated with anything: a ring reads the same at every angle, and the
			    only honest thing to point it at would be the selection's centre — which is
			    where it already is. */}
			{affordance.kind === 'rotate' ? (
				<path d="M12 4.5A7.5 7.5 0 1 0 19.5 12M19.5 12l-3-2.5M19.5 12l3-2.5" />
			) : null}
		</svg>
	)
}

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
 * Centred on where the *ink* lands rather than on the fingertip. In most modes those
 * are the same point; in v4 and v5 they are not, and what is worth magnifying is the
 * end of the line, not the finger dragging it.
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
	//
	// A page's width, and every page shape is 640 across — see the note on `span` above.
	const radius = ((ink * at.size) / DEFAULT_PAGE_SIZE.width / 2) * ZOOM
	context.beginPath()
	context.arc(LOUPE / 2, LOUPE / 2, Math.max(radius, 3), 0, Math.PI * 2)
	context.strokeStyle = PENCIL_COLOR
	context.globalAlpha = 0.5
	context.lineWidth = 1
	context.stroke()
	context.globalAlpha = 1
}

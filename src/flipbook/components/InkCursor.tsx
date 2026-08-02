import { useEffect, useRef, useState } from 'react'

import { CANVAS_WIDTH, PENCIL_COLOR } from '../engine/constants'
import { ERASE_TOLERANCE } from '../engine/tools/eraser'
import type { ModalToolId } from '../engine/tools/types'
import styles from './InkCursor.module.css'

export interface InkCursorProps {
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Null on the playback page, and while a page animation holds the tools. */
	tool: ModalToolId | null
	/** What the pencil is set to, in project units. */
	pencilWidth: number
}

/**
 * What the pointer looks like over the drawing: a ring the size of the mark it is
 * about to make, and — on a finger — a loupe showing what is underneath it.
 *
 * The ring replaces the arrow outright. A pencil whose cursor is an arrow tells you
 * where the line will start and nothing about what it will be, and the width control
 * is a popover on a different part of the screen that isn't shown on a phone at all.
 * A circle the width of the stroke says it where you are looking.
 *
 * The loupe is the phone's, and it is there for one reason: a finger is opaque. On a
 * desktop the pointer is a few pixels of arrow over a drawing you can see all of;
 * with a finger the thing you are aiming at is under the thing you are aiming with,
 * and joining up to a line you drew a moment ago is guesswork. So while the finger is
 * down, the drawing under it is repeated above it at twice the size — with the ring
 * in the middle, magnified with everything else, because the ring is the aim.
 *
 * Both are drawn from the live canvas rather than from the scene, so what they show
 * is exactly what is on the paper: the stroke in progress, the onion skin, the
 * selection, all of it. Nothing here knows anything about paper.js.
 */
export function InkCursor({ canvasRef, tool, pencilWidth }: InkCursorProps) {
	const loupe = useRef<HTMLCanvasElement | null>(null)
	const [at, setAt] = useState<Point | null>(null)
	/** What is holding the canvas down, if anything. `touch` is what brings the loupe. */
	const [holding, setHolding] = useState<string | null>(null)

	// The pencil and the eraser mark the page; the transform tool moves what is
	// already on it, and has a set of cursors of its own that say which handle you are
	// over. A ring there would be describing a stroke nobody is about to draw.
	const marking = tool === 'pencil' || tool === 'eraser'

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || !marking) return

		/*
		 * Whether the pointer is over the drawing, and whether it is down.
		 *
		 * Refs rather than the state below, because leaving and releasing have to know
		 * about each other and both are decided inside the handler that fires. A drag
		 * that runs off the edge of the canvas is still a stroke, so the ring goes with
		 * it; the ring only stops being drawn when the pointer is neither on the paper
		 * nor holding it. Without the second half a stroke released outside left a ring
		 * standing on the drawing with no pointer anywhere near it.
		 */
		let over = false
		let held = false

		const track = (event: PointerEvent) => {
			const box = canvas.getBoundingClientRect()
			setAt({
				x: event.clientX - box.left,
				y: event.clientY - box.top,
				size: box.width,
				top: box.top,
			})
		}

		const enter = (event: PointerEvent) => {
			over = true
			track(event)
		}

		const down = (event: PointerEvent) => {
			held = true
			track(event)
			setHolding(event.pointerType)
		}

		const up = () => {
			held = false
			setHolding(null)
			if (!over) setAt(null)
		}

		const leave = () => {
			over = false
			if (!held) setAt(null)
		}

		canvas.addEventListener('pointerdown', down)
		canvas.addEventListener('pointermove', track)
		canvas.addEventListener('pointerenter', enter)
		canvas.addEventListener('pointerleave', leave)
		// On the document, because a stroke can be released anywhere — the same reason
		// the engine listens for mouseup there rather than on the canvas.
		document.addEventListener('pointerup', up)
		document.addEventListener('pointercancel', up)

		// The ring *is* the cursor, so the arrow goes. Written on the element rather
		// than set in the stylesheet because the transform tool writes its own cursors
		// there too, and an inline style is the only thing that can be sure of beating
		// one.
		const previous = canvas.style.cursor
		canvas.style.cursor = 'none'

		return () => {
			canvas.removeEventListener('pointerdown', down)
			canvas.removeEventListener('pointermove', track)
			canvas.removeEventListener('pointerenter', enter)
			canvas.removeEventListener('pointerleave', leave)
			document.removeEventListener('pointerup', up)
			document.removeEventListener('pointercancel', up)

			canvas.style.cursor = previous
			setAt(null)
			setHolding(null)
		}
	}, [canvasRef, marking])

	/** What the tool is about to put down, in project units — 640 of them across. */
	const ink = tool === 'eraser' ? ERASE_TOLERANCE * 2 : pencilWidth

	/*
	 * The loupe is a finger's, and it is asked of the *pointer* rather than of the
	 * device. `isTouch` answers for the whole machine — a tablet with a keyboard and a
	 * trackpad is a touch device all day, including while somebody is using the
	 * trackpad — and what matters here is what is on the glass right now. A mouse gets
	 * the ring and no loupe; a finger gets both.
	 */
	const magnifying = holding === 'touch' && at !== null

	// The frame loop below reads this rather than closing over `at`, so a moving
	// pointer doesn't restart the loop sixty times a second.
	const atRef = useRef(at)
	atRef.current = at

	// Redrawn every frame rather than on every move: the loupe is showing a stroke
	// being drawn, and most of what changes inside it between two pointer events is
	// the line arriving, not the pointer moving.
	useEffect(() => {
		if (!magnifying) return

		let frame = 0
		const draw = () => {
			paint(loupe.current, canvasRef.current, atRef.current, ink)
			frame = requestAnimationFrame(draw)
		}
		draw()

		return () => cancelAnimationFrame(frame)
	}, [magnifying, canvasRef, ink])

	if (!marking || !at) return null

	return (
		<>
			<span
				className={styles.ring}
				aria-hidden="true"
				style={{ left: at.x, top: at.y, '--ink': ink } as React.CSSProperties}
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
					style={liftAbove(at)}
				/>
			) : null}
		</>
	)
}

interface Point {
	/** Where the pointer is, in CSS pixels from the top left of the canvas. */
	x: number
	y: number
	/** How wide the canvas is being shown, which is what maps those onto the artwork. */
	size: number
	/** And how far down the window it starts, which is what stops the loupe leaving it. */
	top: number
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
function liftAbove(at: Point): React.CSSProperties {
	return {
		left: Math.min(Math.max(at.x, LOUPE / 2), at.size - LOUPE / 2),
		// `at.top` is the paper's own distance from the top of the window, and this box
		// is positioned against the paper — so the floor has to be expressed in the
		// paper's coordinates, which is what subtracting it does.
		top: Math.max(at.y - LIFT, LOUPE / 2 - at.top + 4),
	}
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
 */
function paint(
	loupe: HTMLCanvasElement | null,
	source: HTMLCanvasElement | null,
	at: Point | null,
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
		at.x * density - window_ / 2,
		at.y * density - window_ / 2,
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

import { useEffect, useState, useSyncExternalStore } from 'react'

import type { FlipbookEngine } from '../engine/FlipbookEngine'
import { ERASE_TOLERANCE } from '../engine/tools/eraser'
import { DEFAULT_PENCIL_WIDTH } from '../engine/tools/pencil'
import type { ModalToolId } from '../engine/tools/types'
import { type Cursor, PointerLayer } from '../pointer'
import styles from './InkCursor.module.css'

export interface InkCursorProps {
	engine: FlipbookEngine | null
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Null while a page animation holds the tools. */
	tool: ModalToolId | null
	/**
	 * Everywhere a finger may aim from — the page, less the controls on it.
	 *
	 * The cursor is nudged rather than placed, so it doesn't care where the nudge comes
	 * from, and the empty band under the drawing on a phone is where a thumb already is.
	 * See `PointerLayer`. Defaults to the drawing itself.
	 */
	fieldRef?: React.RefObject<HTMLElement | null>
}

/**
 * What the pointer looks like over the drawing, on both layouts and every input.
 *
 * Two shapes, one per kind of tool. The pencil and the eraser get a **ring** the
 * diameter of the mark about to be made, which replaces the arrow outright: a pencil
 * whose cursor is an arrow tells you where the line will start and nothing about what it
 * will be. The transform tool gets one of **four drawn shapes** saying what a drag from
 * here would grab — see `TransformCursor`, and note that it is drawn for a mouse as well
 * as for a finger, which is new: a mouse has had the native `move`/`nwse-resize` set
 * since 2013, and these say the same four things in the site's own hand and at the point
 * the tool is actually working from.
 *
 * Nothing here reads the scene, and nothing here knows about paper.js. Where the pointer
 * is and what it is doing arrives as the `Cursor` this subscribes to; the other half of
 * that — a finger nudging a standing cursor rather than placing one — is `pointer.ts`.
 */
export function InkCursor({ engine, canvasRef, tool, fieldRef }: InkCursorProps) {
	const [layer, setLayer] = useState<PointerLayer | null>(null)

	// The pencil and the eraser mark the page; the transform tool moves what is already
	// on it. A ring there would be describing a stroke nobody is about to draw.
	const marking = tool === 'pencil' || tool === 'eraser'
	const aiming = tool === 'transform'
	const shown = marking || aiming

	/*
	 * One layer for the life of the page, not one per tool. Rebuilding it to change a
	 * setting would drop whatever gesture was in flight and put the standing cursor back
	 * in the middle of the page.
	 */
	useEffect(() => {
		const canvas = canvasRef.current
		// `.book`, which wraps the canvas. The listeners have to be on an ancestor to be
		// sure of running before paper's own — at the target element, capture and bubble
		// listeners are called in the order they were added, so registering on the canvas
		// itself would be a race against whichever ran first.
		const book = canvas?.parentElement
		if (!engine || !canvas || !book) return

		const created = new PointerLayer(fieldRef?.current ?? book, book, canvas, engine)
		setLayer(created)

		return () => {
			created.destroy()
			setLayer(null)
		}
	}, [engine, canvasRef, fieldRef])

	// Picking a tool up changes what the cursor is, and on a desktop that is a button
	// press rather than a pointer moving — so nothing would republish until it did.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tool` is the trigger rather than a value the effect reads; that is the whole point of it.
	useEffect(() => {
		layer?.refresh()
	}, [layer, tool])

	const cursor = useSyncExternalStore(
		layer ? layer.subscribe : NO_SUBSCRIBE,
		() => layer?.snapshot ?? null,
		() => null,
	)

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

	if (!shown || !cursor) return null

	/*
	 * The standing cursor is also a state: light grey while a gesture is only aiming,
	 * black the moment the tool starts working. That is the whole feedback for a
	 * changeover you can't otherwise see — a second finger somewhere else on the page, or
	 * a tool button held by the other hand, is not something you are looking at.
	 *
	 * A mouse gets neither. There a ring means the same thing whether the button is down
	 * or not, and one that changed colour under your own hand would be saying something
	 * it doesn't mean.
	 */
	const state = cursor.standing ? (cursor.marking ? styles.inking : styles.waiting) : ''

	if (aiming) {
		return (
			<TransformCursor
				at={cursor}
				affordance={cursor.affordance}
				className={state ? `${styles.grip} ${state}` : styles.grip}
			/>
		)
	}

	/**
	 * What the tool is about to put down, in project units — 640 of them across.
	 *
	 * The pencil is one width now, so what this still says is which of the two marking
	 * tools is in hand: an eraser's bite is 20 units against a stroke's 3, and the ring
	 * changing size is the clearest statement either makes about itself.
	 */
	const ink = tool === 'eraser' ? ERASE_TOLERANCE * 2 : DEFAULT_PENCIL_WIDTH

	return (
		<span
			className={state ? `${styles.ring} ${state}` : styles.ring}
			aria-hidden="true"
			style={{ left: cursor.x, top: cursor.y, '--ink': ink } as React.CSSProperties}
		/>
	)
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
				style={{ left: at.x, top: at.y }}
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
				left: at.x,
				top: at.y,
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

const NO_SUBSCRIBE = () => () => {}

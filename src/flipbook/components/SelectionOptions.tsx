import { useEffect, useRef, useState } from 'react'

import type { PageSize } from '../engine/constants'
import type { SelectionBox } from '../engine/FlipbookEngine'
import type { PageZoom } from '../zoomStage'
import styles from './SelectionOptions.module.css'

export interface SelectionOptionsProps {
	/** Where the selection is, in project units. Null when nothing is held. */
	selection: SelectionBox | null
	/** The page's own shape, which is what those units are a fraction of. */
	page: PageSize
	/**
	 * Where a pinch has left the sheet, which on a phone is where the drawing actually is.
	 *
	 * v13 — the mode the tool ships with — draws the page into a stage standing exactly
	 * where the canvas is, and a pinch scales and slides *that* rather than the frame
	 * round it. So the paper can be four times the size of the box this is positioned
	 * against and half of it off the left of the window, while `.book` has not moved a
	 * pixel. Resting on every other layout, which is why the arithmetic below is the
	 * identity everywhere but there. See `ZoomStage` and `pinched`.
	 */
	sheet: PageZoom
	onCopy: () => void
	onDelete: () => void
}

/** The size of one disc, and the air between the two. Handed to the stylesheet below. */
const DISC = 32
const GAP = 4

/** How far the row stands clear of the selection, on whichever side it ends up. */
const CLEARANCE = 10

/**
 * The two discs that float over a selection: copy it, or throw it away.
 *
 * What they are for is that neither action was anywhere near the thing it acts on.
 * Copy is a disc in the footer bar on a phone and *nothing at all* on a desktop, where
 * the row beside the wordmark went to give a square page its window back and ⌘C is the
 * whole of what replaced it; delete has only ever been the Delete key, which is to say
 * it has never existed on a phone. So the one layout with a button had it in the far
 * corner of the screen, and the one with a keyboard had no button anywhere. Standing
 * both of them on the selection answers both at once, and it is where the hand already
 * is — a selection is something you have just dragged a marquee round.
 *
 * **Only while the selection is still.** The box comes down at `handlePointerDown` and
 * is published again when the gesture ends, so there is nothing hanging over the drawing
 * while you move, scale or rotate it, and nothing chasing a marquee across the page. It
 * reappears where the strokes came to rest. That is a property of what the engine
 * publishes rather than anything this decides — see `FlipbookState.selection`.
 *
 * They are `<button>`s, which is what keeps them pressable: `PointerLayer` stands down
 * on anything matching `CONTROLS`, so a tap here is a tap rather than the start of a
 * marquee. See the note on `CONTROLS` in `pointer.ts`.
 */
export function SelectionOptions({
	selection,
	page,
	sheet,
	onCopy,
	onDelete,
}: SelectionOptionsProps) {
	const field = useRef<HTMLDivElement | null>(null)
	const paper = usePaperSize(field)
	const at = selection && paper.width > 0 ? place(selection, page, paper, sheet) : null

	return (
		<div
			ref={field}
			className={styles.field}
			style={{ '--disc': `${DISC}px`, '--gap': `${GAP}px` } as React.CSSProperties}
		>
			{at ? (
				<div className={styles.row} style={at}>
					<Disc label="Copy" glyph="↥" hint="Copy (⌘C)" onPress={onCopy} />
					<Disc
						label="Delete"
						glyph="✕"
						hint="Delete (⌫)"
						className={styles.remove}
						onPress={onDelete}
					/>
				</div>
			) : null}
		</div>
	)
}

/**
 * One of the two: a white disc wearing a Pecita glyph, the footer's discs a size down.
 *
 * Deliberately the same object as undo, redo, copy and paste rather than something new
 * — these are controls lying on the page, and every one of those on this site is a white
 * disc with the paper's shadow. ↥ is *copy's own glyph*, the one the footer already uses,
 * so the two buttons are visibly the same button in two places rather than two ways of
 * asking for the same thing. ✕ is the one addition, and it is the only mark in the face
 * that means "not this" without being a drawing of a bin — which the icon sheet does
 * have, and which is already spoken for by Delete *page* in the tray two inches below.
 * Two identical bins meaning different things is the one thing this must not be.
 */
function Disc({
	label,
	glyph,
	hint,
	className,
	onPress,
}: {
	label: string
	glyph: string
	hint: string
	className?: string
	onPress: () => void
}) {
	return (
		<button
			type="button"
			className={className ? `${styles.disc} ${className}` : styles.disc}
			title={hint}
			onClick={onPress}
		>
			<span className={styles.glyph} aria-hidden="true">
				{glyph}
			</span>
			<span className="visuallyHidden">{label}</span>
		</button>
	)
}

/** How big the drawing is being shown, in CSS pixels. */
export interface PaperSize {
	width: number
	height: number
}

/**
 * Where the row goes, in the paper's own pixels — and null when there is nowhere to put it.
 *
 * The selection arrives in project units, of which the page has 640 across however wide it
 * is being shown, so the first two lines are the only conversion this component does. The
 * sheet's own zoom goes on top of that: `ZoomStage` writes
 * `translate3d(x, y) scale(s)` with the frame's top left as the origin, so a point on the
 * paper is at `offset + unit × scale` in the box this row is positioned in. Resting
 * everywhere but a pinched phone, where it is the difference between a control on the
 * drawing and a control an inch away from it.
 *
 * Above the selection, and below it when there is no room above — which is the one piece
 * of arithmetic here that needs the paper measured rather than stated as a percentage.
 * "Room" is a number of pixels and the selection's top is a fraction of the page, and
 * comparing the two means knowing what the page is being shown at. Everything else could
 * have been CSS.
 *
 * The third case is both: a selection tall enough to leave no room on either side of it,
 * which is anything drawn edge to edge or anything on a sheet pinched past the frame.
 * There the row goes flush with the top of the frame and lies over the drawing, because
 * the alternative is a control hanging off the paper — over the page handle above it, or
 * the page bar below — and a button standing on somebody else's button is worse than one
 * standing on a drawing it is about to copy.
 *
 * And nothing at all once the selection has been pinched off the frame entirely: two
 * buttons clamped to an edge, pointing at something nobody can see, are two buttons about
 * nothing. Pinching it back brings them with it.
 *
 * Exported for its test, which is the whole of what is worth testing here: three cases,
 * a clamp and a transform, none of which needs a rendered button to be wrong.
 */
export function place(
	selection: SelectionBox,
	page: PageSize,
	paper: PaperSize,
	sheet: PageZoom,
): React.CSSProperties | null {
	const scaleX = (paper.width / page.width) * sheet.scale
	const scaleY = (paper.height / page.height) * sheet.scale

	const left = sheet.x + selection.x * scaleX
	const right = left + selection.width * scaleX
	const top = sheet.y + selection.y * scaleY
	const bottom = top + selection.height * scaleY

	if (right <= 0 || left >= paper.width || bottom <= 0 || top >= paper.height) return null

	const above = top - CLEARANCE - DISC
	const below = bottom + CLEARANCE

	// Kept on the paper sideways, and only the row moves: what it is *about* is the
	// selection, which is still where it was. A row half off the edge of a phone is two
	// buttons of which one is pressable.
	const half = DISC + GAP / 2

	return {
		left: Math.min(Math.max((left + right) / 2, half), Math.max(paper.width - half, half)),
		top: above >= 0 ? above : below + DISC <= paper.height ? below : 0,
	}
}

/**
 * How big the drawing is being shown, watched rather than read once.
 *
 * The paper is sized off the window by `--book-width` and reshaped by a remix's artwork
 * landing, so this is not a number anybody can be told up front. Most of what `place`
 * does with it could have been said as a percentage of `.book` and left to CSS; the one
 * thing that could not is *which side of the selection the row goes on*, which compares
 * a length in pixels with a fraction of the page and so has to know what the page is
 * being shown at.
 *
 * Nothing is placed until it has answered, which is the whole of what the zero here
 * means: a row positioned against a paper 0px wide is both buttons in the corner of the
 * drawing for a frame. It costs nothing to wait — this is mounted for as long as the
 * transform tool is in hand, and a selection takes a gesture to make.
 */
function usePaperSize(field: React.RefObject<HTMLDivElement | null>): PaperSize {
	const [size, setSize] = useState<PaperSize>({ width: 0, height: 0 })

	useEffect(() => {
		const element = field.current
		if (!element || typeof ResizeObserver === 'undefined') return

		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return
			const box = entry.contentRect
			// Guarded, or a resize that changes nothing is a render that causes one.
			setSize((previous) =>
				previous.width === box.width && previous.height === box.height
					? previous
					: { width: box.width, height: box.height },
			)
		})
		observer.observe(element)

		return () => observer.disconnect()
	}, [field])

	return size
}

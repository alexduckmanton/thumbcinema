import { useEffect, useRef } from 'react'

import { TAP_SLOP, TAP_TIME } from '../pointer'
import type { PageSize } from '../engine/constants'
import { fittedSize, type Placement, type TracePhoto } from '../engine/trace'
import { type Point, dragged, pinched } from './geometry'
import styles from './TraceLayer.module.css'

export interface TraceLayerProps {
	photo: TracePhoto
	/** The shape of the paper the photo is lying on, which is what it is fitted into. */
	page: PageSize
	/** True while it is still in hand: dashed, stronger, and following the fingers. */
	placing: boolean
	/** Where it ended up. Called at the end of a gesture, never during one. */
	onPlaced: (placement: Placement) => void
	/** A tap that went nowhere: the photo is where it should be. */
	onAccept: () => void
}

/**
 * The photograph laid over the drawing, and — while it is being placed — the hand that
 * moves it.
 *
 * It is a pair of DOM layers rather than anything in the paper.js scene, and that is the
 * single most load-bearing decision in the feature. A `Raster` in the project would be a
 * fourth thing under `SYSTEM_LAYERS`, would be written into `exportSVG()` and so into
 * every saved flipbook, would be photographed by `exportForSave` into the saved
 * and by `exportForSave` into the cover, and would have to be taught to the undo history.
 * A reference you trace over is none of those things: it is scaffolding, it belongs to
 * the session rather than to the drawing, and the artwork must come out byte-identical
 * whether or not one was ever on screen. Keeping it in the DOM makes all of that true by
 * construction rather than by remembering to exclude it in six places.
 *
 * What it costs is that the photo cannot be drawn *under* the ink in the ordinary way —
 * the canvas is opaque white. `mix-blend-mode: multiply` buys that back exactly; see the
 * stylesheet.
 *
 * Three things about the gesture:
 *
 *  - **Every event is measured from the press**, not from the last event: `base` is the
 *    placement when the current set of contacts landed, and `pinched`/`dragged` are
 *    absolute functions of it. A hundred incremental deltas a second accumulate rounding
 *    the way a single subtraction cannot, and a clamped scale would ratchet.
 *  - **The baseline is retaken whenever a finger lands or leaves**, which is what stops
 *    the photo jumping when a second finger arrives mid-drag or the first of two lifts.
 *  - **Nothing goes through React until the fingers come off.** The placement is written
 *    straight onto both layers as four custom properties — the same bargain the page
 *    reorder makes with `--drag`, and for the same reason: a pointer moves a hundred
 *    times a second, and re-rendering the page around it for each one is not a thing to
 *    do.
 */
export function TraceLayer({ photo, page, placing, onPlaced, onAccept }: TraceLayerProps) {
	const frame = useRef<HTMLDivElement | null>(null)
	const edit = useRef<HTMLDivElement | null>(null)
	const field = useRef<HTMLDivElement | null>(null)

	/** Where the photo is right now, which during a gesture React does not know. */
	const live = useRef<Placement>(photo.placement)

	// Anything that changes the placement from outside — a fresh photo, a page turn, the
	// commit at the end of a gesture — is the truth again.
	useEffect(() => {
		live.current = photo.placement
	}, [photo.placement])

	// Latest without rebinding: the listeners below are attached once per placing session
	// and must not be torn down and rebuilt around a live gesture.
	const handlers = useRef({ onPlaced, onAccept })
	handlers.current = { onPlaced, onAccept }

	useEffect(() => {
		const hit = field.current
		if (!placing || !hit) return

		/** Contacts on the glass, in pixels from the top left of the frame. */
		const contacts = new Map<number, Point>()

		/** The placement and the contact positions the current baseline was taken at. */
		let base = live.current
		let from: Point[] = []

		let openedAt = 0
		let travel = 0
		let everMultiple = false

		const write = (at: Placement) => {
			live.current = at
			for (const element of [frame.current, edit.current]) {
				if (!element) continue
				element.style.setProperty('--trace-x', `${at.x * 100}%`)
				element.style.setProperty('--trace-y', `${at.y * 100}%`)
				element.style.setProperty('--trace-rot', `${at.rotation}deg`)
				element.style.setProperty('--trace-scale', `${at.scale}`)
			}
		}

		const box = () => hit.getBoundingClientRect()

		/**
		 * Take the placement and the contacts as they stand as the new zero.
		 *
		 * Called on every landing and every lift. Without it, a second finger arriving
		 * would be measured against a pair that included where the first one *started*,
		 * and the photo would leap the length of the drag so far.
		 */
		const rebase = () => {
			base = live.current
			from = [...contacts.values()].map((point) => ({ ...point }))
		}

		const positions = (touches: TouchList, rect: DOMRect) => {
			for (const touch of Array.from(touches)) {
				contacts.set(touch.identifier, {
					x: touch.clientX - rect.left,
					y: touch.clientY - rect.top,
				})
			}
		}

		const onStart = (event: TouchEvent) => {
			event.preventDefault()
			// Nothing above this needs to hear about it, and paper.js listens on the canvas
			// directly — see the note on interception in `PointerLayer`.
			event.stopPropagation()

			if (contacts.size === 0) {
				openedAt = performance.now()
				travel = 0
				everMultiple = false
			}

			positions(event.changedTouches, box())
			if (contacts.size > 1) everMultiple = true
			rebase()
		}

		const onMove = (event: TouchEvent) => {
			if (contacts.size === 0) return
			event.preventDefault()
			event.stopPropagation()

			const rect = box()
			const size = { width: rect.width, height: rect.height }

			const [wasFirst] = [...contacts.values()]
			positions(event.changedTouches, rect)
			const now = [...contacts.values()]

			const [first, second] = now
			const [fromFirst, fromSecond] = from
			if (!first || !fromFirst) return

			if (wasFirst) travel += Math.hypot(first.x - wasFirst.x, first.y - wasFirst.y)

			if (second && fromSecond) {
				write(pinched(base, [fromFirst, fromSecond], [first, second], size))
				return
			}

			write(dragged(base, first.x - fromFirst.x, first.y - fromFirst.y, size))
		}

		const onEnd = (event: TouchEvent) => {
			if (contacts.size === 0) return
			event.stopPropagation()

			for (const touch of Array.from(event.changedTouches)) contacts.delete(touch.identifier)

			if (contacts.size > 0) {
				rebase()
				return
			}

			/*
			 * A tap on the sheet accepts the photo.
			 *
			 * Both halves of the test, and for the reason `PointerLayer` gives: Safari
			 * withholds a slow finger's first few pixels of movement, so a deliberate
			 * nudge can report no travel at all and is a tap by distance alone. It is
			 * never a tap by duration. A pinch is never a tap either, however still it
			 * ended — hence `everMultiple`.
			 */
			const quick = performance.now() - openedAt <= TAP_TIME
			if (!everMultiple && quick && travel <= TAP_SLOP) {
				handlers.current.onAccept()
				return
			}

			handlers.current.onPlaced(live.current)
		}

		/*
		 * The mouse, which this layout does not offer the button to reach — but a desktop
		 * window dragged narrower than 731px is the phone layout, and a photo that can be
		 * taken and then not moved is worse than one that cannot be taken. Move only: a
		 * pinch has no mouse equivalent, and inventing scroll-to-scale here would be a
		 * second gesture vocabulary for a case nobody is in on purpose.
		 */
		let mouse: { id: number; x: number; y: number } | null = null

		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === 'touch') return
			event.preventDefault()
			mouse = { id: event.pointerId, x: event.clientX, y: event.clientY }
			base = live.current
			travel = 0
			openedAt = performance.now()
			hit.setPointerCapture(event.pointerId)
		}

		const onPointerMove = (event: PointerEvent) => {
			if (!mouse || event.pointerId !== mouse.id) return
			const rect = box()
			const dx = event.clientX - mouse.x
			const dy = event.clientY - mouse.y
			travel = Math.hypot(dx, dy)
			write(dragged(base, dx, dy, { width: rect.width, height: rect.height }))
		}

		const onPointerUp = (event: PointerEvent) => {
			if (!mouse || event.pointerId !== mouse.id) return
			mouse = null

			const quick = performance.now() - openedAt <= TAP_TIME
			if (quick && travel <= TAP_SLOP) {
				handlers.current.onAccept()
				return
			}

			handlers.current.onPlaced(live.current)
		}

		// Native rather than React's, and non-passive: React's touch handlers are attached
		// at the root and a passive listener may not call `preventDefault()` — which is
		// what stops iOS treating a two-finger drag on the sheet as a page zoom.
		const options = { passive: false }
		hit.addEventListener('touchstart', onStart, options)
		hit.addEventListener('touchmove', onMove, options)
		hit.addEventListener('touchend', onEnd)
		hit.addEventListener('touchcancel', onEnd)
		hit.addEventListener('pointerdown', onPointerDown)
		hit.addEventListener('pointermove', onPointerMove)
		hit.addEventListener('pointerup', onPointerUp)
		hit.addEventListener('pointercancel', onPointerUp)

		return () => {
			hit.removeEventListener('touchstart', onStart)
			hit.removeEventListener('touchmove', onMove)
			hit.removeEventListener('touchend', onEnd)
			hit.removeEventListener('touchcancel', onEnd)
			hit.removeEventListener('pointerdown', onPointerDown)
			hit.removeEventListener('pointermove', onPointerMove)
			hit.removeEventListener('pointerup', onPointerUp)
			hit.removeEventListener('pointercancel', onPointerUp)

			// A layer that goes away mid-gesture keeps the placement it had reached: the
			// photo is where it was left, not where React last heard about.
			if (contacts.size > 0 || mouse) handlers.current.onPlaced(live.current)
		}
	}, [placing])

	const at = photo.placement
	const vars = {
		'--trace-x': `${at.x * 100}%`,
		'--trace-y': `${at.y * 100}%`,
		'--trace-rot': `${at.rotation}deg`,
		'--trace-scale': `${at.scale}`,
	} as React.CSSProperties

	// `object-fit: contain`, done in numbers so the dashed outline can be drawn at the
	// same two percentages — and so that v11's magnified stage can draw the same picture
	// at the same size from the same expression. See `fittedSize`.
	const fit = fittedSize(photo, page)
	const width = `${fit.width * 100}%`
	const height = `${fit.height * 100}%`

	return (
		<>
			<div
				ref={frame}
				className={placing ? `${styles.frame} ${styles.placing}` : styles.frame}
				style={vars}
				aria-hidden="true"
			>
				<div className={styles.plate}>
					<img className={styles.picture} src={photo.url} alt="" style={{ width, height }} />
				</div>
			</div>

			{placing ? (
				<div ref={edit} className={styles.edit} style={vars}>
					<div className={styles.plate} aria-hidden="true">
						{/* An SVG rather than a `border`, and `vector-effect` is the whole reason.
						    Everything under `.plate` is scaled with the picture, so a 2px dash
						    pinched to 8× is a rope — and dividing the width by the scale to
						    compensate lands on a sub-pixel border, which browsers are free to
						    round to nothing. That is the dashes coming and going as you pinch.
						    A non-scaling stroke is 2px on the glass at every scale, by
						    definition, and needs no arithmetic.

						    The stroke is centred on the path, so where the picture reaches the
						    edge of the sheet its outer half is clipped and the line reads 1px
						    rather than 2. That is deliberate rather than unfixed: an inset would
						    have to be stated in the picture's own units, which are scaled, so it
						    would be 1px at life size and 16px pinched to 8×. */}
						<svg
							className={styles.outline}
							style={{ width, height }}
							viewBox="0 0 100 100"
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							<rect x="0" y="0" width="100" height="100" vectorEffect="non-scaling-stroke" />
						</svg>
					</div>
					{/* `data-owns-touch` is what keeps the page's aiming layer off this
					    gesture; see `CONTROLS` in `pointer.ts`. */}
					<div ref={field} className={styles.field} data-owns-touch />
				</div>
			) : null}
		</>
	)
}

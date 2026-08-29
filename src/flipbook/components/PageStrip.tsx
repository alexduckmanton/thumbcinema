import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { PAGE_TRAVEL_MS, prefersReducedMotion } from '../engine/animations'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../engine/constants'
import type { FlipbookEngine } from '../engine/FlipbookEngine'
import type { PageState } from '../engine/pages'
import { type Reorder, SETTLE_MS } from '../engine/reorder'
import styles from './PageStrip.module.css'

export interface PageStripProps {
	engine: FlipbookEngine
	pages: PageState[]
	activePage: number
	playing: boolean
	/** The live canvas, which the strip aligns the active page underneath. */
	canvasRef: React.RefObject<HTMLCanvasElement | null>
	/** Where a page is being carried, if one is. See `usePageReorder`. */
	reorder?: Reorder | null
	/** How far page `index` stands from its own slot while that is going on. */
	shiftFor?: (index: number) => number
}

/** The curve the flipbook closes up round a dropped page on. Matches `.carrying`. */
const SETTLE_EASE = (t: number) => cubicBezier(0.2, 0.8, 0.3, 1, t)

/**
 * How much wheel a page costs, when the wheel is over the drawing rather than over the
 * strip.
 *
 * One notch of a mouse wheel, which reports 100px — so a notch is a page, which is the
 * whole of what this number is chosen for. A trackpad sends a stream of much smaller
 * deltas and spends them a page at a time as they add up, which is the same rate a hand
 * would expect of the strip beside it.
 *
 * It was half this to begin with, on the reasoning that a threshold you have to overshoot
 * reads as a control that ignored you once before answering. It does not: at 50 a single
 * notch of an ordinary mouse turned two pages, and a page turn nobody asked for is a
 * worse fault than a page turn that waits for the whole notch.
 */
const WHEEL_STEP = 100

/**
 * The class that takes the snapping off while this file is driving the scroll itself.
 *
 * A global name on the root element rather than a CSS-module class, which is what it was
 * and which did not work: `html.tool` sets the snapping and is (0,1,1), a bare module
 * class is (0,1,0), and the rule meant to switch it off lost to the rule that switched it
 * on — silently, and the only symptom was a 300ms ease arriving as a jump. It is declared
 * next to the rule it has to beat, in `base.css`, alongside the two root classes this page
 * already manages from JavaScript.
 */
const UNSNAPPED = 'unsnapped'

/**
 * The column of page thumbnails the drawing stands in, and the thing you scroll.
 *
 * The strip is a real scroll container: the pages are a column inside it, each one a
 * snap point, and the live canvas is pinned over the middle of it. Scrolling is
 * therefore the browser's — momentum, rubber-banding, the trackpad's whole feel — and
 * what this component does is the two ends of it. It sets the padding that lets the
 * first and last pages reach the middle, and it keeps the flipbook and the scroll
 * position agreeing about which page you are on: a scroll turns the page, and a page
 * turned any other way scrolls.
 *
 * **`scroll-snap-type: y mandatory` is what makes the drawing cut rather than slide.**
 * The canvas never moves; the column under it does, and the page it is showing changes
 * the moment a different slot is nearest the middle. That is the whole of "scroll
 * normally, and the frame snaps from one to the next".
 *
 * It was a row until this layout, laid out sideways and positioned by `left` off the
 * active page — the engine owned where it stood and nothing scrolled at all. What that
 * cost is written down here rather than lost: the row could be eased on exactly the
 * curve a page animation used, because moving it was a style change. A scroll container
 * has no such property, so the same movements are animated by hand in `scrollToPage`,
 * with the snapping switched off for as long as one is in flight so the browser and
 * this file are never both steering.
 *
 * Create only. The playback page never renders this, and never allocates the per-page
 * canvases: 640×360 of backing store each, which on a 200-page archive flipbook is tens
 * of megabytes for something nobody can see.
 */
export function PageStrip({
	engine,
	pages,
	activePage,
	playing,
	canvasRef,
	reorder = null,
	shiftFor,
}: PageStripProps) {
	const rail = useRef<HTMLDivElement | null>(null)
	const firstPage = useRef<HTMLDivElement | null>(null)
	const [metrics, setMetrics] = useState({
		offset: 0,
		left: 0,
		width: CANVAS_WIDTH,
		gutter: 0,
		view: 0,
	})
	const scale = useThumbnailScale(engine, pages.length)

	/*
	 * Five numbers, all read off what the browser actually laid out.
	 *
	 * `offset` and `left` are where the top-left corner of the live canvas sits relative
	 * to this scroller, and `width` is how wide the canvas is — the thumbnails are copies
	 * of the drawing and have to be exactly the size of it, in exactly the same place, to
	 * stand behind it. Both axes are measured now that the scroller is the whole window:
	 * it used to be the stage, which the drawing was centred in, so `margin: 0 auto` on a
	 * page put it in the right place for free. The window is not centred on the drawing —
	 * there is a rail down one side of it — so the horizontal offset has to be measured
	 * exactly as the vertical one always was.
	 *
	 * `gutter` is the page's own padding, taken from the stylesheet rather than agreed
	 * with it, so the gap between pages can differ by layout without this file knowing
	 * that layouts exist. `view` is the height of the scrollport, which is what the
	 * padding at the two ends is measured against.
	 */
	const measure = useCallback(() => {
		const canvas = canvasRef.current
		const page = firstPage.current
		if (!canvas || !page) return

		const gutter = Number.parseFloat(getComputedStyle(page).paddingTop) || 0
		// Viewport coordinates, and they are the right ones because the drawing is
		// `position: fixed`: where it is on the glass does not change as the column
		// scrolls under it, which is the whole reason those two numbers can be a layout
		// constant rather than something recomputed on every frame of a scroll.
		const paper = canvas.getBoundingClientRect()
		const next = {
			offset: paper.top,
			left: paper.left,
			width: canvas.offsetWidth,
			gutter,
			view: window.innerHeight,
		}

		// Only when something actually changed. This runs on every resize and on every
		// frame the canvas's own observer reports, and a `setState` with equal numbers
		// still re-renders a list that is one canvas per page.
		setMetrics((current) =>
			current.offset === next.offset &&
			current.left === next.left &&
			current.width === next.width &&
			current.gutter === next.gutter &&
			current.view === next.view
				? current
				: next,
		)
	}, [canvasRef])

	/*
	 * Both, because they answer different halves of it.
	 *
	 * The canvas changes size when the window does, but it also changes size when
	 * nothing fires a resize at all — `--book-width` is drawn off `100dvh`, and on a
	 * phone that moves as the browser's own chrome slides in and out. And the window
	 * changes the canvas's *position* without changing its size at all, which is every
	 * desktop window: the drawing stays 640 and the stage re-centres under it.
	 */
	useEffect(() => {
		measure()
		window.addEventListener('resize', measure)

		const canvas = canvasRef.current
		const observer =
			canvas && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
		observer?.observe(canvas as Element)

		return () => {
			window.removeEventListener('resize', measure)
			observer?.disconnect()
		}
	}, [measure, canvasRef])

	/** The height of one thumbnail, from the canvas's width and the flipbook's shape. */
	const pageHeight = (metrics.width * CANVAS_HEIGHT) / CANVAS_WIDTH

	/** One page to the next: the drawing's height plus a gutter above and below. */
	const step = pageHeight + metrics.gutter * 2

	/*
	 * What lets the first and last pages reach the middle.
	 *
	 * A snap container can only scroll between 0 and its overflow, so without air at the
	 * two ends page one can never reach the drawing — it would sit at the top of the window
	 * with the drawing somewhere below it. The top pad is where the canvas is, less the
	 * page's own gutter, which is exactly the arithmetic the row's `left` used to be: it
	 * makes `scrollTop === index * step` the position at which page `index` stands under
	 * the drawing, whether or not the drawing is anywhere near the middle of the window.
	 *
	 * The same number is handed to the scroller as `scroll-padding-top`, which is what
	 * makes those the *snap* positions too: `scroll-snap-align: start` puts a page's top
	 * edge on the snapport's, and the padding is where the snapport starts. Without it the
	 * browser snapped to its own idea of the middle and the thumbnails stood 55px out of
	 * line with the sheet on top of them.
	 */
	const padTop = Math.max(0, metrics.offset - metrics.gutter)
	const padBottom = Math.max(0, metrics.view - step - padTop)

	/*
	 * Where a snapped page's top edge lands, handed to the root element.
	 *
	 * The scroll container is the document, so `scroll-padding-top` has to be on `html` —
	 * and this is the one thing about the layout that a stylesheet cannot state, because it
	 * is where the drawing actually ended up. `html.tool` in `base.css` reads it. A layout
	 * effect rather than an effect: a snap offset applied after the browser has painted is
	 * one frame of the column standing in the wrong place.
	 */
	useLayoutEffect(() => {
		document.documentElement.style.setProperty('--page-snap', `${padTop}px`)
		return () => {
			document.documentElement.style.removeProperty('--page-snap')
		}
	}, [padTop])

	// The engine throws pages from one slot to the next and needs to know how far that
	// is. It can't be told at build time for the same reason it isn't measured there.
	useEffect(() => {
		engine.setPageStep(step)
	}, [engine, step])

	/*
	 * Which slot the column is lined up on, which is normally the page you are drawing on.
	 *
	 * While a page is being carried it is the gesture's, and it is what that gesture
	 * moves: it starts at the slot the page came out of, so the pages either side can
	 * step aside without the whole flipbook moving with them; it advances a page at a
	 * time while the page is held out to one side, which is the book running past it; and
	 * it arrives at the destination at the moment the page is let go — which, against the
	 * drawing sliding back to the middle of the stage by exactly the same distance, is
	 * the flipbook closing up round the page as one movement. See `usePageReorder`.
	 */
	const anchor = reorder ? reorder.anchor : activePage

	/*
	 * Everything a scroll or a wheel has to read, kept in a ref rather than closed over.
	 *
	 * The scroll handler is bound once and fires at whatever rate the compositor feels
	 * like; rebinding it on every page turn would mean adding and removing a listener
	 * several times a second while a flipbook is being scrubbed. So it reads the latest
	 * of everything from here, which is the same bargain the reorder gesture makes with
	 * its pointer.
	 */
	const latest = useRef({ engine, step, activePage, pages: pages.length, playing })
	latest.current = { engine, step, activePage, pages: pages.length, playing }

	/** True while this file is the one moving the scroller, so it doesn't answer itself. */
	const driving = useRef(false)
	const animation = useRef<number | null>(null)

	/**
	 * The page the *scroll* last reported, and the reason a finger on the flipbook is
	 * never fought for the scroll position.
	 *
	 * The two directions below are a loop, and closing it needs more than "is the scroller
	 * already there". A scroll crossing the halfway line between two slots turns the page;
	 * turning the page changes `anchor`; and the effect that answers `anchor` then found
	 * the scroller *mid-gesture*, several pixels short of the slot it had just named, and
	 * dutifully set `scrollTop` to close the gap. That is a hand's momentum being taken
	 * away at the exact moment it crosses each page — which is precisely the "sudden" a
	 * mandatory snap is not supposed to feel like, and it was there on every page of every
	 * flick.
	 *
	 * So a page change this file was *told about by the scroll* is remembered and not
	 * answered. Anything else still is: an arrow key, the wheel over the drawing, a page
	 * added or deleted, a reorder settling. Cleared the moment one of those drives the
	 * scroller, so the guard can never outlive the scroll that set it.
	 */
	const reported = useRef<number | null>(null)

	/**
	 * How long the flipbook was last time, and the whole of how a page added or deleted
	 * comes to be animated rather than cut.
	 *
	 * The engine used to say so — `busy` was true for the 750ms of a page animation, and
	 * the strip eased its own position for exactly that long. There are no page animations
	 * any more (`animations.ts` says why), so nothing is being kept in step with: what is
	 * left is one movement, of the one thing that moves, and the only question is whether
	 * this page change was a *page turn* or a change of shape. A turn is a cut, as it has
	 * always been. A page arriving or leaving moves every page after it, and easing the
	 * scroll to the new position is what carries them.
	 *
	 * The length is the signal because it is the fact: no other page change alters it, and
	 * an engine flag saying the same thing would be a second copy of it to keep true.
	 */
	const wasLength = useRef(pages.length)

	/**
	 * Puts page `index` under the drawing, over `duration` and on `easing`.
	 *
	 * Instant is the ordinary case and is not an animation at all: turning a page is a
	 * cut. What is animated is the two movements that are part of something else — a
	 * page being thrown into the next slot, and the flipbook closing up round a page
	 * that has been carried somewhere — both of which the column has to travel with,
	 * exactly as far and in exactly the same time, or the flipbook comes apart in the
	 * middle of them.
	 *
	 * Snapping is switched off for the length of it. A mandatory snap container resnaps
	 * after every scroll it is given, so an animation written a frame at a time would be
	 * fighting the browser for the same property forty times a second; with it off, this
	 * lands the scroller exactly on a snap point and hands it back.
	 */
	const scrollToPage = useCallback(
		(index: number, duration = 0, easing?: (t: number) => number) => {
			const root = document.documentElement

			if (animation.current !== null) cancelAnimationFrame(animation.current)
			animation.current = null

			const to = index * latest.current.step
			const from = window.scrollY
			if (Math.abs(to - from) < 1) return

			reported.current = null
			driving.current = true

			if (duration <= 0 || prefersReducedMotion()) {
				window.scrollTo(0, to)
				// One frame, so the scroll event this just produced is seen while the flag is
				// still up. Setting the position is synchronous but the event is not.
				requestAnimationFrame(() => {
					driving.current = false
				})
				return
			}

			root.classList.add(UNSNAPPED)
			const started = performance.now()

			const frame = (now: number) => {
				const t = Math.min(1, (now - started) / duration)
				window.scrollTo(0, from + (to - from) * (easing ? easing(t) : t))

				if (t < 1) {
					animation.current = requestAnimationFrame(frame)
					return
				}

				animation.current = null
				root.classList.remove(UNSNAPPED)
				requestAnimationFrame(() => {
					driving.current = false
				})
			}

			animation.current = requestAnimationFrame(frame)
		},
		[],
	)

	useEffect(() => {
		return () => {
			if (animation.current !== null) cancelAnimationFrame(animation.current)
		}
	}, [])

	/*
	 * The flipbook telling the scroller where it is — the other direction from the one
	 * below, and the reason both of them check before they act.
	 *
	 * An arrow key, the wheel over the drawing, playback stopping, a page added or deleted
	 * or carried somewhere else: all of them change `anchor`, and none of them has
	 * scrolled anything. What is *not* answered here is a page the scroll itself turned —
	 * see `reported`, which is the difference between a snap that feels like a snap and
	 * one that feels like the page being taken off you.
	 *
	 * The duration is which of the three movements this is. A run under a held page
	 * glides linearly for exactly as long as the gap until the next page — steps that
	 * take precisely as long as the interval between them join into one continuous glide
	 * — and the settle and the throw take the curves their own animations use.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `step` is read through `latest` inside `scrollToPage`, but a change of it moves every slot, so it has to re-run.
	useEffect(() => {
		if (playing) return

		// The page the scroll itself just named. Answering it would be this file setting
		// `scrollTop` in the middle of somebody's flick; see `reported`.
		if (reported.current === anchor) return

		const resized = pages.length !== wasLength.current
		wasLength.current = pages.length

		const duration = reorder?.settling
			? SETTLE_MS
			: (reorder?.slide ?? (resized ? PAGE_TRAVEL_MS : 0))
		const easing = reorder?.settling
			? SETTLE_EASE
			: reorder?.slide
				? undefined
				: resized
					? easeInOut
					: undefined

		scrollToPage(anchor, duration, easing)
	}, [anchor, step, pages.length, playing, reorder?.slide, reorder?.settling, scrollToPage])

	/*
	 * And the scroller telling the flipbook, which is the new half of this.
	 *
	 * Whichever slot is nearest the middle is the page being drawn on, and it changes
	 * the instant the scroll crosses the halfway line between two of them — so the
	 * drawing cuts from page to page while the column slides, rather than following it.
	 * `round` is the whole of that.
	 *
	 * Nothing here debounces or waits for the scroll to end. Waiting is what would make
	 * the canvas appear to come loose: it would go on showing the page you left while
	 * the column carried a different thumbnail under it.
	 */
	useEffect(() => {
		const onScroll = () => {
			if (driving.current) return

			const { engine: live, step: pitch, activePage: current, pages: count } = latest.current
			if (latest.current.playing || pitch <= 0 || count === 0) return

			const index = Math.max(0, Math.min(count - 1, Math.round(window.scrollY / pitch)))
			if (index === current) return

			// Named before the page turns, so the effect that answers `anchor` has it by the
			// time React gets there. This is the whole of what stops a scroll being answered
			// with a scroll.
			reported.current = index
			live.goToPage(index)
		}

		window.addEventListener('scroll', onScroll, { passive: true })
		return () => window.removeEventListener('scroll', onScroll)
	}, [])

	/*
	 * A wheel over the drawing itself, which the scroller never sees.
	 *
	 * The canvas is pinned over the middle of the column rather than inside it — it has
	 * to be, or it would scroll away with the pages — so it swallows every wheel event
	 * that lands on it, which is most of them: the drawing is the biggest thing on the
	 * page and the part a pointer is already over. Forwarded rather than ignored, and
	 * spent a page at a time: this is the one scroll surface where the browser isn't
	 * doing the snapping, so it does the snapping itself.
	 *
	 * The accumulator resets when the direction changes, so a flick back the other way
	 * costs a whole page rather than whatever was left over from the last one.
	 *
	 * Not passive — it has to be able to refuse the page a scroll, which on a page with
	 * nothing to scroll to is the rubber band and, on a trackpad, the browser's back
	 * gesture.
	 */
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		let carried = 0

		const onWheel = (event: WheelEvent) => {
			event.preventDefault()

			const {
				engine: live,
				step: pitch,
				activePage: current,
				pages: count,
				playing: running,
			} = latest.current
			if (running || pitch <= 0 || count < 2) return

			// Lines and pages, which a mouse in Firefox and a page-scrolling wheel report
			// instead of pixels. 16 is a line; a page is the scrollport.
			const delta =
				event.deltaMode === 1
					? event.deltaY * 16
					: event.deltaMode === 2
						? event.deltaY * window.innerHeight
						: event.deltaY

			if (delta === 0) return
			if (Math.sign(delta) !== Math.sign(carried)) carried = 0
			carried += delta

			const steps = Math.trunc(carried / WHEEL_STEP)
			if (steps === 0) return
			carried -= steps * WHEEL_STEP

			const index = Math.max(0, Math.min(count - 1, current + steps))
			if (index === current) return

			/*
			 * The page, not the scroll — and that is the whole of the fix this once got
			 * wrong. Scrolling the column directly does move the drawing, but it does it
			 * behind the effect that keeps the two agreeing: this file suppresses its own
			 * scroll handler while it is the one steering, so a wheel spent that way
			 * arrived at the right slot with the flipbook still on the page it started on.
			 * Turning the page instead puts the wheel on exactly the path the page bar and
			 * the arrow keys are already on, and the scroll follows from it.
			 */
			live.goToPage(index)
		}

		canvas.addEventListener('wheel', onWheel, { passive: false })
		return () => canvas.removeEventListener('wheel', onWheel)
	}, [canvasRef])

	return (
		<div
			className={[
				styles.strip,
				playing ? styles.playing : '',
				reorder ? styles.carrying : '',
				reorder?.slide ? styles.sliding : '',
			]
				.filter(Boolean)
				.join(' ')}
			aria-hidden="true"
		>
			<div
				className={styles.rail}
				ref={rail}
				style={
					{
						paddingTop: `${padTop}px`,
						paddingBottom: `${padBottom}px`,
						// The drawing's own left edge, because the scroller is the window and the
						// window is not centred on the drawing. See `measure`.
						paddingLeft: `${metrics.left}px`,
						// Only ever set while a page is in hand, which is what keeps the frame
						// that hands the flipbook back from animating: the class and the
						// transforms go in the same render, and a rule that isn't there can't
						// ease a transform away to nothing. Turning a page is still a cut.
						'--settle': `${SETTLE_MS}ms`,
						// How long one page of the run takes, which is also how long until the
						// next one starts. See `.sliding`.
						'--slide': `${reorder?.slide ?? 0}ms`,
						// How wide a page is drawn. The stylesheet adds its own gutters to it
						// and this file reads those back, so neither has to state the other's
						// number. See `measure`.
						'--page-width': `${metrics.width}px`,
					} as React.CSSProperties
				}
			>
				{pages.map((page, index) => (
					// The whole strip is `aria-hidden`: these are decorative copies of the
					// canvas rather than controls. Clicking one is a pointer shortcut for the
					// arrow keys, which are the keyboard route and are bound on the document.
					// A tab stop per page would be noise rather than access.
					// biome-ignore lint/a11y/noStaticElementInteractions: decorative, aria-hidden.
					// biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys are the keyboard route.
					<div
						key={page.id}
						ref={index === 0 ? firstPage : null}
						className={styles.page}
						// How far out of its own slot this page has to stand to leave room for
						// the one being carried. Zero, and unset, the rest of the time.
						style={{ '--shift': `${shiftFor?.(index) ?? 0}px` } as React.CSSProperties}
						onClick={() => engine.goToPage(index)}
					>
						{/* Sized here rather than by the engine: assigning `width` clears a
						    canvas, so the size has to be something React owns and writes only
						    when it has actually changed. See `useThumbnailScale` for the two
						    values it takes and what has to happen when it goes from one to the
						    other. */}
						<canvas
							width={Math.round(CANVAS_WIDTH * scale)}
							height={Math.round(CANVAS_HEIGHT * scale)}
							ref={(element) => engine.registerThumbnail(page.id, element)}
						/>
					</div>
				))}
			</div>
		</div>
	)
}

/** `ease-in-out`, as a number, so a hand-run animation can share the keyframes' curve. */
function easeInOut(t: number): number {
	return cubicBezier(0.42, 0, 0.58, 1, t)
}

/**
 * A CSS timing function's output for an input, by bisection.
 *
 * The two movements this file animates by hand are halves of movements the stylesheets
 * animate with a `transition`, and they only read as one thing while both are on the
 * same curve. Bisection rather than Newton because thirty iterations of it are nothing
 * against a frame and it cannot fail to converge; `x` is monotonic for the two curves
 * used here, both of which have their control points inside the unit square.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
	if (t <= 0) return 0
	if (t >= 1) return 1

	const curve = (a: number, b: number, u: number) => {
		const v = 1 - u
		return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u
	}

	let low = 0
	let high = 1
	let mid = t

	for (let i = 0; i < 30; i++) {
		mid = (low + high) / 2
		if (curve(x1, x2, mid) < t) low = mid
		else high = mid
	}

	return curve(y1, y2, mid)
}

/**
 * How many device pixels a thumbnail carries per project unit.
 *
 * The drawing canvas is 640×360 project units drawn into a backing store the device
 * pixel ratio times that — paper sizes it, and on a retina screen it is 1280×720. A
 * thumbnail is a copy of that canvas shown at exactly the same size, so a 640×360 one
 * holds a quarter of the pixels it is displayed with, and the pages either side of the
 * drawing came out visibly softer than the drawing between them. Which they must not
 * be: the strip is the same flipbook seen again, and a page animation hands the
 * canvas's own job to one of these for 750ms.
 *
 * Capped at 2, because there is nothing above it worth another doubling of the memory:
 * a third of a device pixel is not something anyone can see, and the screens that
 * report 3 are the phones, where a thumbnail is displayed at about half its width.
 *
 * Read once. paper reads the ratio once as well, when it sets the view up, so a window
 * dragged onto a different monitor changes neither.
 */
const THUMBNAIL_SCALE = Math.min(
	typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
	2,
)

/**
 * How long a flipbook may be before its thumbnails go back to 1:1 — 50 pages at 2×.
 *
 * A page is ~900 KB of backing store at 1× and four times that at 2×, and the strip
 * holds one per page whether or not it is anywhere near the screen. Two hundred pages
 * is what an archive flipbook can be, and opening one of those in the *drawing tool*
 * became possible the day Remix did: 184 MB of canvas, which is heavy and survivable,
 * against 737 MB, which is not. iOS in particular enforces a per-tab canvas budget by
 * blanking canvases, so overrunning it doesn't fail loudly — it takes the strip away.
 *
 * So the ceiling is the one the strip already lived under, as many bytes as two hundred
 * pages at 1:1, and what gives way is the scale. A flipbook long enough to reach it is
 * one whose neighbouring pages are a thumbnail's worth of information anyway.
 */
const HIDPI_PAGE_LIMIT = Math.floor(200 / (THUMBNAIL_SCALE * THUMBNAIL_SCALE))

/**
 * The scale to draw thumbnails at, dropped to 1:1 once the flipbook is too long for it.
 *
 * It never goes back up, and that is deliberate rather than lazy: a canvas loses its
 * bitmap the moment either dimension is assigned, so every change of scale costs a
 * redraw of every page in the strip. Deleting back down to 49 pages to buy sharpness on
 * pages nobody is looking at is not a trade worth making twice.
 *
 * Which is what the layout effect is for, and why it is a layout effect. Resizing a
 * canvas empties it, and the strip's canvases are resized *in place* — the elements
 * don't change, so their ref callbacks never run again and the mechanism every other
 * page in this file leans on (owe it, pay on mount) never fires. So the engine is asked
 * to draw them outright, in the commit that resized them and before the browser has
 * painted it: an ordinary effect would put a frame of blank paper on the screen first.
 */
function useThumbnailScale(engine: FlipbookEngine, pages: number): number {
	const [scale, setScale] = useState(THUMBNAIL_SCALE)

	useEffect(() => {
		if (scale === 1 || pages <= HIDPI_PAGE_LIMIT) return
		setScale(1)
	}, [pages, scale])

	// biome-ignore lint/correctness/useExhaustiveDependencies: `scale` is the trigger rather than a value read here — a change of it is a row of canvases that have just been emptied.
	useLayoutEffect(() => {
		engine.redrawThumbnails()
	}, [engine, scale])

	return scale
}

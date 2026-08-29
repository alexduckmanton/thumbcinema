/**
 * The page-strip animations, 2013's keyframes turned on their side.
 *
 * Adding a page throws the old thumbnail up the column and flings the new canvas in
 * from off screen; deleting one tumbles it away off the side of the window. The
 * movements are 2013's — the tool's whole character is that pages move like paper, and
 * every offset, overshoot and settle below is the number it always was. What changed
 * with the strip is which axis a page travels on: the throws that used to go left and
 * right now go up and down, and the two that were already vertical had to move out of
 * the way of them. See the note on `nudge` and on `deletePage`, which are those two.
 *
 * Two things this replaces:
 *
 *  - `jquery.do-a-flip.js`, which applied an `animation-name` and guessed at
 *    completion with a `setTimeout` of the same duration. The Web Animations API
 *    has a real `finished` promise, so nothing races any more.
 *  - The `@keyframes` blocks themselves, which lived in the compiled stylesheet.
 *    They're here, next to the code that plays them, because they are not styling
 *    anything — they only ever existed to be triggered from JavaScript.
 */

const EASE = 'ease-in-out'

/**
 * The full length of a page animation — but not how long a page takes to *travel*.
 * Each of these throws its page to the next slot by offset 0.35–0.4 and spends the
 * remainder settling. That travel time is `PAGE_TRAVEL_MS` below, and it is what the
 * strip's own scroll is animated over. See `scrollToPage` in `PageStrip`.
 */
const DURATION = 750

/**
 * How long a thrown page takes to *arrive*, as opposed to how long the animation runs.
 *
 * Every keyframe set below that throws a page into the next slot is there by offset
 * 0.4 and spends the remaining 450ms settling into it. The strip carries every page
 * that isn't individually animated — the ones ahead of the gap, which simply travel a
 * slot — so the row and the thrown page have to cover the same ground in the same
 * time or the flipbook comes apart in the middle of the throw. Read by `PageStrip`,
 * which spends it scrolling the column by exactly one slot — the one movement of the
 * scroller that is part of an animation rather than a page turn.
 */
export const PAGE_TRAVEL_MS = 300

/**
 * How far it is from one page to the next: a thumbnail's height plus its gutters.
 *
 * Only the fallback, and 380 rather than 660 because the strip is a column now: what
 * separates two pages is 360 of drawing and a 10px gutter at each end, where it used to
 * be 640 and two twenties. The real number is measured off `.page` and handed to
 * `play()` by the strip, because the drawing is whatever size the window could spare.
 * Everything that throws a page from one slot to the next is written against it.
 */
export const DEFAULT_PAGE_STEP = 380

/** The drop shadow under a page, as a keyframe value. */
const shadow = (alpha: number) => `rgba(0, 0, 0, ${alpha}) 0 10px 0 -5px`

export type PageAnimation =
	| 'newPage'
	| 'newPageIcon'
	| 'nudge'
	| 'deletePage'
	| 'focusPrevThumb'
	| 'focusNextThumb'

// biome-ignore format: one line per keyframe. These are a table — the offsets and the
// values line up down the page, and that is how you read an animation. The formatter
// breaks each one across five lines and the shape goes with it.
const KEYFRAMES: Record<PageAnimation, (step: number) => Keyframe[]> = {
	/** The incoming canvas, spinning in from off below. */
	newPage: () => [
		{ offset: 0, transform: 'translate3d(-150px, 1500px, 0) rotate3d(180, 180, -180, 90deg) scale3d(1.5, 1.5, 1.5)' },
		{ offset: 0.4, transform: 'translate3d(2px, -10px, 0) rotate3d(0, 0, 0, 0.5deg) scale3d(1, 1, 1)' },
		{ offset: 0.6, transform: 'translate3d(-1px, 4px, 0) rotate3d(0, 0, 0, 0deg) scale3d(1, 1, 1)' },
		{ offset: 0.8, transform: 'translate3d(0, 0, 0) rotate3d(0, 0, 0, 0deg) scale3d(1, 1, 1)' },
		{ offset: 1, transform: 'translate3d(0, 0, 0) rotate3d(0, 0, 0, 0deg) scale3d(1, 1, 1)' },
	],

	/** The page you were on, thrown up the column to make room. */
	newPageIcon: (step) => [
		{ offset: 0, transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)', boxShadow: shadow(0.05) },
		{ offset: 0.4, transform: `translate3d(-15px, -${step}px, 0) rotate3d(1, 1, -1, -1deg) scale3d(1.01, 1.01, 1)`, boxShadow: shadow(0) },
		{ offset: 0.6, transform: `translate3d(3px, -${step - 4}px, 0) scale3d(1, 1, 1)`, boxShadow: shadow(0) },
		{ offset: 0.8, transform: `translate3d(0, -${step}px, 0) scale3d(1, 1, 1)`, boxShadow: shadow(0.05) },
		{ offset: 1, transform: `translate3d(0, -${step}px, 0) scale3d(1, 1, 1)`, boxShadow: shadow(0.05) },
	],

	/*
	 * Duplicating doesn't change what's on screen, so the canvas just bumps.
	 *
	 * Sideways now, where it used to bob. The bob was 2013's and was unmistakable while
	 * the flipbook ran left to right — nothing else on the page moved on that axis. In a
	 * column, five pixels of vertical travel is the beginning of a page turn, which is
	 * exactly the wrong thing for the one page action that leaves you where you were.
	 */
	nudge: () => [
		{ offset: 0, transform: 'translate3d(5px, 0, 0)' },
		{ offset: 0.2, transform: 'translate3d(-2px, 0, 0)' },
		{ offset: 0.35, transform: 'translate3d(1px, 0, 0)' },
		{ offset: 0.45, transform: 'translate3d(0, 0, 0)' },
		{ offset: 1, transform: 'translate3d(0, 0, 0)' },
	],

	/*
	 * The page being deleted, thrown off the side of the window.
	 *
	 * It fell straight down the screen in 2013, which was the obvious direction while the
	 * flipbook was a row: down was the one way out that crossed nothing. In a column it is
	 * the way the *next page* arrives from, so a deleted page fell along the path its
	 * replacement was travelling and the two read as one page overshooting rather than as
	 * one leaving and another taking its place. It goes out to the left instead — still
	 * off the screen, still turning over as it goes, and no longer down the aisle.
	 */
	deletePage: () => [
		{ offset: 0, transform: 'translate3d(2px, 0, 0) rotate(0deg) scale3d(1, 1, 1)' },
		{ offset: 0.25, transform: 'translate3d(-50px, -10px, 0) rotate(-10deg) scale3d(1, 1, 1)' },
		{ offset: 1, transform: 'translate3d(-1000px, 200px, 0) rotate(-170deg) scale3d(0.5, 0.75, 1)' },
	],

	/** The page that takes over when the last page is deleted, sliding down from above. */
	focusPrevThumb: (step) => [
		{ offset: 0, transform: 'translate3d(0, 0, 0) rotate(0deg)' },
		{ offset: 0.35, transform: `translate3d(0, ${step + 20}px, 0) rotate(0.5deg)` },
		{ offset: 0.55, transform: `translate3d(0, ${step - 5}px, 0) rotate(-0.25deg)`, boxShadow: shadow(0) },
		{ offset: 0.75, transform: `translate3d(0, ${step}px, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
		{ offset: 1, transform: `translate3d(0, ${step}px, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
	],

	focusNextThumb: (step) => [
		{ offset: 0, transform: 'translate3d(0, 0, 0) rotate(0deg)' },
		{ offset: 0.35, transform: `translate3d(0, -${step + 20}px, 0) rotate(-0.5deg)` },
		{ offset: 0.55, transform: `translate3d(0, -${step - 5}px, 0) rotate(0.25deg)`, boxShadow: shadow(0) },
		{ offset: 0.75, transform: `translate3d(0, -${step}px, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
		{ offset: 1, transform: `translate3d(0, -${step}px, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
	],
}

export function prefersReducedMotion(): boolean {
	return typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false
}

/**
 * Plays one of the page animations and resolves when it's done.
 *
 * Resolves immediately when the browser has no Web Animations API (jsdom, under
 * test) or the reader has asked for reduced motion — callers use this to sequence
 * work, so it must always settle.
 */
export async function play(
	element: Element,
	animation: PageAnimation,
	options: {
		/** Holds the element at its final frame instead of snapping back. */
		hold?: boolean
		duration?: number
		/** One page to the next, in pixels. See `DEFAULT_PAGE_STEP`. */
		step?: number
	} = {},
): Promise<void> {
	if (typeof element.animate !== 'function' || prefersReducedMotion()) return

	const duration = options.duration ?? DURATION

	const running = element.animate(KEYFRAMES[animation](options.step ?? DEFAULT_PAGE_STEP), {
		duration,
		easing: EASE,
		fill: options.hold ? 'forwards' : 'none',
	})

	/*
	 * The deadline is not belt-and-braces, it's the point.
	 *
	 * A hidden document doesn't run animations at all — a background tab, a
	 * minimised window, a page opened in the background — and `finished` simply
	 * never settles. The tool ignores input while a page animation is playing, so a
	 * promise that never resolves is a locked-up drawing tool that only unlocks on a
	 * reload. Give it a little past its own duration and then finish it by hand.
	 */
	await Promise.race([
		// A cancelled animation rejects. Nothing has gone wrong: the element was
		// removed, or another animation took over.
		running.finished.catch(() => {}),
		delay(duration + 250),
	])

	if (running.playState === 'running' || running.playState === 'paused') running.finish()
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms)
	})
}

/**
 * Above the drawing canvas, which is `z-index: 15`.
 *
 * It has to go on the *page wrapper*, not on the thumbnail. `.page` carries a
 * z-index of its own, which makes it a stacking context, so a z-index on the canvas
 * inside it can only order it against its own siblings — of which there are none.
 * 2013's `deletePage` keyframes asked for `z-index: 20` on the canvas and were
 * defeated by exactly this: the page being deleted spent the first 300ms of its fall
 * hidden behind the canvas it was falling off.
 */
const ABOVE_CANVAS = '20'

export interface FreezeOptions {
	/** Lifts the thumbnail's page wrapper over everything, canvas included. */
	lift?: boolean
}

/**
 * Pins an element where it currently is on screen so a reflow around it doesn't
 * drag it along. The strip slides when a page is inserted or removed, and without
 * this the pages that aren't part of the animation slide with it.
 *
 * Returns the undo.
 */
export function freeze(element: HTMLElement, options: FreezeOptions = {}): () => void {
	const rect = element.getBoundingClientRect()

	const previous = element.getAttribute('style')

	element.style.transitionDuration = '0s'
	element.style.position = 'fixed'
	element.style.top = `${rect.top}px`
	element.style.left = `${rect.left}px`

	const wrapper = options.lift ? element.parentElement : null
	const wrapperPrevious = wrapper?.getAttribute('style') ?? null
	if (wrapper) wrapper.style.zIndex = ABOVE_CANVAS

	return () => {
		if (previous === null) element.removeAttribute('style')
		else element.setAttribute('style', previous)

		if (!wrapper) return
		if (wrapperPrevious === null) wrapper.removeAttribute('style')
		else wrapper.setAttribute('style', wrapperPrevious)
	}
}

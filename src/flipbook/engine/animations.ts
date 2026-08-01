/**
 * The page-strip animations, straight off the 2013 keyframes.
 *
 * Adding a page throws the old thumbnail to the left and flings the new canvas in
 * from off screen; deleting one tumbles it off the bottom of the window. They're
 * ported rather than reinvented — the tool's whole character is that pages move
 * like paper.
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
const DURATION = 750

/**
 * How long a page takes to arrive or leave. Exported because the strip has to slide
 * in step with it — sliding on its own, faster clock, is what made the neighbouring
 * pages look like they snapped into place while the deleted one was still falling.
 */
export const PAGE_ANIMATION_MS = DURATION
export const PAGE_ANIMATION_EASE = EASE

/** One page thumbnail's width plus its gutters. Matches `.page` in the stylesheet. */
const PAGE_STEP = 660

/** The drop shadow under a page, as a keyframe value. */
const shadow = (alpha: number) => `rgba(0, 0, 0, ${alpha}) 0 10px 0 -5px`

export type PageAnimation =
	| 'newPage'
	| 'newPageIcon'
	| 'nudge'
	| 'deletePage'
	| 'focusPrevThumb'
	| 'focusNextThumb'

const KEYFRAMES: Record<PageAnimation, Keyframe[]> = {
	/** The incoming canvas, spinning in from off to the right. */
	newPage: [
		{ offset: 0, transform: 'translate3d(1500px, -150px, 0) rotate3d(180, 180, -180, 90deg) scale3d(1.5, 1.5, 1.5)' },
		{ offset: 0.4, transform: 'translate3d(-10px, 2px, 0) rotate3d(0, 0, 0, 0.5deg) scale3d(1, 1, 1)' },
		{ offset: 0.6, transform: 'translate3d(4px, -1px, 0) rotate3d(0, 0, 0, 0deg) scale3d(1, 1, 1)' },
		{ offset: 0.8, transform: 'translate3d(0, 0, 0) rotate3d(0, 0, 0, 0deg) scale3d(1, 1, 1)' },
		{ offset: 1, transform: 'translate3d(0, 0, 0) rotate3d(0, 0, 0, 0deg) scale3d(1, 1, 1)' },
	],

	/** The page you were on, thrown left into the strip to make room. */
	newPageIcon: [
		{ offset: 0, transform: 'translate3d(0, 0, 0) scale3d(1, 1, 1)', boxShadow: shadow(0.05) },
		{ offset: 0.4, transform: `translate3d(-${PAGE_STEP}px, -15px, 0) rotate3d(1, 1, -1, -1deg) scale3d(1.01, 1.01, 1)`, boxShadow: shadow(0) },
		{ offset: 0.6, transform: `translate3d(-${PAGE_STEP - 4}px, 3px, 0) scale3d(1, 1, 1)`, boxShadow: shadow(0) },
		{ offset: 0.8, transform: `translate3d(-${PAGE_STEP}px, 0, 0) scale3d(1, 1, 1)`, boxShadow: shadow(0.05) },
		{ offset: 1, transform: `translate3d(-${PAGE_STEP}px, 0, 0) scale3d(1, 1, 1)`, boxShadow: shadow(0.05) },
	],

	/** Duplicating doesn't change what's on screen, so the canvas just bumps. */
	nudge: [
		{ offset: 0, transform: 'translate3d(0, 5px, 0)' },
		{ offset: 0.2, transform: 'translate3d(0, -2px, 0)' },
		{ offset: 0.35, transform: 'translate3d(0, 1px, 0)' },
		{ offset: 0.45, transform: 'translate3d(0, 0, 0)' },
		{ offset: 1, transform: 'translate3d(0, 0, 0)' },
	],

	deletePage: [
		{ offset: 0, transform: 'translate3d(0, 2px, 0) rotate(0deg) scale3d(1, 1, 1)' },
		{ offset: 0.25, transform: 'translate3d(-10px, -50px, 0) rotate(-10deg) scale3d(1, 1, 1)' },
		{ offset: 1, transform: 'translate3d(-200px, 1000px, 0) rotate(-170deg) scale3d(0.5, 0.75, 1)' },
	],

	/** The page that takes over when the last page is deleted, sliding in from the right. */
	focusPrevThumb: [
		{ offset: 0, transform: 'translate3d(0, 0, 0) rotate(0deg)' },
		{ offset: 0.35, transform: `translate3d(${PAGE_STEP + 20}px, 0, 0) rotate(0.5deg)` },
		{ offset: 0.55, transform: `translate3d(${PAGE_STEP - 5}px, 0, 0) rotate(-0.25deg)`, boxShadow: shadow(0) },
		{ offset: 0.75, transform: `translate3d(${PAGE_STEP}px, 0, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
		{ offset: 1, transform: `translate3d(${PAGE_STEP}px, 0, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
	],

	focusNextThumb: [
		{ offset: 0, transform: 'translate3d(0, 0, 0) rotate(0deg)' },
		{ offset: 0.35, transform: `translate3d(-${PAGE_STEP + 20}px, 0, 0) rotate(-0.5deg)` },
		{ offset: 0.55, transform: `translate3d(-${PAGE_STEP - 5}px, 0, 0) rotate(0.25deg)`, boxShadow: shadow(0) },
		{ offset: 0.75, transform: `translate3d(-${PAGE_STEP}px, 0, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
		{ offset: 1, transform: `translate3d(-${PAGE_STEP}px, 0, 0) rotate(0deg)`, boxShadow: shadow(0.05) },
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
export async function play(element: Element, animation: PageAnimation, options: {
	/** Holds the element at its final frame instead of snapping back. */
	hold?: boolean
	duration?: number
} = {}): Promise<void> {
	if (typeof element.animate !== 'function' || prefersReducedMotion()) return

	const duration = options.duration ?? DURATION

	const running = element.animate(KEYFRAMES[animation], {
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

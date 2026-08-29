/**
 * The two custom properties that tell the layout what shape a flipbook is.
 *
 * Set on the *column*, not on the sheet of paper inside it, and that is the whole
 * reason this is a function rather than four characters written inline twice.
 * `--book-width` is declared on `.center` in `base.css`, and a `var()` inside a custom
 * property is substituted where the property is **declared** — so an aspect set further
 * down, on `.book` itself, would be invisible to the one thing that most needs it and
 * the sheet would be sized against the fallback while looking like it had been told.
 * The same mistake `--book-reserve` documents from the other direction.
 *
 * Two properties for one number because they are consumed by two things that spell it
 * differently: `aspect-ratio` takes `640 / 360`, and `calc()` needs a plain number on
 * the right of a division. Deriving one from the other in CSS is not possible in the
 * direction that would help.
 *
 * No paper.js and no React here on purpose — `RouteShell` draws this same shape from
 * the entry bundle, before either has arrived.
 */

export interface PageVars {
	'--page-ratio': string
	'--page-aspect': string
}

export function pageVars(page: { width: number; height: number }): PageVars {
	return {
		'--page-ratio': `${page.width} / ${page.height}`,
		'--page-aspect': String(page.width / page.height),
	}
}

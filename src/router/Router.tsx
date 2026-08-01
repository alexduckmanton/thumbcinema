import { useCallback, useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'

/**
 * A ~60-line history router.
 *
 * `useSyncExternalStore` over the History API: popstate covers back and forward,
 * and pushes dispatch a synthetic event of our own because the platform doesn't
 * fire anything when you call `pushState` yourself.
 */

const LOCATION_EVENT = 'tc:navigate'

function subscribe(onChange: () => void): () => void {
	window.addEventListener('popstate', onChange)
	window.addEventListener(LOCATION_EVENT, onChange)
	return () => {
		window.removeEventListener('popstate', onChange)
		window.removeEventListener(LOCATION_EVENT, onChange)
	}
}

/**
 * The snapshot has to be a primitive — `useSyncExternalStore` compares with
 * Object.is, and a fresh object every call would loop forever. `pathname + search`
 * is the whole of what anything here reads.
 */
function getSnapshot(): string {
	return window.location.pathname + window.location.search
}

export interface Location {
	pathname: string
	search: string
}

export function useLocation(): Location {
	const href = useSyncExternalStore(subscribe, getSnapshot, () => '/')
	const [pathname = '/', search = ''] = href.split(/(?=\?)/)
	return { pathname, search }
}

export interface NavigateOptions {
	/** Replaces the current entry rather than pushing a new one. */
	replace?: boolean
	/** Keeps the scroll position — used when a tab switch shouldn't jump the page. */
	preserveScroll?: boolean
}

/**
 * A page's veto on being navigated away from.
 *
 * `beforeunload` covers reloads and anything that leaves the document, and the
 * browser owns that prompt — but a client-side navigation isn't a page load and
 * fires none of it, so the create page's logo link would quietly discard an unsaved
 * drawing. Anything that would leave asks here first. Returning false calls it off.
 *
 * One at a time: there is only ever one route mounted, and the last one to ask is
 * the one on screen.
 */
export type NavigationGuard = () => boolean

let guard: NavigationGuard | null = null

/** Installs `ask`, and returns the release — call it on unmount. */
export function guardNavigation(ask: NavigationGuard): () => void {
	guard = ask
	return () => {
		if (guard === ask) guard = null
	}
}

export function navigate(to: string, options: NavigateOptions = {}): void {
	if (to === getSnapshot() && !options.replace) return
	if (guard && !guard()) return

	window.history[options.replace ? 'replaceState' : 'pushState']({}, '', to)
	window.dispatchEvent(new Event(LOCATION_EVENT))

	if (!options.preserveScroll && !options.replace) window.scrollTo(0, 0)
}

export function useNavigate(): typeof navigate {
	return useCallback(navigate, [])
}

/** True for anything that should be left to the browser: new tab, download, external. */
function isExternalClick(event: MouseEvent<HTMLAnchorElement>, target?: string): boolean {
	return (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		(target !== undefined && target !== '_self')
	)
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	to: string
	replace?: boolean
	children?: ReactNode
}

/**
 * A real `<a href>` that happens to intercept plain left clicks. Middle click,
 * cmd-click and "open in new tab" all still work, and the URL is real in the
 * status bar — which a button pretending to be a link never is.
 */
export function Link({ to, replace, onClick, target, children, ...rest }: LinkProps) {
	const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event)
		if (isExternalClick(event, target)) return
		if (/^[a-z]+:|^\/\//i.test(to)) return // absolute URL: let the browser have it

		event.preventDefault()
		navigate(to, { replace })
	}

	return (
		<a href={to} target={target} onClick={handleClick} {...rest}>
			{children}
		</a>
	)
}

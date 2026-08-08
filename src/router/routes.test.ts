import { describe, expect, it } from 'vitest'

import { createPath, flipbookPath, matchRoute, remixSource } from './routes'

describe('matchRoute', () => {
	it('maps the four routes', () => {
		expect(matchRoute('/')).toEqual({ name: 'gallery' })
		expect(matchRoute('/create')).toEqual({ name: 'create' })
		expect(matchRoute('/f/abc123')).toEqual({ name: 'playback', id: 'abc123' })
		expect(matchRoute('/nowhere')).toEqual({ name: 'notFound' })
	})

	it('treats a trailing slash as the same route', () => {
		expect(matchRoute('/create/')).toEqual({ name: 'create' })
		expect(matchRoute('/f/abc123/')).toEqual({ name: 'playback', id: 'abc123' })
	})

	it('decodes the flipbook id', () => {
		expect(matchRoute('/f/a%20b')).toEqual({ name: 'playback', id: 'a b' })
	})

	it('is a 404, not a crash, for a malformed escape sequence', () => {
		expect(matchRoute('/f/%E0%A4%A')).toEqual({ name: 'notFound' })
	})

	it('does not match a nested path under /f', () => {
		expect(matchRoute('/f/abc/extra')).toEqual({ name: 'notFound' })
	})

	it('round-trips any id through flipbookPath', () => {
		// Real ids come from a restricted alphabet (see lib/id.js), but the pair has
		// to survive anything — a slash included, which encodeURIComponent escapes so
		// it stays inside one path segment.
		for (const id of ['abc123', 'a b', 'a/b', 'ünïcødé', '%%%']) {
			expect(matchRoute(flipbookPath(id))).toEqual({ name: 'playback', id })
		}
	})
})

describe('createPath and remixSource', () => {
	it('is the plain create page with nothing to remix', () => {
		expect(createPath()).toBe('/create')
		expect(createPath(null)).toBe('/create')
	})

	it('names the flipbook to open on', () => {
		expect(createPath('abc123')).toBe('/create?remix=abc123')
	})

	it('round-trips any id', () => {
		// The pair has to survive whatever it is handed, for the reason flipbookPath
		// does: an `&` or a `=` in an unescaped id would otherwise read as a second
		// parameter and the drawing tool would open on nothing.
		for (const id of ['abc123', 'a b', 'a&view=all', 'a=b', 'ünïcødé', '%%%']) {
			const path = createPath(id)
			expect(remixSource(path.slice(path.indexOf('?')))).toBe(id)
		}
	})

	it('is still the create route, so nothing about matching changes', () => {
		// A query parameter rather than a route of its own: it doesn't change what the
		// page is, and `matchRoute` stays a function of the pathname alone.
		expect(matchRoute('/create')).toEqual({ name: 'create' })
	})

	it('is null when there is no remix to open', () => {
		expect(remixSource('')).toBe(null)
		expect(remixSource('?view=all')).toBe(null)
	})
})

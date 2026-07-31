import { describe, expect, it } from 'vitest'

import { flipbookPath, matchRoute } from './routes'

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

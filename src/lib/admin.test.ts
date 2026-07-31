import { beforeEach, describe, expect, it } from 'vitest'

import { adminHeaders, isAdmin, readToken, refresh, signOut } from './admin'

const STORAGE_KEY = 'tc_admin_token'

beforeEach(() => {
	window.localStorage.clear()
	window.history.replaceState({}, '', '/')
	refresh()
})

describe('readToken', () => {
	it('takes the token from the URL and remembers it', () => {
		window.history.replaceState({}, '', '/?admin=sekrit')

		expect(readToken()).toBe('sekrit')
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe('sekrit')
	})

	it('scrubs the token out of the address bar', () => {
		// Otherwise it sits there for the length of a screen share.
		window.history.replaceState({}, '', '/?admin=sekrit')
		readToken()

		expect(window.location.search).toBe('')
	})

	it('keeps the rest of the query string', () => {
		window.history.replaceState({}, '', '/?view=all&admin=sekrit')
		readToken()

		expect(window.location.search).toBe('?view=all')
	})

	it('falls back to what was stored on a previous visit', () => {
		window.localStorage.setItem(STORAGE_KEY, 'stored')
		expect(readToken()).toBe('stored')
	})

	it('prefers a fresh token in the URL over the stored one', () => {
		window.localStorage.setItem(STORAGE_KEY, 'stale')
		window.history.replaceState({}, '', '/?admin=fresh')

		expect(readToken()).toBe('fresh')
	})

	it('is null when there is nothing anywhere', () => {
		expect(readToken()).toBeNull()
	})
})

describe('admin mode', () => {
	it('is off by default and sends no headers', () => {
		expect(isAdmin()).toBe(false)
		expect(adminHeaders()).toEqual({})
	})

	it('sends a bearer token once enabled', () => {
		window.localStorage.setItem(STORAGE_KEY, 'sekrit')
		refresh()

		expect(isAdmin()).toBe(true)
		expect(adminHeaders()).toEqual({ Authorization: 'Bearer sekrit' })
	})

	it('forgets the token when the API says it has stopped working', () => {
		window.localStorage.setItem(STORAGE_KEY, 'sekrit')
		refresh()

		signOut()

		expect(isAdmin()).toBe(false)
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
	})
})

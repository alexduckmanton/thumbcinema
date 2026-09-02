import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { hideToast, registerToast, showToast, takeRegisteredToast, useToast } from './toast'

beforeEach(() => {
	window.localStorage.clear()
	hideToast()
})

describe('toast', () => {
	it('shows and hides one', () => {
		const { result } = renderHook(() => useToast())
		expect(result.current).toBeNull()

		act(() => showToast({ copy: 'Hello', type: 'info' }))
		expect(result.current).toEqual({ copy: 'Hello', type: 'info' })

		act(() => hideToast())
		expect(result.current).toBeNull()
	})

	it('hands a toast to the next page and clears it', () => {
		// A successful save navigates away, so the confirmation has to survive the
		// navigation rather than being shown on a page that is about to go.
		registerToast({ copy: 'Flipbook saved.', type: 'info' })

		const { result } = renderHook(() => useToast())
		act(() => takeRegisteredToast())

		expect(result.current).toEqual({ copy: 'Flipbook saved.', type: 'info' })
		expect(window.localStorage.getItem('message')).toBeNull()
	})

	it('ignores a half-written or foreign handover', () => {
		window.localStorage.setItem('message', 'not json at all')

		const { result } = renderHook(() => useToast())
		act(() => takeRegisteredToast())

		expect(result.current).toBeNull()
	})

	it('ignores a handover missing the fields it needs to render', () => {
		window.localStorage.setItem('message', JSON.stringify({ copy: 'Half a toast' }))

		const { result } = renderHook(() => useToast())
		act(() => takeRegisteredToast())

		expect(result.current).toBeNull()
	})

	it('ignores a handover left by the version that had three types', () => {
		// A tab open across the deploy can write one of these. There is no green any more.
		window.localStorage.setItem('message', JSON.stringify({ copy: 'Saved', type: 'success' }))

		const { result } = renderHook(() => useToast())
		act(() => takeRegisteredToast())

		expect(result.current).toBeNull()
	})
})

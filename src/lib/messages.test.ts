import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import {
	hideMessage,
	registerMessage,
	showMessage,
	takeRegisteredMessage,
	useMessage,
} from './messages'

beforeEach(() => {
	window.localStorage.clear()
	hideMessage()
})

describe('messages', () => {
	it('shows and hides one', () => {
		const { result } = renderHook(() => useMessage())
		expect(result.current).toBeNull()

		act(() => showMessage({ copy: 'Hello', cta: 'Fine', type: 'info' }))
		expect(result.current).toEqual({ copy: 'Hello', cta: 'Fine', type: 'info' })

		act(() => hideMessage())
		expect(result.current).toBeNull()
	})

	it('hands a message to the next page and clears it', () => {
		// A successful save navigates away, so the congratulations has to survive
		// the navigation rather than being shown on a page that is about to go.
		registerMessage({ copy: 'Saved', cta: 'Nice', type: 'success' })

		const { result } = renderHook(() => useMessage())
		act(() => takeRegisteredMessage())

		expect(result.current).toEqual({ copy: 'Saved', cta: 'Nice', type: 'success' })
		expect(window.localStorage.getItem('message')).toBeNull()
	})

	it('ignores a half-written or foreign handover', () => {
		window.localStorage.setItem('message', 'not json at all')

		const { result } = renderHook(() => useMessage())
		act(() => takeRegisteredMessage())

		expect(result.current).toBeNull()
	})

	it('ignores a handover missing the fields it needs to render', () => {
		window.localStorage.setItem('message', JSON.stringify({ copy: 'Half a message' }))

		const { result } = renderHook(() => useMessage())
		act(() => takeRegisteredMessage())

		expect(result.current).toBeNull()
	})
})

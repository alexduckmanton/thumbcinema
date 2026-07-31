import { describe, expect, it, vi } from 'vitest'

import { Store } from './store'

describe('Store', () => {
	it('merges a patch and replaces the snapshot', () => {
		const store = new Store({ a: 1, b: 'x' })
		const before = store.snapshot

		store.set({ a: 2 })

		expect(store.snapshot).toEqual({ a: 2, b: 'x' })
		expect(store.snapshot).not.toBe(before)
	})

	it('ignores a patch that changes nothing', () => {
		// The snapshot's identity is the "something happened" signal that
		// useSyncExternalStore compares on, so a no-op patch must not replace it.
		const store = new Store({ a: 1 })
		const listener = vi.fn()
		store.subscribe(listener)

		const before = store.snapshot
		store.set({ a: 1 })

		expect(store.snapshot).toBe(before)
		expect(listener).not.toHaveBeenCalled()
	})

	it('compares shallowly, so a new object with the same contents counts as a change', () => {
		const store = new Store<{ items: number[] }>({ items: [] })
		const listener = vi.fn()
		store.subscribe(listener)

		store.set({ items: [] })

		expect(listener).toHaveBeenCalledTimes(1)
	})

	it('notifies every subscriber, and stops after unsubscribe', () => {
		const store = new Store({ a: 1 })
		const first = vi.fn()
		const second = vi.fn()

		const stop = store.subscribe(first)
		store.subscribe(second)

		store.set({ a: 2 })
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)

		stop()
		store.set({ a: 3 })
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(2)
	})
})

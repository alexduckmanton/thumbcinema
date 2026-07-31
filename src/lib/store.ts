import { useSyncExternalStore } from 'react'

/**
 * A minimal observable store.
 *
 * The drawing tool's real state lives in paper.js — a mutable scene graph that React
 * has no business owning. What React does need is a handful of derived facts (which
 * page is active, which tool is on, how many pages there are), and this is the
 * narrow channel those come through.
 *
 * `set` is a shallow merge that no-ops when nothing changed, so the state object's
 * identity is a reliable "something happened" signal.
 */
export class Store<T extends object> {
	private state: T
	private readonly listeners = new Set<() => void>()

	constructor(initial: T) {
		this.state = initial
	}

	get snapshot(): T {
		return this.state
	}

	set(patch: Partial<T>): void {
		let changed = false
		for (const key of Object.keys(patch) as (keyof T)[]) {
			if (!Object.is(this.state[key], patch[key])) {
				changed = true
				break
			}
		}
		if (!changed) return

		this.state = { ...this.state, ...patch }
		for (const listener of this.listeners) listener()
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
}

/**
 * Subscribes a component to the whole of a store.
 *
 * Deliberately not selector-based. There is exactly one of these on screen at a time
 * and its state is a dozen scalars, so slicing it finer would buy nothing and cost
 * the usual selector-identity footguns.
 */
export function useStore<T extends object>(store: Store<T>): T {
	return useSyncExternalStore(
		store.subscribe,
		() => store.snapshot,
		() => store.snapshot,
	)
}

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearPreviewCache, peek, retain, type PreviewSource } from './cache'

/** Enough of one to be constructed. What it draws is `artwork.test.ts`'s business. */
class FakePath2D {
	moveTo() {}
	lineTo() {}
}

beforeAll(() => {
	Object.defineProperty(globalThis, 'Path2D', { value: FakePath2D, writable: true })
})

/** One page with one stroke on it, `pages` times, behind the three system groups. */
function artwork(pages: number): string {
	const page = '<g stroke-width="3"><path d="M0,0L10,10"/></g>'
	return `<svg xmlns="http://www.w3.org/2000/svg"><g/><g/><g/>${page.repeat(pages)}</svg>`
}

function source(id: string): PreviewSource {
	return { id, format: 'svg', data_url: `/api/flipbooks/${id}/data` }
}

/**
 * A fetch whose responses are handed over by the test, one at a time.
 *
 * `settle` is what makes "released while in flight" and "released while decoding" two
 * different situations rather than a race — which is the whole of what this file is
 * checking.
 */
function stubFetch() {
	const pending = new Map<string, (body: string) => void>()
	const aborted: string[] = []
	const started: string[] = []

	const fetchStub = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
		started.push(url)

		return new Promise((resolve, reject) => {
			pending.set(url, (body: string) => resolve(new Response(body)))

			init?.signal?.addEventListener('abort', () => {
				aborted.push(url)
				reject(new DOMException('Aborted', 'AbortError'))
			})
		})
	})

	vi.stubGlobal('fetch', fetchStub)

	return {
		started,
		aborted,
		settle(id: string, body: string) {
			pending.get(`/api/flipbooks/${id}/data`)?.(body)
		},
	}
}

/** Turns the microtask queue until `done`, or gives up so a failure isn't a hang. */
async function until(done: () => boolean, turns = 200) {
	for (let i = 0; i < turns && !done(); i++) await Promise.resolve()
	expect(done()).toBe(true)
}

/** Long enough for the fetch, the text and at least one decode slice to run. */
async function settleFrames(count = 3) {
	for (let i = 0; i < count; i++) {
		await new Promise((resolve) => {
			requestAnimationFrame(() => resolve(null))
		})
		await Promise.resolve()
	}
}

let net: ReturnType<typeof stubFetch>

beforeEach(() => {
	clearPreviewCache()
	net = stubFetch()
})

afterEach(() => {
	vi.unstubAllGlobals()
	clearPreviewCache()
})

describe('retain', () => {
	it('fetches a flipbook once however many cards ask for it', async () => {
		const release = [retain(source('a'), () => {}), retain(source('a'), () => {})]

		expect(net.started).toEqual(['/api/flipbooks/a/data'])

		net.settle('a', artwork(3))
		await settleFrames()

		expect(peek('a')?.status).toBe('ready')
		expect(peek('a')?.total).toBe(3)
		for (const undo of release) undo()
	})

	it('abandons a download the moment the last card lets go of it', async () => {
		// The sweep case: a pointer crossing the grid touches twenty cards and waits
		// for none of them. Twenty downloads nobody wants is the thing to avoid, and
		// the responses are immutable so hovering back costs almost nothing.
		const release = retain(source('a'), () => {})
		release()

		await Promise.resolve()

		expect(net.aborted).toEqual(['/api/flipbooks/a/data'])
		expect(peek('a')).toBeNull()
	})

	it('finishes a decode already under way even after the last card lets go', async () => {
		// The other half of the same decision. By here the bytes are paid for and what
		// is left is arithmetic in idle slices — stopping would throw away the download
		// to save the cheap part, and leave the next hover starting from nothing.
		const release = retain(source('a'), () => {})

		net.settle('a', artwork(4))
		// Waited on the page count rather than on a number of turns: it is set on the
		// line after the bytes land and before the first page is built, so it is
		// exactly the window this test is about — and how many microtasks it takes to
		// read a response body is the fetch implementation's business, not this file's.
		await until(() => (peek('a')?.total ?? 0) > 0)

		release()
		await settleFrames()

		expect(net.aborted).toEqual([])
		expect(peek('a')?.status).toBe('ready')
		expect(peek('a')?.pages).toHaveLength(4)
	})

	it('tells its holders as the flipbook lands', async () => {
		const changed = vi.fn()
		const release = retain(source('a'), changed)

		net.settle('a', artwork(2))
		await settleFrames()

		expect(changed).toHaveBeenCalled()
		release()
	})

	it('reports a flipbook that would not load, and keeps saying so', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))),
		)

		const release = retain(source('gone'), () => {})
		await settleFrames()

		expect(peek('gone')?.status).toBe('failed')
		release()
	})
})

describe('eviction', () => {
	it('drops the least recently used flipbooks nobody is holding', async () => {
		// Seven, against a cap of six.
		for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
			const release = retain(source(id), () => {})
			net.settle(id, artwork(1))
			await settleFrames(1)
			release()
		}

		expect(peek('a')).not.toBeNull()

		const release = retain(source('g'), () => {})
		expect(peek('a')).toBeNull()
		expect(peek('g')).not.toBeNull()
		release()
	})

	it('never drops the flipbook a card is currently showing', async () => {
		// It is on screen. Whatever else has to go, not this one.
		const held = retain(source('held'), () => {})
		net.settle('held', artwork(1))
		await settleFrames(1)

		for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
			const release = retain(source(id), () => {})
			net.settle(id, artwork(1))
			await settleFrames(1)
			release()
		}

		expect(peek('held')).not.toBeNull()
		held()
	})
})

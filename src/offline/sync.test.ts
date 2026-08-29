import { beforeEach, describe, expect, it, vi } from 'vitest'

const records = vi.hoisted(() => new Map<string, { id: string }>())

vi.mock('./db', () => ({
	readAll: vi.fn(async () => [...records.values()]),
	read: vi.fn(async (id: string) => records.get(id)),
	write: vi.fn(async (record: { id: string }) => {
		records.set(record.id, record)
	}),
	erase: vi.fn(async (id: string) => {
		records.delete(id)
	}),
}))

vi.mock('../lib/messages', () => ({ showMessage: vi.fn() }))

vi.mock('../lib/api', async (importActual) => ({
	...(await importActual<typeof import('../lib/api')>()),
	saveFlipbook: vi.fn(),
}))

import { ApiError, saveFlipbook } from '../lib/api'
import { showMessage } from '../lib/messages'
import { pendingEntries, queueFlipbook, resetPending } from './pending'
import { flushPending, startOfflineSync } from './sync'

const SAVE = {
	title: '',
	description: '',
	svg: '<svg></svg>',
	thumbnailDataUrl: 'data:image/png;base64,AAA',
	cover: 0,
	nsfw: false,
	remixOf: null,
}

/** What `fetch` throws with nothing to answer it: no response, no status, no opinion. */
function offline(): Error {
	return new TypeError('Failed to fetch')
}

function setOnline(online: boolean): void {
	Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

beforeEach(() => {
	records.clear()
	resetPending()
	vi.clearAllMocks()
	setOnline(true)
})

describe('flushPending', () => {
	it('posts the queue oldest first, so the gallery ends up in the right order', async () => {
		vi.mocked(saveFlipbook).mockImplementation(async (payload) => `/f/${payload.title}`)

		const first = await queueFlipbook({ ...SAVE, title: 'one' })
		const second = await queueFlipbook({ ...SAVE, title: 'two' })

		await flushPending()

		expect(vi.mocked(saveFlipbook).mock.calls.map(([payload]) => payload.title)).toEqual([
			'one',
			'two',
		])
		expect(pendingEntries().map((entry) => entry.publishedAs)).toEqual(['two', 'one'])
		expect(records.size).toBe(0)
		expect(first.book.id).not.toBe(second.book.id)
	})

	it('says so once, however many went up', async () => {
		vi.mocked(saveFlipbook).mockResolvedValue('/f/d7c3u4inrz')
		await queueFlipbook(SAVE)
		await queueFlipbook(SAVE)

		await flushPending()

		expect(showMessage).toHaveBeenCalledTimes(1)
		expect(vi.mocked(showMessage).mock.calls[0]?.[0].copy).toContain('2 flipbooks are published')
	})

	it('stays quiet when there was nothing to publish', async () => {
		await flushPending()

		expect(saveFlipbook).not.toHaveBeenCalled()
		expect(showMessage).not.toHaveBeenCalled()
	})

	it('stops at the first connection failure and keeps the rest', async () => {
		vi.mocked(saveFlipbook).mockRejectedValue(offline())
		await queueFlipbook({ ...SAVE, title: 'one' })
		await queueFlipbook({ ...SAVE, title: 'two' })

		await flushPending()

		// One attempt, not two: if the first couldn't reach the server neither can the
		// second, and both are megabytes.
		expect(saveFlipbook).toHaveBeenCalledTimes(1)
		expect(pendingEntries().every((entry) => entry.status === 'waiting')).toBe(true)
		expect(records.size).toBe(2)
	})

	it('carries on past a flipbook the server refused, and remembers why', async () => {
		vi.mocked(saveFlipbook)
			.mockRejectedValueOnce(new ApiError(413, 'That flipbook is too big to save.'))
			.mockResolvedValueOnce('/f/d7c3u4inrz')

		await queueFlipbook({ ...SAVE, title: 'huge' })
		await queueFlipbook({ ...SAVE, title: 'fine' })

		await flushPending()

		expect(saveFlipbook).toHaveBeenCalledTimes(2)
		const [newer, older] = pendingEntries()
		expect(newer?.status).toBe('published')
		expect(older).toMatchObject({ status: 'failed', error: 'That flipbook is too big to save.' })
		// Kept, not thrown away: the drawing is nowhere else, and the playback page is
		// where somebody decides what to do about it.
		expect(records.size).toBe(1)
	})

	it('does not try at all with the radios off', async () => {
		setOnline(false)
		await queueFlipbook(SAVE)

		await flushPending()

		expect(saveFlipbook).not.toHaveBeenCalled()
	})
})

describe('startOfflineSync', () => {
	it('publishes what is waiting the moment the connection comes back', async () => {
		vi.mocked(saveFlipbook).mockResolvedValue('/f/d7c3u4inrz')
		records.set('local-aaaaaaaaaa', {
			id: 'local-aaaaaaaaaa',
			title: '',
			description: '',
			svg: '<svg></svg>',
			thumbnailDataUrl: '',
			cover: 0,
			nsfw: false,
			remixOf: null,
			createdAt: '2026-01-01',
		} as never)

		setOnline(false)
		startOfflineSync()
		await vi.waitFor(() => expect(pendingEntries()).toHaveLength(1))
		expect(saveFlipbook).not.toHaveBeenCalled()

		setOnline(true)
		window.dispatchEvent(new Event('online'))

		await vi.waitFor(() => expect(saveFlipbook).toHaveBeenCalledTimes(1))
	})
})

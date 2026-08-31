import { beforeEach, describe, expect, it, vi } from 'vitest'

const records = vi.hoisted(() => new Map<string, { id: string }>())

// The one place IndexedDB is spoken to, and jsdom hasn't got one. Everything below is
// about what the queue *does* with storage rather than about the storage itself.
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

import * as db from './db'
import {
	discardPending,
	getPending,
	isPendingId,
	loadPending,
	markFailed,
	markPublished,
	markUploading,
	pendingEntries,
	pendingFlipbook,
	pendingPayload,
	pendingSummary,
	queueFlipbook,
	resetPending,
} from './pending'

const SAVE = {
	title: 'A cat',
	description: 'It blinks',
	svg: '<svg></svg>',
	thumbnailDataUrl: 'data:image/png;base64,AAA',
	cover: 0,
	remixOf: null,
}

beforeEach(() => {
	records.clear()
	resetPending()
	vi.clearAllMocks()
})

describe('queueFlipbook', () => {
	it('writes the save whole, so it can be posted unchanged later', async () => {
		const entry = await queueFlipbook({ ...SAVE, remixOf: 'abc123' })

		expect(records.size).toBe(1)
		expect(pendingPayload(entry.book)).toEqual({ ...SAVE, remixOf: 'abc123' })
	})

	it('mints an id nothing on the server could collide with', async () => {
		const entry = await queueFlipbook(SAVE)

		expect(isPendingId(entry.book.id)).toBe(true)
		// Server ids are [a-z0-9] and can never contain the hyphen. See `pending.ts`.
		expect(entry.book.id).toMatch(/^local-[a-z2-9]{10}$/)
	})

	it('is in the list before the page it was saved on has gone', async () => {
		const entry = await queueFlipbook(SAVE)

		expect(pendingEntries()).toEqual([entry])
		expect(entry.status).toBe('waiting')
	})

	it('rejects when there is nowhere to put it — the create page has to know', async () => {
		vi.mocked(db.write).mockRejectedValueOnce(new Error('QuotaExceededError'))

		await expect(queueFlipbook(SAVE)).rejects.toThrow('QuotaExceededError')
		expect(pendingEntries()).toEqual([])
	})
})

describe('loadPending', () => {
	it('reads storage once, newest first', async () => {
		records.set('local-aaaaaaaaaa', { id: 'local-aaaaaaaaaa', createdAt: '2025-01-01' } as never)
		records.set('local-bbbbbbbbbb', { id: 'local-bbbbbbbbbb', createdAt: '2026-01-01' } as never)

		await loadPending()
		await loadPending()

		expect(db.readAll).toHaveBeenCalledTimes(1)
		expect(pendingEntries().map((entry) => entry.book.id)).toEqual([
			'local-bbbbbbbbbb',
			'local-aaaaaaaaaa',
		])
	})

	it('leaves anything queued in this page view alone', async () => {
		const entry = await queueFlipbook(SAVE)

		await loadPending()

		expect(pendingEntries()).toHaveLength(1)
		expect(pendingEntries()[0]?.book.id).toBe(entry.book.id)
	})

	it('survives storage that will not open at all', async () => {
		vi.mocked(db.readAll).mockRejectedValueOnce(new Error('No IndexedDB in this browser.'))

		await expect(loadPending()).resolves.toBeUndefined()
		expect(pendingEntries()).toEqual([])
	})
})

describe('pendingSummary', () => {
	it('is a gallery row, with the artwork as something fetchable', async () => {
		const entry = await queueFlipbook(SAVE)
		const summary = pendingSummary(entry)

		expect(summary.id).toBe(entry.book.id)
		expect(summary.format).toBe('svg')
		expect(summary.featured).toBe(false)
		expect(summary.data_url).toMatch(/^blob:/)
		expect(summary.thumbnail_url).toBe(SAVE.thumbnailDataUrl)
		// There is no SVG cover here: cutting one out of the artwork is the server's job.
		expect(summary.thumbnail_svg_url).toBeNull()
	})

	it('holds one object URL per flipbook rather than one per card drawn', async () => {
		const entry = await queueFlipbook(SAVE)

		expect(pendingSummary(entry).data_url).toBe(pendingSummary(entry).data_url)
	})

	it('points at the real flipbook once there is one', async () => {
		const entry = await queueFlipbook(SAVE)
		await markPublished(entry.book.id, 'd7c3u4inrz')

		const published = pendingEntries()[0]!
		expect(pendingSummary(published).id).toBe('d7c3u4inrz')
		// Still drawn from the copy in hand, which is the same drawing and is already here.
		expect(pendingSummary(published).data_url).toMatch(/^blob:/)
	})

	it('has no lineage, published or not', async () => {
		const entry = await queueFlipbook({ ...SAVE, remixOf: 'abc123' })
		const flipbook = pendingFlipbook(entry)

		expect(flipbook.remix_of).toBeNull()
		expect(flipbook.remix_root).toBe(entry.book.id)
	})
})

describe('the way an entry moves', () => {
	it('is erased from storage the moment it is published, so it cannot go up twice', async () => {
		const entry = await queueFlipbook(SAVE)

		markUploading(entry.book.id)
		expect(pendingEntries()[0]?.status).toBe('uploading')

		await markPublished(entry.book.id, 'd7c3u4inrz')

		expect(records.size).toBe(0)
		expect(pendingEntries()[0]).toMatchObject({ status: 'published', publishedAs: 'd7c3u4inrz' })
	})

	it('keeps a refused flipbook, and why it was refused', async () => {
		const entry = await queueFlipbook(SAVE)

		markFailed(entry.book.id, 'Flipbook too large.')

		expect(records.size).toBe(1)
		expect(pendingEntries()[0]).toMatchObject({
			status: 'failed',
			error: 'Flipbook too large.',
		})
	})

	it('puts one back in the queue when nothing answered', async () => {
		const entry = await queueFlipbook(SAVE)
		markUploading(entry.book.id)

		markFailed(entry.book.id, null)

		expect(pendingEntries()[0]).toMatchObject({ status: 'waiting', error: null })
	})
})

describe('discardPending', () => {
	it('takes it out of storage and off the screen', async () => {
		const entry = await queueFlipbook(SAVE)

		await discardPending(entry.book.id)

		expect(records.size).toBe(0)
		expect(pendingEntries()).toEqual([])
	})

	it('still forgets one that never reached storage', async () => {
		const entry = await queueFlipbook(SAVE)
		vi.mocked(db.erase).mockRejectedValueOnce(new Error('gone'))

		await expect(discardPending(entry.book.id)).resolves.toBeUndefined()
		expect(pendingEntries()).toEqual([])
	})
})

describe('getPending', () => {
	it('finds one that only storage knows about — a permalink opened cold', async () => {
		records.set('local-cccccccccc', {
			id: 'local-cccccccccc',
			createdAt: '2026-01-01',
			title: 'A cat',
		} as never)

		const entry = await getPending('local-cccccccccc')

		expect(entry?.book.title).toBe('A cat')
	})

	it('answers null for one that has been discarded', async () => {
		await expect(getPending('local-dddddddddd')).resolves.toBeNull()
	})
})

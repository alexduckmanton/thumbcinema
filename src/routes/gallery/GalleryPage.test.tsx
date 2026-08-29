import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { FlipbookPage, FlipbookSummary } from '../../lib/api'
import { markPublished, queueFlipbook, resetPending } from '../../offline/pending'
import { GalleryPage } from './GalleryPage'
import cardStyles from '../../flipbook/card/FlipbookCard.module.css'
import styles from './GalleryPage.module.css'

// The queue's storage, which jsdom hasn't got. See `src/offline/pending.test.ts`.
const records = vi.hoisted(() => new Map<string, { id: string }>())

vi.mock('../../offline/db', () => ({
	readAll: vi.fn(async () => [...records.values()]),
	read: vi.fn(async (id: string) => records.get(id)),
	write: vi.fn(async (record: { id: string }) => {
		records.set(record.id, record)
	}),
	erase: vi.fn(async (id: string) => {
		records.delete(id)
	}),
}))

const listFlipbooks = vi.fn<(...args: unknown[]) => Promise<FlipbookPage>>()

vi.mock('../../lib/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../lib/api')>()),
	listFlipbooks: (...args: unknown[]) => listFlipbooks(...args),
}))

// Nothing observes anything in jsdom, so the infinite scroll never fires by
// itself — which is what we want: each test drives the fetching explicitly.
class NoopObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
vi.stubGlobal('IntersectionObserver', NoopObserver)

function flipbook(id: string, over: Partial<FlipbookSummary> = {}): FlipbookSummary {
	return {
		id,
		title: `Flipbook ${id}`,
		source: 'user',
		format: 'svg',
		featured: false,
		nsfw: false,
		created_at: '2025-01-01T00:00:00.000Z',
		data_url: `/api/flipbooks/${id}/data`,
		thumbnail_url: `/api/flipbooks/${id}/thumbnail`,
		thumbnail_svg_url: `/api/flipbooks/${id}/thumbnail.svg`,
		...over,
	}
}

function page(items: FlipbookSummary[], next: string | null = null): FlipbookPage {
	return { items, view: 'featured', limit: 24, next_cursor: next }
}

/** The placeholder cards. Aria-hidden by design, so there is no role to ask for. */
function skeletons() {
	return document.querySelectorAll(`.${styles.skeleton}`)
}

function setOnline(online: boolean): void {
	Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

/** A flipbook saved with no connection, waiting to be published. */
function queue(title: string) {
	return queueFlipbook({
		title,
		description: '',
		svg: '<svg></svg>',
		thumbnailDataUrl: 'data:image/png;base64,AAA',
		cover: 0,
		nsfw: false,
		remixOf: null,
	})
}

beforeEach(() => {
	listFlipbooks.mockReset()
	records.clear()
	resetPending()
	setOnline(true)
	window.history.replaceState({}, '', '/')
})

describe('GalleryPage', () => {
	it('renders a card per flipbook, linking to its permalink', async () => {
		listFlipbooks.mockResolvedValue(page([flipbook('aaa'), flipbook('bbb')]))

		render(<GalleryPage />)

		const first = await screen.findByRole('link', { name: 'Flipbook aaa' })
		expect(first).toHaveAttribute('href', '/f/aaa')
		expect(await screen.findByRole('link', { name: 'Flipbook bbb' })).toBeInTheDocument()
	})

	it('shows the cover page as an SVG, lazily', async () => {
		listFlipbooks.mockResolvedValue(page([flipbook('aaa')]))

		render(<GalleryPage />)

		const card = await screen.findByRole('link', { name: 'Flipbook aaa' })
		const thumb = card.querySelector('img')

		expect(thumb).toHaveAttribute('src', '/api/flipbooks/aaa/thumbnail.svg')
		// The grid is an infinite scroll, and the card that has just been appended to
		// the bottom of it is a long way from the window.
		expect(thumb).toHaveAttribute('loading', 'lazy')
		// The link beside it is what carries the flipbook's name.
		expect(thumb).toHaveAttribute('alt', '')
	})

	it('falls back to the PNG on a row that has no SVG thumbnail', async () => {
		// A `time-capsule` save, a 2012 flipbook, or anything the backfill hasn't
		// reached: the server says so by sending null, and the card shows the picture.
		listFlipbooks.mockResolvedValue(page([flipbook('aaa', { thumbnail_svg_url: null })]))

		render(<GalleryPage />)

		const card = await screen.findByRole('link', { name: 'Flipbook aaa' })
		expect(card.querySelector('img')).toHaveAttribute('src', '/api/flipbooks/aaa/thumbnail')
	})

	it('lays the grid out with placeholder cards while a page is on its way', async () => {
		let land = (_: FlipbookPage) => {}
		listFlipbooks.mockReturnValue(new Promise<FlipbookPage>((resolve) => (land = resolve)))

		render(<GalleryPage />)

		// From the first paint, rather than from whenever the effect gets round to
		// asking: an empty grid with nothing in it is the one thing this is here to
		// prevent.
		expect(skeletons()).toHaveLength(20)
		expect(screen.queryByRole('heading', { name: 'Nothing here yet.' })).not.toBeInTheDocument()

		land(page([flipbook('aaa')]))

		await screen.findByRole('link', { name: 'Flipbook aaa' })
		expect(skeletons()).toHaveLength(0)
	})

	it('says what the placeholders cannot, for anyone not looking at them', async () => {
		listFlipbooks.mockResolvedValue(page([flipbook('aaa')]))

		render(<GalleryPage />)
		expect(screen.getByRole('status')).toHaveTextContent('Loading flipbooks')

		await screen.findByRole('link', { name: 'Flipbook aaa' })
		// The region stays; only what it says goes. A live region that comes and goes
		// with its own contents is one a reader may never get to announce.
		expect(screen.getByRole('status')).toHaveTextContent('')
	})

	it('names an untitled flipbook, so no link in the grid is nameless', async () => {
		listFlipbooks.mockResolvedValue(page([flipbook('aaa', { title: null })]))

		render(<GalleryPage />)
		expect(await screen.findByRole('link', { name: 'Untitled flipbook' })).toBeInTheDocument()
	})

	it('starts on Featured, and on All when the URL says so', async () => {
		listFlipbooks.mockResolvedValue(page([]))

		const { unmount } = render(<GalleryPage />)
		await waitFor(() => expect(listFlipbooks).toHaveBeenCalled())
		expect(listFlipbooks.mock.calls[0]![0]).toMatchObject({ view: 'featured' })

		unmount()
		listFlipbooks.mockClear()
		window.history.replaceState({}, '', '/?view=all')

		render(<GalleryPage />)
		await waitFor(() => expect(listFlipbooks).toHaveBeenCalled())
		expect(listFlipbooks.mock.calls[0]![0]).toMatchObject({ view: 'all' })
	})

	it('switches tabs, empties the grid and updates the URL', async () => {
		listFlipbooks.mockImplementation((params) =>
			Promise.resolve(
				(params as { view: string }).view === 'featured'
					? page([flipbook('featured-one')])
					: page([flipbook('all-one')]),
			),
		)

		render(<GalleryPage />)
		expect(await screen.findByRole('link', { name: 'Flipbook featured-one' })).toBeInTheDocument()

		await userEvent.click(screen.getByRole('tab', { name: 'All' }))

		expect(await screen.findByRole('link', { name: 'Flipbook all-one' })).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: 'Flipbook featured-one' })).not.toBeInTheDocument()
		expect(window.location.search).toBe('?view=all')
	})

	it('offers the empty state when there is nothing to show', async () => {
		listFlipbooks.mockResolvedValue(page([]))

		render(<GalleryPage />)
		expect(await screen.findByRole('heading', { name: 'Nothing here yet.' })).toBeInTheDocument()
	})

	it('apologises when the first page fails, and retries on request', async () => {
		listFlipbooks.mockRejectedValueOnce(new Error('nope'))

		render(<GalleryPage />)
		expect(
			await screen.findByRole('heading', { name: 'I definitely meant for this to happen.' }),
		).toBeInTheDocument()

		listFlipbooks.mockResolvedValue(page([flipbook('aaa')]))
		await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

		expect(await screen.findByRole('link', { name: 'Flipbook aaa' })).toBeInTheDocument()
	})

	it('draws a flipbook saved offline at the top of All, faded and said so', async () => {
		listFlipbooks.mockResolvedValue(page([flipbook('aaa')]))
		await queue('A cat')
		window.history.replaceState({}, '', '/?view=all')

		render(<GalleryPage />)

		const card = await screen.findByRole('link', {
			name: 'A cat — saved on this device, not published yet',
		})
		expect(card.closest(`.${cardStyles.pending}`)).not.toBeNull()

		// Above the listing, and its own drawing rather than the server's.
		const links = screen.getAllByRole('link')
		expect(links.indexOf(card)).toBeLessThan(
			links.indexOf(screen.getByRole('link', { name: 'Flipbook aaa' })),
		)
		expect(card.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAA')
	})

	it('keeps them out of Featured, which is a curated list of rows that exist', async () => {
		listFlipbooks.mockResolvedValue(page([flipbook('aaa')]))
		await queue('A cat')

		render(<GalleryPage />)

		await screen.findByRole('link', { name: 'Flipbook aaa' })
		expect(screen.queryByRole('link', { name: /A cat/ })).not.toBeInTheDocument()
	})

	it('stops showing a published one twice once the listing has caught up', async () => {
		const entry = await queue('A cat')
		await markPublished(entry.book.id, 'aaa')
		listFlipbooks.mockResolvedValue(page([flipbook('aaa')]))
		window.history.replaceState({}, '', '/?view=all')

		render(<GalleryPage />)

		// The row and the entry are the same flipbook now, and the row is the real one.
		expect(await screen.findByRole('link', { name: 'Flipbook aaa' })).toBeInTheDocument()
		expect(screen.getAllByRole('link', { name: /aaa|A cat/ })).toHaveLength(1)
	})

	it('says the internet is missing rather than blaming the server', async () => {
		setOnline(false)
		listFlipbooks.mockRejectedValue(new TypeError('Failed to fetch'))

		render(<GalleryPage />)

		expect(await screen.findByRole('heading', { name: 'You’re offline.' })).toBeInTheDocument()
		expect(
			screen.queryByRole('heading', { name: 'I definitely meant for this to happen.' }),
		).not.toBeInTheDocument()
	})

	it('takes the Featured/All toggle away offline, and leaves the create button', async () => {
		setOnline(false)
		listFlipbooks.mockRejectedValue(new TypeError('Failed to fetch'))

		render(<GalleryPage />)

		await screen.findByRole('heading', { name: 'You’re offline.' })
		// Two views of a listing that can't be fetched either way.
		expect(screen.queryByRole('tab', { name: 'All' })).not.toBeInTheDocument()
		// The one thing on this page that still works.
		expect(screen.getByRole('link', { name: /New/ })).toBeInTheDocument()
	})

	it('asks again by itself when the connection comes back', async () => {
		setOnline(false)
		listFlipbooks.mockRejectedValueOnce(new TypeError('Failed to fetch'))

		render(<GalleryPage />)
		await screen.findByRole('heading', { name: 'You’re offline.' })

		listFlipbooks.mockResolvedValue(page([flipbook('aaa')]))
		setOnline(true)
		window.dispatchEvent(new Event('online'))

		expect(await screen.findByRole('link', { name: 'Flipbook aaa' })).toBeInTheDocument()
	})

	it('keeps what it has when a later page fails, and offers a manual retry', async () => {
		listFlipbooks.mockResolvedValueOnce(page([flipbook('aaa')], 'cursor-1'))
		listFlipbooks.mockRejectedValueOnce(new Error('nope'))

		render(<GalleryPage />)
		await screen.findByRole('link', { name: 'Flipbook aaa' })

		// The observer is stubbed out, so nothing has asked for page two yet; the
		// second failure only arrives once it does.
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
	})
})

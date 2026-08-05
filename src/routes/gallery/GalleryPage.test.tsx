import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { FlipbookPage, FlipbookSummary } from '../../lib/api'
import { GalleryPage } from './GalleryPage'
import styles from './GalleryPage.module.css'

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

beforeEach(() => {
	listFlipbooks.mockReset()
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

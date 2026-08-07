import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	ApiError,
	getFlipbook,
	getFlipbookData,
	listFlipbooks,
	saveFlipbook,
	setFlipbookFlags,
} from './api'

const fetchMock = vi.fn()

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock)
	fetchMock.mockReset()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: '',
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as Response
}

function textResponse(body: string, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: '',
		json: async () => {
			throw new Error('not json')
		},
		text: async () => body,
	} as unknown as Response
}

describe('listFlipbooks', () => {
	it('builds the query the gallery needs', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))

		await listFlipbooks({ view: 'all', limit: 24, cursor: 'abc' })

		const [url] = fetchMock.mock.calls[0] as [string]
		expect(url).toBe('/api/flipbooks?view=all&limit=24&cursor=abc')
	})

	it('omits the cursor on the first page', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))

		await listFlipbooks({ view: 'featured', limit: 24, cursor: null })

		expect(fetchMock.mock.calls[0]![0]).toBe('/api/flipbooks?view=featured&limit=24')
	})

	it('passes the admin header through — it is what unhides NSFW rows', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))

		await listFlipbooks({ view: 'all', limit: 5 }, { headers: { Authorization: 'Bearer secret' } })

		const init = fetchMock.mock.calls[0]![1] as RequestInit
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
	})
})

describe('error handling', () => {
	it('reports the server’s own message', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'A flipbook needs a title.' }, 400))

		await expect(getFlipbook('abc')).rejects.toThrow('A flipbook needs a title.')
	})

	it('carries the status, which is how 401 and 404 sign the admin out', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404))

		const error = await setFlipbookFlags('abc', { nsfw: true }).catch((e: unknown) => e)

		expect(error).toBeInstanceOf(ApiError)
		expect((error as ApiError).status).toBe(404)
	})

	it('survives an error body that is not JSON', async () => {
		fetchMock.mockResolvedValue(textResponse('<html>502</html>', 502))

		await expect(getFlipbook('abc')).rejects.toBeInstanceOf(ApiError)
	})
})

describe('getFlipbookData', () => {
	it('returns the artwork as text, unparsed', async () => {
		// Legacy artwork arrives as text/plain and has to be JSON.parsed by the
		// caller; SVG is handed to the DOM parser. Either way, not here.
		fetchMock.mockResolvedValue(textResponse('{"layers":[]}'))

		await expect(getFlipbookData('/api/flipbooks/x/data')).resolves.toBe('{"layers":[]}')
	})
})

describe('saveFlipbook', () => {
	it('posts a form and returns the bare permalink from the body', async () => {
		fetchMock.mockResolvedValue(textResponse('/f/abc123\n'))

		const location = await saveFlipbook({
			title: 'A title',
			description: '',
			svg: '<svg/>',
			thumbnailDataUrl: 'data:image/png;base64,AAAA',
			cover: 3,
			nsfw: false,
		})

		expect(location).toBe('/f/abc123')

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('/saveflipbook')
		expect(init.method).toBe('POST')
		expect((init.headers as Record<string, string>)['Content-Type']).toBe(
			'application/x-www-form-urlencoded',
		)

		const body = new URLSearchParams(String(init.body))
		expect(body.get('title')).toBe('A title')
		expect(body.get('project')).toBe('<svg/>')
		expect(body.get('imgBase64')).toBe('data:image/png;base64,AAAA')
		// Which page the PNG is of, so the server cuts the SVG thumbnail from that
		// same page rather than picking one of its own.
		expect(body.get('cover')).toBe('3')
		expect(body.get('nsfw')).toBe('0')
	})

	it('sends nsfw as the 1 the server checks for', async () => {
		fetchMock.mockResolvedValue(textResponse('/f/x'))

		await saveFlipbook({
			title: 't',
			description: '',
			svg: '<svg/>',
			thumbnailDataUrl: '',
			cover: 0,
			nsfw: true,
		})

		expect(
			new URLSearchParams(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).get('nsfw'),
		).toBe('1')
	})

	it('names what a remix was drawn on top of', async () => {
		fetchMock.mockResolvedValue(textResponse('/f/x'))

		await saveFlipbook({
			title: 't',
			description: '',
			svg: '<svg/>',
			thumbnailDataUrl: '',
			cover: 0,
			nsfw: false,
			remixOf: 'original1',
		})

		const body = new URLSearchParams(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
		expect(body.get('remix_of')).toBe('original1')
	})

	it('leaves the field out altogether when it is not a remix', async () => {
		fetchMock.mockResolvedValue(textResponse('/f/x'))

		await saveFlipbook({
			title: 't',
			description: '',
			svg: '<svg/>',
			thumbnailDataUrl: '',
			cover: 0,
			nsfw: false,
		})

		// Absent rather than empty. This is the endpoint both deployments post to, and
		// a field that is only ever there when it means something is one fewer thing
		// for the other one to have an opinion about.
		const body = new URLSearchParams(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
		expect(body.has('remix_of')).toBe(false)
	})

	it('surfaces the 413 a too-large flipbook gets', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'Flipbook is too large to save.' }, 413))

		const error = await saveFlipbook({
			title: 't',
			description: '',
			svg: '<svg/>',
			thumbnailDataUrl: '',
			cover: 0,
			nsfw: false,
		}).catch((e: unknown) => e)

		expect((error as ApiError).status).toBe(413)
	})
})

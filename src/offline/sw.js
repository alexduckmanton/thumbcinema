/**
 * The service worker, which is the whole of "the site opens with no connection".
 *
 * The queue in `pending.ts` covers losing a connection in a tab that is already open;
 * this covers the other half — opening the site at all, cold, on a plane. Without it
 * the browser never reaches any of our code to ask.
 *
 * Hand-written, and it stays that way. Workbox is a build system and a runtime for a
 * problem that is, here, four cases: the shell, the files the build emitted, the one
 * file it emitted that is too big to fetch in advance, and everything else. This app has no offline reads to be clever about — the gallery is a
 * live listing and the artwork lives on the server — so there is no staleness policy to
 * get wrong and nothing to invalidate. See `docs/offline.md`.
 *
 * Both constants below are replaced at build time by `serviceWorkerPlugin` in
 * `vite.config.ts`, which is also where the list comes from: the bundle's own file
 * names, so it can't drift from what the build actually emitted. The version is a hash
 * of that list, which means a deploy that changed nothing leaves the cache alone and a
 * deploy that changed anything replaces it wholesale.
 */

const VERSION = '__VERSION__'
const PRECACHE = ['__PRECACHE__']

const CACHE = `thumbcinema-${VERSION}`
const PRECACHED = new Set(PRECACHE)

/*
 * `ignoreVary`, and it is not optional.
 *
 * A font is fetched in CORS mode even same-origin — see the `crossorigin` on the
 * preloads in index.html — so its request carries an `Origin` header that the plain
 * fetch behind `cache.addAll` did not. Any host that answers `Vary: Origin` therefore
 * stores a response the font request can never match, and the typefaces silently miss
 * offline while everything else works. Nothing precached here has more than one
 * representation to choose between, so there is nothing for Vary to be right about.
 */
const MATCH = { ignoreVary: true }

/**
 * The shell. Under `cleanUrls` there is no `/index.html` in the deployed filesystem at
 * all — that path is a redirect — so `/` is both what a navigation asks for and the
 * only spelling of it worth holding. See the rewrite note in CLAUDE.md.
 */
const SHELL = '/'

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			// Straight in, rather than waiting for every tab to close. The files are
			// content-hashed, so a page loaded from the previous version asking for one of
			// its own chunks gets it from the network, which it has by definition — the
			// only way to be here is to have just downloaded a new deploy.
			.then(() => self.skipWaiting()),
	)
})

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
			)
			.then(() => self.clients.claim()),
	)
})

self.addEventListener('fetch', (event) => {
	const request = event.request
	if (request.method !== 'GET') return

	const url = new URL(request.url)
	if (url.origin !== self.location.origin) return

	// The API is never cached, in either direction. A gallery listing is a live thing
	// and a stale one is worse than none; a save must fail honestly, because failing
	// honestly is what puts it in the queue.
	if (
		url.pathname === '/saveflipbook' ||
		url.pathname === '/api' ||
		url.pathname.startsWith('/api/')
	) {
		return
	}

	// Every deep link is the same shell — the app reads the path for itself. Network
	// first so a deploy lands the moment it is reachable; the cache is the fallback,
	// and offline it is the only answer.
	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(() => shell()))
		return
	}

	// The build's own output, which is content-hashed and cannot change under a name.
	if (PRECACHED.has(url.pathname)) {
		event.respondWith(fromCache(request))
		return
	}

	/*
	 * The rest of the build's output, which today is paper.js and nothing else: kept the
	 * first time it is asked for rather than downloaded in advance.
	 *
	 * It is ~210 KB — two thirds of everything the build emits — and only the two drawing
	 * routes ever ask for it, so precaching it would charge every first visit to the
	 * gallery for a page most of them won't open. One online visit to the drawing tool is
	 * what puts it here; until then `/create` offline says so plainly rather than
	 * half-loading. See `docs/offline.md`.
	 *
	 * Safe to keep forever and safe to serve without asking: everything under `/assets/`
	 * has a content hash in its name, so a file that changed has a different name and
	 * this entry is simply never asked for again. The version bump clears it out.
	 */
	if (url.pathname.startsWith('/assets/')) {
		event.respondWith(keep(request))
	}

	// Everything else — thumbnails, anything added later — goes to the network as if
	// none of this were here.
})

function fromCache(request) {
	return caches.match(request, MATCH).then((hit) => hit || fetch(request))
}

/** Cache first, and what the network answers is kept for next time. */
function keep(request) {
	return caches.open(CACHE).then((cache) =>
		cache.match(request, MATCH).then(
			(hit) =>
				hit ||
				fetch(request).then((response) => {
					// Not awaited: the page is waiting on this response and the write isn't
					// something it needs to have finished. A failed fetch rejects, which is
					// the honest answer — offline, this is a chunk that isn't here yet.
					if (response.ok) void cache.put(request, response.clone())
					return response
				}),
		),
	)
}

function shell() {
	return caches.match(SHELL, MATCH).then((hit) => hit || Response.error())
}

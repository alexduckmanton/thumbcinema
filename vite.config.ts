import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * Mounts the real API router into the dev server.
 *
 * `lib/router.js` is the entire back end and is shared verbatim with production —
 * on Vercel it is reached through `api/index.js`, here it is imported directly.
 * One router, two hosts, no drift, and `npm run dev` needs neither the Vercel CLI
 * nor a second process to proxy to.
 *
 * It's imported lazily so that a missing DATABASE_URL only breaks the routes that
 * actually touch Postgres; the drawing tool itself works without one.
 */
function apiPlugin(): Plugin {
	return {
		name: 'thumbcinema-api',
		configureServer(server) {
			server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
				const path = new URL(req.url ?? '/', 'http://localhost').pathname

				// `/f/:id.gif` is the flipbook as an animated GIF, and it is a rewrite
				// rather than a route of its own — vercel.json states the same one for
				// production. Restated here because the two hosts express it in different
				// languages; what must not drift is the destination.
				const gif = /^\/f\/([^/.]+)\.gif$/.exec(path)
				if (gif) req.url = `/api/flipbooks/${gif[1]}/gif`
				else if (path !== '/saveflipbook' && path !== '/api' && !path.startsWith('/api/')) return next()

				const { loadEnv } = await import('./scripts/lib/env.js')
				loadEnv()

				const { handleApi } = await import('./lib/router.js')
				try {
					await handleApi(req, res)
				} catch (err) {
					next(err as Error)
				}
			})
		},
	}
}

/**
 * Files under `public/` the site can't be drawn without.
 *
 * The two typefaces and the pictures the stylesheets reach for. Not the whole
 * directory: `pecita.woff` is half a megabyte of fallback for browsers that have no
 * woff2 and therefore can't run an ES module either, and `sadbrowser.html` is the page
 * those browsers get instead of the app — neither is ever fetched by a session that
 * has a service worker in it.
 */
const PRECACHED_PUBLIC = ['/fonts/inter-latin-variable.woff2', '/fonts/pecita.woff2']

/**
 * Generates `sw.js`, with the precache list filled in from the build's own output.
 *
 * The list has to be the bundle's file names, which are content-hashed and are not
 * knowable before the build — so the worker is a source file with two markers in it
 * (`src/offline/sw.js`) and this is where they're filled in. Anything else is a list
 * kept in step by hand, and a precache list that is wrong is an app that opens offline
 * missing a chunk.
 *
 * Everything the build emitted is precached **except paper.js**, which is cached the
 * first time it is actually fetched — see the runtime branch in `sw.js`. It is ~210 KB,
 * it is two thirds of everything the build emits, and the gallery deliberately never
 * downloads it; making every first visit pay for it in the background to insure against
 * a visit to `/create` on a plane is the wrong way round. One online visit to the
 * drawing tool is what puts it on the device, and until then `/create` offline says so
 * rather than half-loading. Nothing here touches the chunk graph either way.
 */
function serviceWorkerPlugin(): Plugin {
	return {
		name: 'thumbcinema-sw',
		apply: 'build',

		generateBundle(_options, bundle) {
			const emitted = Object.entries(bundle)
				.filter(([name, output]) => {
					if (!name.endsWith('.js') && !name.endsWith('.css')) return false
					// By the chunk's name rather than by its file name, which carries a hash:
					// this is the `paper` manual chunk declared below, and nothing else.
					return !(output.type === 'chunk' && output.name === 'paper')
				})
				.map(([name]) => `/${name}`)

			const images = readdirSync('public/images')
				.filter((name) => name.endsWith('.png'))
				.map((name) => `/images/${name}`)

			// `/` rather than `/index.html`: under cleanUrls the deployed filesystem has no
			// such file, that path is a 308, and `cache.addAll` rejects on a redirect.
			const precache = ['/', ...emitted.sort(), ...PRECACHED_PUBLIC, ...images.sort()]

			// A hash of the list, so the cache name changes when — and only when — the
			// thing it holds does.
			const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)

			const source = readFileSync('src/offline/sw.js', 'utf8')
			const filled = source
				.replace("'__VERSION__'", JSON.stringify(version))
				.replace("['__PRECACHE__']", JSON.stringify(precache))

			// Both markers, or the worker ships claiming to cache a file called
			// `__PRECACHE__` and offline mode silently isn't one.
			if (filled.includes('__VERSION__') || filled.includes('__PRECACHE__')) {
				throw new Error('sw.js: the build markers have moved. See serviceWorkerPlugin.')
			}

			this.emitFile({ type: 'asset', fileName: 'sw.js', source: filled })
		},
	}
}

export default defineConfig({
	plugins: [react(), apiPlugin(), serviceWorkerPlugin()],

	server: {
		// The port the old dev server used, and the one .claude/launch.json expects.
		port: 3000,
		strictPort: true,
	},

	build: {
		outDir: 'dist',
		// The drawing engine is ~1 MB of paper.js and only two of the four routes
		// need it. Keeping it in its own chunk means the gallery — the page most
		// visits land on — never downloads it.
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/paper')) return 'paper'
					return undefined
				},
			},
		},
	},

	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./vitest.setup.ts'],
		// `lib/` is the back end the rewrite didn't touch and has never had tests. The
		// one exception is `lib/thumbnail.js`, which is new, is a hand-written scanner
		// over two file formats, and is exactly the kind of thing that has to be
		// exercised rather than read.
		include: ['src/**/*.test.{ts,tsx}', 'lib/**/*.test.js'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{ts,tsx}'],
			exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
		},
	},
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

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
				if (path !== '/saveflipbook' && path !== '/api' && !path.startsWith('/api/')) return next()

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

export default defineConfig({
	plugins: [react(), apiPlugin()],

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

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/*
 * Object URLs, which jsdom hasn't got.
 *
 * A queued flipbook hands its artwork to the rest of the app as a `blob:` URL — see
 * `src/offline/pending.ts` — so anything that renders one reaches for these. The
 * counter is what makes them distinguishable, which is the only property any test
 * cares about.
 */
let objectUrls = 0
URL.createObjectURL = () => `blob:thumbcinema/${++objectUrls}`
URL.revokeObjectURL = () => {}

afterEach(() => {
	cleanup()
	window.localStorage.clear()
})

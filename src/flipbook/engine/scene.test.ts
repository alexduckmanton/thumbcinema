import { describe, expect, it } from 'vitest'

import { LEGACY_PAGE_SIZE, SQUARE_PAGE_SIZE } from './constants'
import { assertLeadingGroups, LEADING_SYSTEM_GROUPS, pageSizeFromSvg } from './formats'
import { Scene } from './scene'

/*
 * The only test in the suite that builds a real paper.js project.
 *
 * Everything else about the two formats is exercised against hand-written SVG, which
 * is the right shape for a parser but leaves the *writer* untested: nothing would
 * notice if `exportSVG()` stopped stating a 640x640 root, and the artwork is the
 * authority on its own shape — a root that says 640x360 makes a square flipbook
 * legacy for ever, on the card, on the playback page and in every remix of it.
 *
 * What it costs is a 2D context, which jsdom hasn't got. paper reaches for one as it
 * loads rather than when a view is made, so the stub goes on the prototype before the
 * import below rather than on an element, and paper is imported inside the test for
 * the same reason. Nothing here draws — `exportSVG` is pure geometry — so the context
 * only has to exist and absorb calls.
 */
function stubCanvasContext(): void {
	const absorb = () => undefined
	// biome-ignore lint/suspicious/noExplicitAny: standing in for a whole context type
	;(HTMLCanvasElement.prototype as any).getContext = function stub(this: HTMLCanvasElement) {
		const properties: Record<string, unknown> = {
			canvas: this,
			measureText: () => ({ width: 0 }),
		}
		return new Proxy(properties, {
			get: (target, key) => (key in target ? target[key as string] : absorb),
			set: (target, key, value) => {
				target[key as string] = value
				return true
			},
		})
	}
}
stubCanvasContext()

async function sceneOn(page = SQUARE_PAGE_SIZE): Promise<Scene> {
	const paper = (await import('paper/dist/paper-core')).default
	const canvas = document.createElement('canvas')
	document.body.append(canvas)
	return new Scene(canvas, paper as never, page)
}

function exportRoot(scene: Scene): SVGElement {
	return scene.project.exportSVG({ asString: false }) as SVGElement
}

describe('the exported root', () => {
	it('states the square page, so a square flipbook reads back square', async () => {
		const svg = exportRoot(await sceneOn(SQUARE_PAGE_SIZE))

		expect(svg.getAttribute('viewBox')).toBe('0,0,640,640')
		expect(svg.getAttribute('width')).toBe('640')
		expect(svg.getAttribute('height')).toBe('640')
	})

	it('states the legacy page, which is the shape the whole archive is', async () => {
		const svg = exportRoot(await sceneOn(LEGACY_PAGE_SIZE))

		expect(svg.getAttribute('viewBox')).toBe('0,0,640,360')
		expect(svg.getAttribute('width')).toBe('640')
		expect(svg.getAttribute('height')).toBe('360')
	})

	/*
	 * The remix path. The engine is built the moment the canvas is in the DOM, before
	 * the artwork it is about to open has arrived, so a legacy remix starts on the
	 * square default and is corrected by `resize`. If that correction stopped reaching
	 * the export, a remix of a 16:9 flipbook would save as a square one.
	 */
	it('follows a resize, so a remix keeps the shape it was drawn at', async () => {
		const scene = await sceneOn(SQUARE_PAGE_SIZE)
		scene.resize(LEGACY_PAGE_SIZE)

		expect(exportRoot(scene).getAttribute('viewBox')).toBe('0,0,640,360')
	})

	it.each([
		['square', SQUARE_PAGE_SIZE],
		['legacy', LEGACY_PAGE_SIZE],
	])('is read back as the %s page it was written from', async (_name, page) => {
		const svg = new XMLSerializer().serializeToString(exportRoot(await sceneOn(page)))

		expect(pageSizeFromSvg(svg)).toEqual(page)
	})

	/*
	 * `assertLeadingGroups` is checked elsewhere against hand-written SVG, which proves
	 * the assertion and not the thing it is asserting about. This is the one place the
	 * count comes from paper itself: three scaffolding layers, then one group per page.
	 */
	it('opens with exactly the system groups the archive was written with', async () => {
		const scene = await sceneOn()

		expect(exportRoot(scene).children).toHaveLength(LEADING_SYSTEM_GROUPS + 1)

		scene.appendPage()
		expect(() => assertLeadingGroups(exportRoot(scene), 2)).not.toThrow()
	})
})

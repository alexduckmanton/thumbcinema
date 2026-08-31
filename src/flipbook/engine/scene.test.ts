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

/**
 * The scene's own export, which pins the root to the page.
 *
 * Deliberately not `project.exportSVG()`. The view covers the whole 2× drawable extent
 * now, and paper's default is the view's bounds — so the raw export states 1280 and wraps
 * every layer in one group. That is what `Scene.exportRoot` exists to prevent and what the
 * `bounds` case below proves it still does.
 */
function exportRoot(scene: Scene): SVGElement {
	return scene.exportRoot()
}

/** A stroke, in project units. Negative coordinates are the surround past the frame. */
function stroke(scene: Scene, from: [number, number], to: [number, number]): void {
	const { Path, Point, Color } = scene.scope
	const path = new Path.Line(new Point(from[0], from[1]), new Point(to[0], to[1]))
	path.strokeColor = new Color('#444')
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

	/*
	 * The whole reason `exportRoot` is a method rather than a call. Left to itself paper
	 * exports the view's bounds, which is the drawable extent — and the result is wrong in
	 * two ways at once, either of which would reach production looking like a valid file.
	 * Stated here so a future change that drops the `bounds` option fails loudly.
	 */
	it('is not what the raw export would give, which is the point of it', async () => {
		const scene = await sceneOn(SQUARE_PAGE_SIZE)
		const raw = scene.project.exportSVG({ asString: false }) as SVGElement

		// The extent's shape, so every square flipbook would read back twice its size.
		expect(raw.getAttribute('viewBox')).toBe('0,0,1280,1280')
		// And one group for the whole project, so the layer-per-page format is gone.
		expect(raw.children).toHaveLength(1)
	})
})

/*
 * The surround: everything about the fact that you can draw outside the page.
 *
 * The failure mode is a file that looks entirely correct — the right shape, the right
 * groups, the right ink — and is several times bigger than it needs to be, or is quietly
 * a different page shape for ever. None of that is visible in a browser.
 */
describe('the drawable surround', () => {
	it('leaves the exported root alone, however far outside the page you draw', async () => {
		const scene = await sceneOn(SQUARE_PAGE_SIZE)
		stroke(scene, [-300, -300], [-200, -200])
		stroke(scene, [900, 900], [950, 950])

		const svg = exportRoot(scene)

		expect(svg.getAttribute('viewBox')).toBe('0,0,640,640')
		expect(svg.getAttribute('width')).toBe('640')
		expect(svg.getAttribute('height')).toBe('640')
		expect(() => assertLeadingGroups(svg, 1)).not.toThrow()
	})

	it('writes the overspill unless it is taken out, which is why the save takes it out', async () => {
		const scene = await sceneOn(SQUARE_PAGE_SIZE)
		stroke(scene, [100, 100], [200, 200])
		stroke(scene, [-300, -300], [-200, -200])

		// The viewBox hides it. It is still in the file, and still in the ~2.5 MB the
		// save request is capped at.
		expect(exportRoot(scene).querySelectorAll('path')).toHaveLength(2)

		const trimmed = scene.withoutOverspill(() => exportRoot(scene))
		expect(trimmed.querySelectorAll('path')).toHaveLength(1)
	})

	it('keeps a stroke that crosses the frame, and clips it on the way back in', async () => {
		const scene = await sceneOn(SQUARE_PAGE_SIZE)
		stroke(scene, [-100, 320], [100, 320])

		// Whole rather than cut: the geometry that survives is the geometry that was
		// drawn, and every renderer of this file already clips to the root.
		expect(scene.withoutOverspill(() => exportRoot(scene)).querySelectorAll('path')).toHaveLength(1)
	})

	it('puts the overspill back, in the order it was in', async () => {
		const scene = await sceneOn(SQUARE_PAGE_SIZE)
		stroke(scene, [-300, -300], [-200, -200])
		stroke(scene, [100, 100], [200, 200])
		stroke(scene, [900, 900], [950, 950])

		const before = scene.activeLayer.children.map((item) => item.id)
		scene.withoutOverspill(() => exportRoot(scene))

		expect(scene.activeLayer.children.map((item) => item.id)).toEqual(before)
	})

	it('puts it back even when the export throws', async () => {
		const scene = await sceneOn(SQUARE_PAGE_SIZE)
		stroke(scene, [-300, -300], [-200, -200])

		expect(() =>
			scene.withoutOverspill(() => {
				throw new Error('nope')
			}),
		).toThrow('nope')

		// A save that fails must not also lose the drawing it failed to save.
		expect(scene.activeLayer.children).toHaveLength(1)
	})
})

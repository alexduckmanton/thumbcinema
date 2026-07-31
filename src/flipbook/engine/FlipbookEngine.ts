import { Store } from '../../lib/store'
import { freeze, play } from './animations'
import { CANVAS_HEIGHT, CANVAS_WIDTH, FPS, PENCIL_COLOR } from './constants'
import {
	assertLeadingGroups,
	parseLegacyPages,
	parseSvgPages,
	strokeWidthFor,
} from './formats'
import {
	advanceCircleplay,
	circleplayInitial,
	circleplayPage,
	type CircleplayState,
} from './geometry'
import { Scene } from './scene'
import { Selection } from './selection'
import { EraserTool } from './tools/eraser'
import { DEFAULT_PENCIL_WIDTH, PencilTool } from './tools/pencil'
import { PushTool } from './tools/push'
import { TransformTool } from './tools/transform'
import type { ModalTool, ModalToolId } from './tools/types'

export type PlaybackMode = 'none' | 'play' | 'circleplay'
export type EngineMode = 'create' | 'playback'

export interface PageState {
	/** Stable across inserts and deletes, so React keys don't reshuffle canvases. */
	readonly id: number
	/** How much is drawn on this page. The busiest page becomes the saved thumbnail. */
	readonly segments: number
}

export interface FlipbookState {
	pages: PageState[]
	activePage: number

	/** Null on the playback page, which has no drawing tools at all. */
	tool: ModalToolId | null
	/** Which of the transform button's two modes is showing: 0 transform, 1 push. */
	transformIndex: 0 | 1

	pencilWidth: number
	playback: PlaybackMode

	loading: boolean
	/** 0–1 while a saved flipbook is being replayed into the tool. */
	loadProgress: number

	/** True while a page animation is playing. Input is ignored until it finishes. */
	busy: boolean
}

export interface EngineOptions {
	mode: EngineMode
	isTouch: boolean
	/** Playback only: replays the flipbook once it has finished loading. */
	autoPlay?: boolean
}

/**
 * The drawing tool.
 *
 * Owns a paper.js scene, the tools that act on it, and just enough derived state
 * for React to render a toolbar and a page strip around it. Nothing in here imports
 * React: the engine is driven by method calls and reports back through `store`,
 * which is what lets the fiddly parts be exercised without rendering anything.
 *
 * Two modes share it. `create` is the full tool; `playback` skips the tools, the
 * page thumbnails and the onion skin entirely, which is most of why a 200-page
 * archive flipbook opens quickly.
 */
export class FlipbookEngine {
	readonly store: Store<FlipbookState>
	readonly mode: EngineMode

	private readonly scene: Scene
	private readonly selection: Selection

	private readonly pencil: PencilTool
	private readonly eraser: EraserTool | null
	private readonly transform: TransformTool | null
	private readonly push: PushTool | null

	/** One canvas per page, registered by React as the strip renders. */
	private readonly thumbnails = new Map<number, HTMLCanvasElement>()

	private nextPageId = 1
	private playTimer: number | null = null
	private circleplay: CircleplayState | null = null
	private destroyed = false

	/** Held while alt or shift is down; the transform tool reads them on every event. */
	private modifiers = { alt: false, shift: false }

	constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
		this.mode = options.mode

		this.scene = new Scene(canvas)
		this.selection = new Selection(this.scene)

		this.store = new Store<FlipbookState>({
			pages: [{ id: this.nextPageId++, segments: 0 }],
			activePage: 0,
			tool: options.mode === 'create' ? 'pencil' : null,
			transformIndex: 0,
			pencilWidth: DEFAULT_PENCIL_WIDTH,
			playback: 'none',
			loading: false,
			loadProgress: 0,
			busy: false,
		})

		// The playback page keeps a pencil — it's what redraws 2012 flipbooks stroke
		// by stroke — but not an interactive one.
		this.pencil = new PencilTool(this.scene, this.selection, {
			interactive: options.mode === 'create',
			width: options.mode === 'create' ? DEFAULT_PENCIL_WIDTH : 2,
		})

		if (options.mode === 'create') {
			this.eraser = new EraserTool(this.scene, this.selection)
			this.transform = new TransformTool(this.scene, this.selection, {
				isDuplicating: () => this.modifiers.alt,
				isExtending: () => this.modifiers.shift,
				respace: (path) => this.pencil.finish(path),
			})
			this.push = new PushTool(this.scene, this.selection, {
				showDots: !options.isTouch,
				respace: (path) => this.pencil.finish(path),
				onExit: () => this.setTransformIndex(0),
			})

			this.pencil.init()
			this.pencil.activate()

			// Down on the canvas, up on the document: a stroke that runs off the edge
			// of the canvas still releases somewhere, and its page thumbnail still has
			// to be redrawn. Listening for mouseup on the canvas alone missed those.
			canvas.addEventListener('mousedown', this.handlePointerDown)
			canvas.addEventListener('touchstart', this.handlePointerDown, { passive: true })
			document.addEventListener('mouseup', this.handlePointerUp)
			document.addEventListener('touchend', this.handlePointerUp)
		} else {
			this.eraser = null
			this.transform = null
			this.push = null
		}
	}

	destroy(): void {
		this.destroyed = true
		this.stopPlayback()

		const canvas = this.scene.canvas
		canvas.removeEventListener('mousedown', this.handlePointerDown)
		canvas.removeEventListener('touchstart', this.handlePointerDown)
		document.removeEventListener('mouseup', this.handlePointerUp)
		document.removeEventListener('touchend', this.handlePointerUp)

		this.scene.destroy()
	}

	// --- page thumbnails -----------------------------------------------------

	/**
	 * React hands over each page's `<canvas>` as it mounts.
	 *
	 * Only the create page has a strip, so on playback this is never called and the
	 * per-page canvases are never allocated — 640×360 of backing store each, which
	 * on a long archive flipbook is the difference between tens of megabytes and none.
	 */
	registerThumbnail(pageId: number, element: HTMLCanvasElement | null): void {
		if (!element) {
			this.thumbnails.delete(pageId)
			return
		}

		// Deliberately does *not* size the canvas. Assigning `width` resets a
		// canvas's bitmap, and React re-runs an inline ref callback on every render
		// — so sizing it here wiped every page thumbnail whenever anything at all
		// changed. The size is a JSX attribute on the element instead.
		this.thumbnails.set(pageId, element)

		// A duplicated page's thumbnail is seeded from the page it was copied from,
		// here rather than on the next capture, so it is never briefly blank.
		if (this.seedNext?.pageId === pageId) {
			element.getContext('2d')?.drawImage(this.seedNext.source, 0, 0, element.width, element.height)
			this.seedNext = null
		}
	}

	/** Copies the live canvas onto the active page's thumbnail. */
	captureActivePage(): void {
		if (this.mode !== 'create') return

		const page = this.store.snapshot.pages[this.scene.activePage]
		const target = page ? this.thumbnails.get(page.id) : undefined
		if (!target) return

		this.scene.hideOnion()
		this.selection.hideChrome()
		this.scene.redraw()

		const context = target.getContext('2d')
		if (context) {
			context.clearRect(0, 0, target.width, target.height)
			// Scaled explicitly. paper.js sizes the drawing canvas's backing store by
			// the device pixel ratio, so on a retina screen it is 1280×720 behind a
			// 640×360 element — and an unscaled drawImage would copy the top-left
			// quarter of it at double size.
			context.drawImage(this.scene.canvas, 0, 0, target.width, target.height)
		}

		this.selection.showChrome()
		this.scene.showOnion()
		this.scene.redraw()
	}

	// --- tools ---------------------------------------------------------------

	private get activeTool(): ModalTool | null {
		const { tool, transformIndex } = this.store.snapshot
		if (tool === 'pencil') return this.pencil
		if (tool === 'eraser') return this.eraser
		if (tool === 'transform') return transformIndex === 1 ? this.push : this.transform
		return null
	}

	/**
	 * Switches modal tool.
	 *
	 * Clicking the tool you're already on is a no-op — except for transform, which
	 * cycles into push mode and back, and is what makes it one button rather than two.
	 */
	selectTool(id: ModalToolId): void {
		if (this.store.snapshot.busy) return

		if (this.store.snapshot.tool === id) {
			if (id === 'transform') this.setTransformIndex(this.store.snapshot.transformIndex === 0 ? 1 : 0)
			return
		}

		this.activeTool?.deactivate()
		this.store.set({ tool: id, transformIndex: 0 })

		const next = this.activeTool
		if (!next?.init()) {
			// Refused. Nothing is holding the pointer now, so fall back to the pencil.
			this.store.set({ tool: 'pencil', transformIndex: 0 })
			this.pencil.init()
			this.pencil.activate()
			return
		}
		next.activate()
		this.scene.redraw()
	}

	/** Transform ⇄ push. Push refuses when there's no selection, so it flips back. */
	private setTransformIndex(index: 0 | 1): void {
		const previous = this.activeTool
		this.store.set({ transformIndex: index })

		const next = this.activeTool
		if (!next) return

		if (!next.init()) {
			this.store.set({ transformIndex: index === 1 ? 0 : 1 })
			return
		}

		previous?.deactivate()
		next.activate()
		this.scene.redraw()
	}

	setPencilWidth(width: number): void {
		this.pencil.setWidth(width)
		this.store.set({ pencilWidth: this.pencil.width })
	}

	setModifiers(modifiers: { alt?: boolean; shift?: boolean }): void {
		if (modifiers.alt !== undefined && modifiers.alt !== this.modifiers.alt) {
			this.modifiers.alt = modifiers.alt
			if (this.store.snapshot.tool === 'transform' && this.store.snapshot.transformIndex === 0) {
				this.selection.setDuplicating(modifiers.alt)
				this.scene.redraw()
			}
		}
		if (modifiers.shift !== undefined) this.modifiers.shift = modifiers.shift
	}

	deleteSelection(): void {
		this.selection.deleteSelected()
		this.captureActivePage()
	}

	clearSelection(): void {
		this.selection.clear()
		this.captureActivePage()
	}

	/**
	 * One step back, as it has been since 2013.
	 *
	 * `draw` restores the page, `transform` restores the selection after a push.
	 * Swapping rather than replacing means undo is its own redo.
	 */
	undo(): void {
		const kind = this.scene.snapshotKind
		if (!kind) return

		if (kind === 'draw') {
			this.scene.swapWithSnapshot(this.scene.activeLayer)
			this.scene.activeLayer.activate()
		} else {
			this.scene.swapWithSnapshot(this.selection.layer)

			if (this.store.snapshot.transformIndex === 1) {
				// Push holds live references to the segments it was moving; rebuild it.
				this.push?.deactivate()
				this.push?.init()
				this.push?.activate()
			} else {
				this.selection.reset()
			}
		}

		this.scene.redraw()
		this.captureActivePage()
	}

	// --- pages ---------------------------------------------------------------

	get pageCount(): number {
		return this.store.snapshot.pages.length
	}

	async addBlankPage(): Promise<void> {
		if (this.store.snapshot.busy) return

		this.pause()
		this.captureActivePage()

		const from = this.scene.activePage
		this.selection.hideChrome()
		const index = this.scene.insertBlankPage(from)
		this.selection.showChrome()

		this.insertPageState(index, 0)
		this.refreshOnion()

		await this.animateInsert(from, 'newPage')
	}

	async duplicatePage(): Promise<void> {
		if (this.store.snapshot.busy) return

		this.pause()
		this.captureActivePage()

		const from = this.scene.activePage
		this.selection.hideChrome()
		this.scene.duplicatePage(from)
		this.selection.showChrome()

		// The copy takes the current page's place; you carry on drawing on the original.
		const source = this.thumbnailFor(from)
		this.insertPageState(from, this.store.snapshot.pages[from]?.segments ?? 0, source)
		this.refreshOnion()

		await this.animateInsert(from, 'nudge')
	}

	async deletePage(): Promise<void> {
		if (this.store.snapshot.busy) return

		this.pause()

		const index = this.scene.activePage
		const pages = this.store.snapshot.pages
		const doomed = pages[index]
		if (!doomed) return

		// The strip is never empty: deleting the only page leaves a fresh one behind.
		if (pages.length === 1) {
			this.scene.insertBlankPage(0)
			this.store.set({ pages: [...pages, { id: this.nextPageId++, segments: 0 }], activePage: 1 })
		}

		const canvas = this.thumbnails.get(doomed.id)
		const atEnd = index === this.store.snapshot.pages.length - 1
		const sibling = atEnd ? index - 1 : index + 1

		this.setBusy(true)

		// Everything on the far side of the gap is pinned so it doesn't slide while
		// the deleted page is still falling.
		const pinned = atEnd ? this.freezeRange(0, index) : this.freezeRange(index + 1, this.pageCount)

		this.scene.setActivePage(sibling)
		this.store.set({ activePage: sibling })

		const siblingCanvas = this.thumbnailFor(sibling)
		const unpinSibling = siblingCanvas ? freeze(siblingCanvas) : null
		const arriving = siblingCanvas
			? play(siblingCanvas, atEnd ? 'focusPrevThumb' : 'focusNextThumb')
			: Promise.resolve()

		// The deleted page holds its last frame: it's about to be removed, and
		// letting it snap back into view for one frame first would be a flicker.
		if (canvas) await play(canvas, 'deletePage', { hold: true })
		await arriving
		unpinSibling?.()

		this.scene.removePage(index)
		this.thumbnails.delete(doomed.id)

		const remaining = this.store.snapshot.pages.filter((page) => page.id !== doomed.id)
		this.store.set({ pages: remaining, activePage: this.scene.activePage })

		for (const undo of pinned) undo()
		this.setBusy(false)

		this.refreshOnion()
		this.scene.redraw()
	}

	goToPage(index: number): void {
		if (this.store.snapshot.busy) return
		if (index < 0 || index >= this.pageCount) return
		if (index === this.scene.activePage) return

		this.selection.clear()
		this.scene.setActivePage(index, { playing: this.store.snapshot.playback !== 'none' })
		this.scene.clearSnapshot()
		this.store.set({ activePage: index })

		this.refreshOnion()
		this.scene.redraw()
	}

	nextPage(): void {
		this.goToPage(this.scene.activePage + 1)
	}

	previousPage(): void {
		this.goToPage(this.scene.activePage - 1)
	}

	firstPage(): void {
		this.goToPage(0)
	}

	// --- playback ------------------------------------------------------------

	togglePlay(): void {
		if (this.store.snapshot.playback === 'play') return this.pause()
		if (this.pageCount < 2) return

		this.stopPlayback()
		this.store.set({ playback: 'play' })
		this.scene.clearOnion()
		this.scheduleFrame()
	}

	toggleCircleplay(): void {
		if (this.store.snapshot.playback === 'circleplay') return this.pause()
		if (this.pageCount < 2) return

		this.stopPlayback()
		this.store.set({ playback: 'circleplay' })
		this.scene.clearOnion()

		this.circleplay = circleplayInitial(this.scene.activePage)
		document.addEventListener('mousemove', this.handleCircleplayMove)
	}

	pause(): void {
		if (this.store.snapshot.playback === 'none') return

		this.stopPlayback()
		this.store.set({ playback: 'none' })
		this.refreshOnion()
		this.scene.redraw()
	}

	private stopPlayback(): void {
		if (this.playTimer !== null) {
			window.clearTimeout(this.playTimer)
			this.playTimer = null
		}
		if (this.circleplay) {
			document.removeEventListener('mousemove', this.handleCircleplayMove)
			this.circleplay = null
		}
	}

	private scheduleFrame(): void {
		this.playTimer = window.setTimeout(() => {
			if (this.destroyed || this.store.snapshot.playback !== 'play') return

			const next = this.scene.activePage + 1
			this.jumpTo(next >= this.pageCount ? 0 : next)
			this.scheduleFrame()
		}, 1000 / FPS)
	}

	private handleCircleplayMove = (event: MouseEvent): void => {
		if (!this.circleplay) return

		this.circleplay = advanceCircleplay(
			this.circleplay,
			{ x: event.pageX, y: event.pageY },
			this.pageCount,
		)

		const page = circleplayPage(this.circleplay.timeline)
		if (page !== null && page < this.pageCount) this.jumpTo(page)
	}

	/** Page change during playback: no selection handling, no onion, no undo reset. */
	private jumpTo(index: number): void {
		if (index === this.scene.activePage) return

		this.scene.setActivePage(index, { playing: true })
		this.store.set({ activePage: index })
		this.scene.redraw()
	}

	// --- saving --------------------------------------------------------------

	/**
	 * The two things a save needs: the artwork, and a picture of it.
	 *
	 * The thumbnail is taken from the busiest page rather than the first, on the
	 * grounds that a flipbook's first page is very often nearly empty. (The 2013
	 * code meant to do this and couldn't — it counted segments by reading `.length`
	 * off a paper Layer, which is undefined, so every page scored zero and the
	 * "busiest" was always page one.)
	 */
	exportForSave(): { svg: string; thumbnailDataUrl: string } {
		this.selection.clear()

		const thumbnailDataUrl = this.captureCover()

		const svg = this.exportSvgElement()
		return { svg: new XMLSerializer().serializeToString(svg), thumbnailDataUrl }
	}

	exportSvgElement(): SVGElement {
		const svg = this.scene.project.exportSVG({ asString: false }) as SVGElement
		assertLeadingGroups(svg, this.pageCount)
		return svg
	}

	/**
	 * The flipbook as it stands, minus the page being drawn on.
	 *
	 * Used only by the crash handler. The page in hand is the one most likely to
	 * contain whatever just threw, so it's dropped rather than saved — losing one
	 * page is a far better outcome than restoring a file that crashes again.
	 *
	 * No `assertLeadingGroups` here: the page count deliberately no longer matches,
	 * and a throw inside the crash handler would take the recovery with it.
	 */
	exportForRecovery(): string {
		this.scene.activeLayer.remove()
		return new XMLSerializer().serializeToString(this.scene.project.exportSVG({ asString: false }) as SVGElement)
	}

	/**
	 * A PNG of the page that gets to represent the flipbook in the gallery.
	 *
	 * Drawn through an offscreen canvas at exactly 640×360 rather than straight off
	 * the live one: paper scales its backing store by the device pixel ratio, so
	 * `toDataURL` there would produce a 1280×720 image on a retina screen and a
	 * 640×360 one elsewhere. Every stored thumbnail is the same size regardless of
	 * the machine it was drawn on.
	 */
	private captureCover(): string {
		const original = this.scene.activePage
		const cover = this.busiestPage()

		this.scene.setActivePage(cover, { playing: true })
		this.scene.hideOnion()
		this.scene.redraw()

		const frame = document.createElement('canvas')
		frame.width = CANVAS_WIDTH
		frame.height = CANVAS_HEIGHT

		const context = frame.getContext('2d')
		if (context) {
			// A flipbook is ink on paper, and PNG has no paper unless you paint it.
			context.fillStyle = '#fff'
			context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
			context.drawImage(this.scene.canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
		}

		this.scene.setActivePage(original, { playing: true })
		this.refreshOnion()
		this.scene.redraw()

		return frame.toDataURL('image/png')
	}

	private busiestPage(): number {
		const pages = this.store.snapshot.pages
		let best = 0
		for (let i = 1; i < pages.length; i++) {
			if ((pages[i]?.segments ?? 0) > (pages[best]?.segments ?? 0)) best = i
		}
		return best
	}

	// --- loading -------------------------------------------------------------

	/**
	 * Replays a saved flipbook into the tool.
	 *
	 * Work is done in frame-sized slices rather than one page per `setTimeout(0)`,
	 * which is what the 2013 loader did: a 200-page flipbook cost 200 round trips
	 * through the task queue, most of a frame each, and the spinner sat there for
	 * seconds with the main thread mostly idle. Here each frame does as many pages
	 * as fit in its budget.
	 */
	async loadSvg(text: string, signal?: AbortSignal): Promise<void> {
		const pages = parseSvgPages(text)
		this.store.set({ loading: true, loadProgress: 0 })

		await this.replay(pages.length, signal, (index) => {
			const page = pages[index]
			if (!page) return

			for (const stroke of page.strokes) {
				const item = this.scene.activeLayer.importSVG(stroke as SVGElement, { insert: true })
				if (!item) continue

				item.strokeWidth = strokeWidthFor(stroke, page.groupStrokeWidth)

				// SVG's default fill is black, and it's the `<g>` that carries
				// `fill="none"` — so a stroke imported on its own comes back filled,
				// and every closed-ish loop in a drawing renders as a solid blob.
				item.fillColor = null
			}

			// Imported children lose the presentation attributes their group carried
			// — stroke and stroke-width live on the `<g>`, not on each polyline — so
			// the ink colour and cap style are reapplied per page.
			this.scene.activeLayer.strokeCap = 'round'
			this.scene.activeLayer.strokeJoin = 'round'
			this.scene.activeLayer.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
		})
	}

	async loadLegacy(text: string, signal?: AbortSignal): Promise<void> {
		const pages = parseLegacyPages(text)
		this.store.set({ loading: true, loadProgress: 0 })

		await this.replay(pages.length, signal, (index) => {
			for (const stroke of pages[index] ?? []) {
				this.pencil.begin()
				for (const point of stroke) {
					this.pencil.extend(new this.scene.scope.Point(point.x, point.y))
				}
				this.pencil.end()
			}
		})
	}

	private async replay(
		total: number,
		signal: AbortSignal | undefined,
		drawPage: (index: number) => void,
	): Promise<void> {
		/** Long enough to get real work done, short enough to leave the frame time. */
		const BUDGET_MS = 8

		const pages: PageState[] = []
		let deadline = performance.now() + BUDGET_MS

		for (let index = 0; index < total; index++) {
			if (signal?.aborted || this.destroyed) return

			if (index > 0) this.scene.insertBlankPage(index - 1)
			drawPage(index)

			pages.push({ id: this.nextPageId++, segments: countSegments(this.scene.activeLayer) })

			// Yield when the budget is spent, not once per page. The 2013 loader did
			// one page per setTimeout(0), so a 200-page flipbook cost 200 trips
			// through the task queue with the main thread idle for most of each.
			if (performance.now() >= deadline) {
				this.store.set({ loadProgress: (index + 1) / total })
				await nextFrame()
				deadline = performance.now() + BUDGET_MS
			}
		}

		if (signal?.aborted || this.destroyed) return

		this.store.set({
			pages: pages.length ? pages : [{ id: this.nextPageId++, segments: 0 }],
			loading: false,
			loadProgress: 1,
		})

		this.scene.setActivePage(0, { playing: true })
		this.store.set({ activePage: 0 })
		this.refreshOnion()
		this.scene.redraw()
		this.captureActivePage()
	}

	// --- internals -----------------------------------------------------------

	private drawing = false

	private handlePointerDown = (): void => {
		this.drawing = true
		this.pause()
	}

	private handlePointerUp = (): void => {
		if (!this.drawing) return
		this.drawing = false

		// paper dispatches its own mouseup on the document too, and ours may land
		// first, in which case the stroke isn't finished yet. One tick later it is.
		window.setTimeout(() => {
			if (this.destroyed) return
			this.recountActivePage()
			this.captureActivePage()
		}, 0)
	}

	private recountActivePage(): void {
		const index = this.scene.activePage
		const pages = this.store.snapshot.pages
		const page = pages[index]
		if (!page) return

		const segments = countSegments(this.scene.activeLayer)
		if (segments === page.segments) return

		const next = [...pages]
		next[index] = { ...page, segments }
		this.store.set({ pages: next })
	}

	/**
	 * Adds a page record at `index`.
	 *
	 * `seed` is the canvas the new page was copied from: a duplicate's thumbnail
	 * has to show the drawing immediately, because it is a copy of a page you are
	 * looking at and a blank frame would read as having lost it.
	 */
	private insertPageState(index: number, segments: number, seed?: HTMLCanvasElement | null): void {
		const id = this.nextPageId++
		const pages = [...this.store.snapshot.pages]
		pages.splice(index, 0, { id, segments })

		if (seed) this.seedNext = { pageId: id, source: seed }

		this.store.set({ pages, activePage: this.scene.activePage })
		this.scene.clearSnapshot()
	}

	/** Set by `duplicatePage` so the copy's thumbnail is right from its first frame. */
	private seedNext: { pageId: number; source: HTMLCanvasElement } | null = null

	private thumbnailFor(index: number): HTMLCanvasElement | null {
		const page = this.store.snapshot.pages[index]
		return page ? (this.thumbnails.get(page.id) ?? null) : null
	}

	/**
	 * The page you were on is thrown left into the strip while the new canvas flies
	 * in from the right.
	 *
	 * Everything that moves is pinned in place first. The strip itself slides — it
	 * has a CSS transition on `left` — so without pinning, the outgoing thumbnail
	 * would be carried along by the layout *and* animated, and travel twice as far
	 * as it should. Unpinning at the end drops each one back into flow, which by
	 * then is exactly where the animation left it.
	 */
	private async animateInsert(outgoing: number, incoming: 'newPage' | 'nudge'): Promise<void> {
		this.setBusy(true)

		const outgoingCanvas = this.thumbnailFor(outgoing)
		const pinned = this.freezeRange(this.scene.activePage + 1, this.pageCount)
		const unpinOutgoing = outgoingCanvas ? freeze(outgoingCanvas) : null

		await Promise.all([
			outgoingCanvas ? play(outgoingCanvas, 'newPageIcon') : Promise.resolve(),
			play(this.scene.canvas, incoming),
		])

		unpinOutgoing?.()
		for (const undo of pinned) undo()
		this.setBusy(false)
	}

	/** Pins a run of page thumbnails in place for the duration of an animation. */
	private freezeRange(from: number, to: number): (() => void)[] {
		const undos: (() => void)[] = []
		for (let i = from; i < to; i++) {
			const canvas = this.thumbnailFor(i)
			if (canvas) undos.push(freeze(canvas))
		}
		return undos
	}

	private setBusy(busy: boolean): void {
		this.store.set({ busy })
	}

	private refreshOnion(): void {
		if (this.mode !== 'create' || this.store.snapshot.playback !== 'none') {
			this.scene.clearOnion()
			return
		}
		this.scene.showOnion()
	}
}

/** How much is drawn on a layer. Feeds the choice of which page becomes the cover. */
function countSegments(layer: paper.Layer): number {
	let total = 0
	for (const child of layer.children) {
		if ('segments' in child) total += (child as paper.Path).segments.length
	}
	return total
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve())
	})
}

import { Store } from '../../lib/store'
import { DEFAULT_PAGE_STEP, freeze, play } from './animations'
import { CANVAS_HEIGHT, CANVAS_WIDTH, FPS, PENCIL_COLOR } from './constants'
import {
	assertLeadingGroups,
	parseLegacyPages,
	parseSvgPages,
	strokeGeometry,
	strokeWidthFor,
} from './formats'
import {
	advanceCircleplay,
	circleplayInitial,
	circleplayPage,
	type CircleplayState,
} from './geometry'
import { History, type Op, type Step } from './history'
import type { PageState } from './pages'
import { type PaperCore, Scene } from './scene'
import { Selection } from './selection'
import { EraserTool } from './tools/eraser'
import { DEFAULT_PENCIL_WIDTH, PencilTool } from './tools/pencil'
import { PushTool } from './tools/push'
import { TransformTool } from './tools/transform'
import type { ModalTool, ModalToolId } from './tools/types'

export type PlaybackMode = 'none' | 'play' | 'circleplay'
export type EngineMode = 'create' | 'playback'

/**
 * Set on `<html>` for as long as circleplay is scrubbing, and defined in
 * `styles/base.css`: it turns off the browser's own touch gestures for the whole
 * document. A class rather than an inline style because what it does — including
 * whether it needs to say anything about overscroll — belongs with the stylesheet.
 */
const SCRUBBING = 'scrubbing'

export interface FlipbookState {
	pages: PageState[]
	activePage: number

	/**
	 * True while a page thumbnail is sliding into the slot the drawing canvas stands
	 * in, and hasn't got there yet.
	 *
	 * The strip hides whichever thumbnail is behind the canvas, and that is normally
	 * the active page. During a delete the next page becomes active the instant you
	 * click — so it was being hidden 4ms in and spending its whole 750ms journey
	 * invisible, which read as it teleporting into place while every other page slid.
	 * While this is set the strip hides nothing.
	 */
	arriving: boolean

	/** Null on the playback page, which has no drawing tools at all. */
	tool: ModalToolId | null
	/** Which of the transform button's two modes is showing: 0 transform, 1 push. */
	transformIndex: 0 | 1

	pencilWidth: number
	playback: PlaybackMode

	/** Whether there is anything on either stack. See `History`. */
	canUndo: boolean
	canRedo: boolean

	loading: boolean
	/** 0–1 while a saved flipbook is being replayed into the tool. */
	loadProgress: number

	/** True while a page animation is playing. Input is ignored until it finishes. */
	busy: boolean
}

export interface EngineOptions {
	mode: EngineMode
	isTouch: boolean
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
	private readonly history: History

	private readonly pencil: PencilTool
	private readonly eraser: EraserTool | null
	private readonly transform: TransformTool | null
	private readonly push: PushTool | null

	/** One canvas per page, registered by React as the strip renders. */
	private readonly thumbnails = new Map<number, HTMLCanvasElement>()

	/** How far one page is from the next on screen. See `setPageStep`. */
	private pageStep = DEFAULT_PAGE_STEP

	private nextPageId = 1
	private playTimer: number | null = null
	private circleplay: CircleplayState | null = null
	private destroyed = false

	/** Held while alt or shift is down; the transform tool reads them on every event. */
	private modifiers = { alt: false, shift: false }

	/** `paperCore` is passed in rather than imported — see the note on `PaperCore`. */
	constructor(canvas: HTMLCanvasElement, options: EngineOptions, paperCore: PaperCore) {
		this.mode = options.mode

		this.scene = new Scene(canvas, paperCore)
		this.selection = new Selection(this.scene)
		this.history = new History(this.scene)

		this.store = new Store<FlipbookState>({
			pages: [{ id: this.nextPageId++, segments: 0 }],
			activePage: 0,
			arriving: false,
			tool: options.mode === 'create' ? 'pencil' : null,
			transformIndex: 0,
			pencilWidth: DEFAULT_PENCIL_WIDTH,
			playback: 'none',
			canUndo: false,
			canRedo: false,
			loading: false,
			loadProgress: 0,
			busy: false,
		})

		this.history.onChange(() => {
			this.store.set({ canUndo: this.history.canUndo, canRedo: this.history.canRedo })
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

		/*
		 * A page the history has just put back, drawn the moment it has something to be
		 * drawn on.
		 *
		 * Undoing a delete restores a page whose `<canvas>` does not exist yet — React
		 * makes it on the next render — so the capture can't happen where the undo does.
		 * Waiting a frame or two would work while anyone is watching and fail exactly
		 * when nobody is: a background tab runs no animation frames at all, and the page
		 * would come back blank. This is the moment the element exists, and there is no
		 * waiting in it.
		 */
		if (this.captureOnMount === pageId) {
			this.captureOnMount = null
			this.captureActivePage()
		}
	}

	/** The page whose thumbnail is owed a drawing as soon as React renders one. */
	private captureOnMount: number | null = null

	/**
	 * How far it is from one page to the next, measured off the strip.
	 *
	 * Every animation that throws a page into the next slot travels exactly this far,
	 * and the strip is a row of copies of the drawing — which is 640 wide on a desktop
	 * and about half that on a phone. So the number can't be a constant, and it is the
	 * strip that knows it. See `PageStrip`, which measures and reports it.
	 */
	setPageStep(step: number): void {
		if (step > 0) this.pageStep = step
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
			if (id === 'transform')
				this.setTransformIndex(this.store.snapshot.transformIndex === 0 ? 1 : 0)
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

	/**
	 * Deleting what's selected, which the pointer never does — it's the Delete key and
	 * nothing else, so it can't be caught by the down-and-up that records every other
	 * edit and has to say so itself.
	 */
	deleteSelection(): void {
		const index = this.scene.activePage
		const page = this.store.snapshot.pages[index]
		if (!page || this.selection.isEmpty) return

		this.history.begin(index, page.id)
		this.selection.deleteSelected()
		this.history.commit(index)

		this.captureActivePage()
	}

	/** Puts everything back on the page. Nothing has changed; nothing is recorded. */
	clearSelection(): void {
		this.selection.clear()
		this.captureActivePage()
	}

	// --- undo ----------------------------------------------------------------

	undo(): void {
		if (this.store.snapshot.busy) return
		this.spend(this.history.takeUndo(), 'undo')
	}

	redo(): void {
		if (this.store.snapshot.busy) return
		this.spend(this.history.takeRedo(), 'redo')
	}

	private spend(step: Step | null, direction: 'undo' | 'redo'): void {
		if (!step) return

		// Stopped rather than refused, the same bargain the page buttons make: a
		// flipbook changing page twelve times a second is no place to be putting a
		// drawing back, and the press that stops it is not wasted — the step is still
		// on the stack for the next one.
		this.pause()
		this.applyStep(step, direction)
	}

	/**
	 * Puts a step's ops into effect, and turns the step into its own opposite on the
	 * way through.
	 *
	 * Ops run in reverse for an undo, because a step that removed a page and then
	 * added another has to be unwound in the order it was wound. Each one hands back
	 * what it replaced and that goes straight into the op, so the step now sitting on
	 * the other stack describes the journey home. Nothing is diffed and nothing is
	 * recomputed: the two directions are the same code reading the same fields.
	 *
	 * The store is written once, at the end. Deleting the only page in a flipbook is
	 * two ops, and between them there are no pages at all — a state React must never
	 * be shown.
	 */
	private applyStep(step: Step, direction: 'undo' | 'redo'): void {
		// Held strokes belong to the page they were picked up from, and a step may be
		// about to take that page away. Putting them down first also means the drawing
		// this restores is a drawing, with nothing selected on it.
		this.selection.clear()

		const ops = direction === 'undo' ? [...step.ops].reverse() : step.ops
		const pages = [...this.store.snapshot.pages]

		/** Where to stand if the page the step names has gone. See below. */
		let vacated: number | null = null

		for (const op of ops) {
			if (op.kind === 'content') {
				const index = pages.findIndex((page) => page.id === op.pageId)
				if (index < 0) continue

				op.ink = this.history.swap(index, op.ink)
				pages[index] = { id: op.pageId, segments: countSegments(this.scene.pageLayer(index)) }
				continue
			}

			// `added` is what the step did going forwards, so undo does the opposite.
			if (direction === 'redo' ? op.added : !op.added) {
				this.scene.insertPageAt(op.index)
				this.history.write(op.index, op.ink)
				pages.splice(op.index, 0, {
					id: op.pageId,
					segments: countSegments(this.scene.pageLayer(op.index)),
				})
				continue
			}

			const index = pages.findIndex((page) => page.id === op.pageId)
			if (index < 0) continue

			// Read before it goes, so the journey back has something to put there.
			op.ink = this.history.inkOf(index)
			this.scene.removePage(index)
			this.thumbnails.delete(op.pageId)
			pages.splice(index, 1)
			vacated = index
		}

		// The step says which page it is about, one id for each direction. When that
		// page is the one it just took away — undoing a blank page, redoing a delete —
		// the slot it left is the next best thing, which is also where `deletePage`
		// puts you.
		const wanted = direction === 'undo' ? step.back : step.forward
		const named = pages.findIndex((page) => page.id === wanted)
		const landing = clamp(named >= 0 ? named : (vacated ?? this.scene.activePage), pages.length - 1)

		this.scene.setActivePage(landing)
		this.refreshOnion()
		this.scene.redraw()

		// Two ways for the page we land on to get its thumbnail back, and which applies
		// depends on whether it was here a moment ago. A page whose contents changed
		// already has a canvas in the strip and is drawn now; a page the step has just
		// restored has none until React renders it, and is drawn on arrival.
		const landed = pages[landing]
		if (landed && !this.thumbnails.has(landed.id)) this.captureOnMount = landed.id

		this.store.set({ pages, activePage: landing, arriving: false })
		this.captureActivePage()
	}

	// --- pages ---------------------------------------------------------------

	get pageCount(): number {
		return this.store.snapshot.pages.length
	}

	/**
	 * Whether a page can be added or removed right now — and if playback is what's in
	 * the way, stops it so the next press can go through.
	 *
	 * Playback swaps the visible page every 83ms and a page animation is 750ms of
	 * pinned thumbnails and a canvas mid-flight; doing both at once left the strip in
	 * a heap. Pausing and carrying on in one press was how that happened, so the press
	 * buys the pause and nothing else. The tools don't need this — they stop playback
	 * themselves and nothing is animating when they do.
	 */
	private beginPageChange(): boolean {
		if (this.store.snapshot.busy) return false

		if (this.store.snapshot.playback !== 'none') {
			this.pause()
			return false
		}

		return true
	}

	async addBlankPage(): Promise<void> {
		if (!this.beginPageChange()) return

		// Put down before the page changes under it, not hidden and carried across:
		// selected strokes live in the selection layer rather than on the page, so a
		// selection held through a page change is a set of strokes belonging to a page
		// you are no longer on — and the next Escape pastes them onto this one.
		this.selection.clear()
		this.captureActivePage()

		const from = this.scene.activePage
		const source = this.store.snapshot.pages[from]
		const index = this.scene.insertBlankPage(from)

		const id = this.insertPageState(index, 0)
		this.history.record({
			ops: [{ kind: 'page', added: true, pageId: id, index, ink: this.history.inkOf(index) }],
			forward: id,
			back: source?.id ?? id,
		})
		this.refreshOnion()

		await this.animateInsert(from, 'newPage')
	}

	async duplicatePage(): Promise<void> {
		if (!this.beginPageChange()) return

		this.selection.clear()
		this.captureActivePage()

		const from = this.scene.activePage
		const original = this.store.snapshot.pages[from]
		this.scene.duplicatePage(from)

		// The copy takes the current page's place; you carry on drawing on the original.
		const source = this.thumbnailFor(from)
		const id = this.insertPageState(from, original?.segments ?? 0, source)
		this.history.record({
			ops: [{ kind: 'page', added: true, pageId: id, index: from, ink: this.history.inkOf(from) }],
			// The active page doesn't move: the copy went in underneath it. So both
			// directions land on the page you were drawing on, which is still this one.
			forward: original?.id ?? id,
			back: original?.id ?? id,
		})
		this.refreshOnion()

		await this.animateInsert(from, 'nudge')
	}

	async deletePage(): Promise<void> {
		if (!this.beginPageChange()) return

		this.selection.clear()

		// The thumbnail is about to stand in for the canvas, in the same place and at
		// the same size, so any drift between the two would show as a jump the moment
		// the canvas steps aside.
		this.captureActivePage()

		const index = this.scene.activePage
		const pages = this.store.snapshot.pages
		const doomed = pages[index]
		if (!doomed) return

		// Read while it is still here. Everything below is 750ms of animation, and by
		// the time the page is actually removed the drawing on it is the only part of
		// this the history can't reconstruct.
		const ink = this.history.inkOf(index)

		// Marked from the moment it starts to fall. It has to stay in the list to be
		// rendered on its way out, but it stops counting towards the flipbook now —
		// otherwise deleting the only page leaves two in the list for 750ms and the
		// play and save buttons blink on and off again.
		const leaving = pages.map((page, i) => (i === index ? { ...page, leaving: true } : page))

		// The strip is never empty: deleting the only page leaves a fresh one behind.
		const replacing = pages.length === 1
		const replacementId = this.nextPageId

		if (replacing) {
			this.scene.insertBlankPage(0)
			this.store.set({
				pages: [...leaving, { id: this.nextPageId++, segments: 0 }],
				activePage: 1,
			})
		} else {
			this.store.set({ pages: leaving })
		}

		const canvas = this.thumbnails.get(doomed.id)
		const atEnd = index === this.store.snapshot.pages.length - 1
		const sibling = atEnd ? index - 1 : index + 1
		const siblingId = this.store.snapshot.pages[sibling]?.id ?? doomed.id

		this.setBusy(true)

		/*
		 * Focusing the sibling slides the whole strip one page along, and which pages
		 * have to be held still through that is the whole of this.
		 *
		 * Deleting a page mid-book focuses the page after it, so the strip travels
		 * left. The pages *before* the gap are already where they will end up, so they
		 * are pinned; the pages after it are one step from where they end up, so they
		 * are let go and ride the slide. Deleting the last page focuses backwards
		 * instead, and then every page really does move along — so nothing is pinned.
		 */
		const pinned = atEnd ? [] : this.freezeRange(0, index)

		// The page on its way out is pinned too, and never unpinned: it has to fall
		// from where it is rather than from where the strip is heading, and it holds
		// its last frame until it's removed outright a moment later. `lift` is what
		// puts it in front of the drawing canvas, so the fall is visible from the
		// first frame rather than from halfway down.
		if (canvas) freeze(canvas, { lift: true })

		this.scene.setActivePage(sibling)

		// Not when the page is being replaced: there the canvas itself is what
		// arrives, and its thumbnail should stay hidden underneath it as usual.
		this.store.set({ activePage: sibling, arriving: !replacing })

		const siblingCanvas = this.thumbnailFor(sibling)
		const unpinSibling = siblingCanvas ? freeze(siblingCanvas) : null

		/*
		 * What takes its place.
		 *
		 * Deleting the last page in the book replaces it, and a page arriving is a
		 * page arriving: it flies in on the canvas exactly as a blank one does. 2013
		 * got this for free by animating every page that joined the collection,
		 * including the one delete put there — without it the replacement simply
		 * appeared, in front of the page still falling off the screen.
		 */
		const arriving = replacing
			? play(this.scene.canvas, 'newPage')
			: siblingCanvas
				? play(siblingCanvas, atEnd ? 'focusPrevThumb' : 'focusNextThumb', { step: this.pageStep })
				: Promise.resolve()

		// The deleted page holds its last frame: it's about to be removed, and
		// letting it snap back into view for one frame first would be a flicker.
		if (canvas) await play(canvas, 'deletePage', { hold: true })
		await arriving
		unpinSibling?.()

		this.scene.removePage(index)
		this.thumbnails.delete(doomed.id)

		// The arriving page has landed exactly where the canvas is, so handing the
		// slot back to it — which hides its thumbnail — can't be seen happening.
		const remaining = this.store.snapshot.pages.filter((page) => page.id !== doomed.id)
		this.store.set({ pages: remaining, activePage: this.scene.activePage, arriving: false })

		for (const undo of pinned) undo()
		this.setBusy(false)

		/*
		 * Recorded now the flipbook has settled, rather than on the way in, so that a
		 * ⌘Z arriving mid-animation finds the step it expects — the one before this —
		 * and not a half-applied delete. Both ops carry the index the page ended up at.
		 *
		 * Deleting the only page is two ops travelling together: the page leaves and a
		 * blank one takes its place. Split into two steps, the first undo would leave a
		 * flipbook with no pages in it at all.
		 */
		const ops: Op[] = [{ kind: 'page', added: false, pageId: doomed.id, index, ink }]
		if (replacing) {
			ops.push({
				kind: 'page',
				added: true,
				pageId: replacementId,
				index,
				ink: this.history.inkOf(index),
			})
		}
		this.history.record({ ops, forward: replacing ? replacementId : siblingId, back: doomed.id })

		this.refreshOnion()
		this.scene.redraw()
	}

	goToPage(index: number): void {
		if (this.store.snapshot.busy) return
		if (index < 0 || index >= this.pageCount) return
		if (index === this.scene.activePage) return

		this.selection.clear()
		this.scene.setActivePage(index, { playing: this.store.snapshot.playback !== 'none' })
		// The history is not reset here, as the one-step snapshot was: it belongs to the
		// flipbook rather than to the page, and a step knows which page it is about and
		// takes you there. Turning a page and pressing undo undoes the last thing you
		// did, wherever you did it.
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
		if (this.store.snapshot.playback === 'play') {
			this.pause()
			return
		}
		if (this.pageCount < 2) return

		this.stopPlayback()
		this.store.set({ playback: 'play' })
		this.scene.clearOnion()
		this.scheduleFrame()
	}

	toggleCircleplay(): void {
		if (this.store.snapshot.playback === 'circleplay') {
			this.pause()
			return
		}
		if (this.pageCount < 2) return

		this.stopPlayback()
		this.store.set({ playback: 'circleplay' })
		this.scene.clearOnion()

		this.circleplay = circleplayInitial(this.scene.activePage)
		document.addEventListener('pointermove', this.handleCircleplayMove)

		// A circle drawn with a finger is a scroll as far as the browser is concerned,
		// and a scrolling page stops sending pointer moves the moment it decides that.
		// For as long as the gesture *is* the control, nothing else may claim it.
		document.documentElement.classList.add(SCRUBBING)
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
			document.removeEventListener('pointermove', this.handleCircleplayMove)
			document.documentElement.classList.remove(SCRUBBING)
			this.circleplay = null
		}
	}

	private scheduleFrame(): void {
		this.playTimer = window.setTimeout(() => {
			if (this.destroyed || this.store.snapshot.playback !== 'play') return

			const next = this.scene.activePage + 1

			if (next < this.pageCount) this.jumpTo(next)
			// A flipbook that is still arriving doesn't lap. Playback begins as soon
			// as there are two pages to flip between, and looping those two while the
			// other forty land would read as a stutter rather than as a flipbook — so
			// the last page it has is held until the rest catch up. The loader runs
			// hundreds of pages a second against playback's twelve, so this only ever
			// has anything to do on the first frame or two.
			else if (!this.store.snapshot.loading) this.jumpTo(0)

			this.scheduleFrame()
		}, 1000 / FPS)
	}

	private handleCircleplayMove = (event: PointerEvent): void => {
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
		return new XMLSerializer().serializeToString(
			this.scene.project.exportSVG({ asString: false }) as SVGElement,
		)
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

		await this.replay(pages.length, signal, (index, layer) => {
			const page = pages[index]
			if (!page) return

			for (const stroke of page.strokes) {
				const item = this.buildStroke(stroke, layer)
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
			layer.strokeCap = 'round'
			layer.strokeJoin = 'round'
			layer.strokeColor = new this.scene.scope.Color(PENCIL_COLOR)
		})
	}

	/**
	 * One saved stroke, as a paper item in `layer`.
	 *
	 * This used to be `importSVG` per stroke, and that was most of what a load cost:
	 * it resolves styles, attributes, transforms and a matrix for every element, and
	 * a saved flipbook is nothing but open strokes. Handing the geometry straight
	 * to the constructors paper's own importer ends up calling skips all of it —
	 * four to eight times faster on the archive, and on the files the tool writes now.
	 *
	 * The geometry is not parsed differently, only reached differently: `strokeGeometry`
	 * uses the importer's own number regex, `Path.create` is what `importPath` calls,
	 * and a two-point path is what `Path.Line` builds. What's skipped is the work the
	 * lines below undo anyway — every stroke's colour and cap are restated per page.
	 */
	private buildStroke(stroke: Element, layer: paper.Layer): paper.Item | null {
		const geometry = strokeGeometry(stroke)

		// Never seen in either format, so never hit — but a stroke that loads slowly
		// is a bug where a stroke that silently disappears is a lost drawing.
		if (!geometry) return layer.importSVG(stroke as SVGElement, { insert: true })

		if (geometry.kind === 'data') {
			// `Path.create`, not `new Path`: path data holding more than one subpath
			// is a CompoundPath, and that is the choice paper's importer makes too.
			return this.scene.scope.PathItem.create(geometry.data)
		}

		if (geometry.points.length === 0) return null
		return new this.scene.scope.Path(
			geometry.points.map((point) => new this.scene.scope.Point(point.x, point.y)),
		)
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
		drawPage: (index: number, layer: paper.Layer) => void,
	): Promise<void> {
		/** Long enough to get real work done, short enough to leave the frame time. */
		const BUDGET_MS = 8

		const pages: PageState[] = []
		let deadline = performance.now() + BUDGET_MS

		try {
			for (let index = 0; index < total; index++) {
				if (signal?.aborted || this.destroyed) return

				// Page one is the layer the scene was built with; the rest are appended
				// behind whatever is on screen. This used to insert each page *and show
				// it*, which is why a loading flipbook visibly drew itself — and why it
				// couldn't start playing until the last page had landed.
				const layer = index === 0 ? this.scene.activeLayer : this.scene.appendPage()

				// paper puts new items in the active layer, and the legacy loader draws
				// through the pencil, which has no other way to say where its strokes go.
				layer.activate()
				drawPage(index, layer)
				this.scene.activeLayer.activate()

				pages.push({ id: this.nextPageId++, segments: countSegments(layer) })

				// Yield when the budget is spent, not once per page. The 2013 loader did
				// one page per setTimeout(0), so a 200-page flipbook cost 200 trips
				// through the task queue with the main thread idle for most of each.
				if (performance.now() >= deadline) {
					// Published as they arrive rather than all at the end, so the playback
					// page can start flipping through what it has. A copy each time: the
					// store hands this array to React, which must not see it change under it.
					this.store.set({ pages: [...pages], loadProgress: (index + 1) / total })
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

			// A restored flipbook is where the session starts, not something to be
			// undone back out of. Nothing has recorded a step here — the loaders don't
			// go through the pointer — but the crash recovery replays into a tool that
			// has been drawn on, and that history is about a flipbook that is gone.
			this.history.clear()

			// Page one has been the active page throughout, so there is nothing to go
			// back to — and going back would be wrong: playback may already be running
			// and several pages in, and yanking it to the start is the one thing a
			// flipbook that has begun must not do.
			if (this.store.snapshot.playback === 'none') {
				this.refreshOnion()
				this.captureActivePage()
			}
			this.scene.redraw()
		} finally {
			// A load that is given up on — the reader left mid-flight — still has to
			// say it is no longer in progress. `scheduleFrame` holds the last page it
			// has for as long as a flipbook is arriving, so a flag left set behind an
			// early return is a flipbook that plays once and then stops dead.
			if (this.store.snapshot.loading) this.store.set({ loading: false })
		}
	}

	// --- internals -----------------------------------------------------------

	private drawing = false

	/**
	 * Every edit starts here.
	 *
	 * A gesture on this canvas is the only way anything gets drawn, rubbed out, moved,
	 * scaled, rotated or pushed, so the history is taken at the two ends of it rather
	 * than inside the four tools. That is why the transform tool is undoable now
	 * without a line in it changing: it never took a snapshot, and it doesn't have to.
	 *
	 * What is *not* an edit goes through here too — a click that selects a stroke, a
	 * marquee that catches nothing, a tap that leaves no path — and none of them
	 * records a step. See `History.commit`, which compares the two ends.
	 */
	private handlePointerDown = (): void => {
		this.drawing = true
		this.pause()

		const index = this.scene.activePage
		const page = this.store.snapshot.pages[index]
		if (page) this.history.begin(index, page.id)
	}

	private handlePointerUp = (): void => {
		if (!this.drawing) return
		this.drawing = false

		// paper dispatches its own mouseup on the document too, and ours may land
		// first, in which case the stroke isn't finished yet. One tick later it is.
		window.setTimeout(() => {
			if (this.destroyed) return
			this.history.commit(this.scene.activePage)
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
	 *
	 * Returns the id it gave the page, which is what the history holds on to — indices
	 * move as pages come and go, and a step that named one would start pointing at the
	 * wrong page the moment it was any use.
	 */
	private insertPageState(
		index: number,
		segments: number,
		seed?: HTMLCanvasElement | null,
	): number {
		const id = this.nextPageId++
		const pages = [...this.store.snapshot.pages]
		pages.splice(index, 0, { id, segments })

		if (seed) this.seedNext = { pageId: id, source: seed }

		this.store.set({ pages, activePage: this.scene.activePage })
		return id
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
			outgoingCanvas
				? play(outgoingCanvas, 'newPageIcon', { step: this.pageStep })
				: Promise.resolve(),
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

function clamp(index: number, last: number): number {
	return Math.max(0, Math.min(index, last))
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

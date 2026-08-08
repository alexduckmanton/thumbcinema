import { lazy, Suspense } from 'react'

import { AdminToggles, type AdminFlagsState } from '../../components/AdminToggles'
import type { FlipbookSummary } from '../../lib/api'
import { Link } from '../../router/Router'
import { flipbookPath } from '../../router/routes'
import { loadPreview } from './preview'
import type { useCardGesture } from './useCardGesture'
import styles from './FlipbookCard.module.css'

/**
 * The preview, in its own chunk.
 *
 * It is a few kilobytes — the renderer, the cache, and `engine/formats.ts` with it —
 * and none of it is needed to draw a card, but all of it is needed the instant a
 * pointer lands on one. So the module is asked for as soon as a page holding cards has
 * mounted and is in memory long before then; `lazy` resolves out of the module cache
 * and the Suspense boundary never shows. `loadPreview` is exported for that: a page
 * with cards on it calls it in an effect. See the gallery.
 *
 * The reason it is split at all is `formats.ts`, which the two paper.js routes also
 * import. Left in the entry bundle it would be carried by every visit to every page,
 * including the ones that already have their own copy of it in their chunk.
 */
const FlipbookPreview = lazy(() =>
	loadPreview().then((module) => ({ default: module.FlipbookPreview })),
)

/**
 * The play button's mark: a triangle, or a pair of bars while it is running.
 *
 * Pause rather than stop, because that is what the button does — it leaves the flipbook
 * on the frame it had reached and pressing play again carries on from there. A square
 * promises the drawing is about to go away, and it isn't.
 *
 * Drawn here rather than taken from the sprite because the sprite hasn't got either —
 * play went with the tray it lived in — and because it shouldn't. That sheet is
 * hand-drawn pictures of *things*: a pencil, an eraser, a printer. These are geometric
 * primitives, and they belong with the ↺ and ↻ on the create page, which are live text
 * for the same reason.
 *
 * Both marks are centred on the 12×12 box by their own geometry rather than nudged into
 * place by CSS — the triangle's points average to exactly 6, so the disc needs no
 * per-state offset and there is no rule to keep in step with the markup.
 */
function PlayGlyph({ playing }: { playing: boolean }) {
	return (
		<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">
			{playing ? (
				<>
					<rect x="2.5" y="1.5" width="2.5" height="9" rx="0.5" />
					<rect x="7" y="1.5" width="2.5" height="9" rx="0.5" />
				</>
			) : (
				<path d="M3.5 1.5 L11 6 L3.5 10.5 Z" />
			)}
		</svg>
	)
}

export interface FlipbookCardProps {
	item: FlipbookSummary
	/**
	 * The whole of `useCardGesture`, handed over rather than spread into nine props.
	 *
	 * One instance drives a whole grid — a pointer is one thing, so exactly one card is
	 * under it — and the card reads `hover` to find out whether that card is the one.
	 * A page with two separate lists of cards on it wants two of these, one per list,
	 * or leaving one list would be answered by the other.
	 */
	gesture: ReturnType<typeof useCardGesture>
	/** Admin only, and only where the list can update itself in place. */
	onFlagsChange?: (flags: AdminFlagsState) => void
}

/**
 * One flipbook in a list: the link, the flipbook playing over it, and the play button.
 *
 * Lives here rather than in the gallery because it is shown in two places now — the
 * grid, and the remixes under a flipbook on the playback page — and those are the same
 * object and want the same card. What it is *not* is a layout: the box it stands in
 * decides how wide it is and what it sits beside, and both callers bring their own grid.
 *
 * The three things in it are siblings rather than nested, and that is load-bearing. A
 * button within an `<a>` is invalid markup — interactive content can't nest — and, more
 * to the point, iOS treats a press anywhere inside a link as a press on the link and
 * offers to open it. The one control that wants a long press has to be somewhere that
 * isn't the anchor, and this is what that costs: one wrapper.
 */
export function FlipbookCard({ item, gesture, onFlagsChange }: FlipbookCardProps) {
	const { hover } = gesture
	const mine = hover?.id === item.id
	const playing = mine && hover.playing
	const name = item.title || 'Untitled flipbook'

	return (
		<div className={styles.cell}>
			<Link
				to={flipbookPath(item.id)}
				className={styles.card}
				onPointerEnter={(event) => gesture.handleEnter(event, item.id)}
				onPointerLeave={(event) => gesture.handleLeave(event, item.id)}
				// Touch only starts a download here — the card is a plain link under a
				// finger, and the gestures are all on the play button. The mouse still
				// plays and scrubs from anywhere on the card.
				onPointerDown={(event) => gesture.handleCardTouch(event, item)}
				// Kept as a backstop: a drag that began on the button and ended over the
				// card could otherwise release into a navigation.
				onClick={gesture.handleClick}
			>
				{/*
				 * The drawing: the cover page as an SVG where there is one, and the PNG of
				 * the same page where there isn't — a `time-capsule` save, a 2012 flipbook,
				 * anything the backfill hasn't reached. The server says which; see
				 * `thumbnail_svg_url`.
				 *
				 * An `<img>` rather than the `background-image` this was, because a
				 * background can't be lazy and the grid is an infinite scroll: every card
				 * that has ever been appended used to fetch its picture whether or not it
				 * was anywhere near the window. An `<img>` is also the element that can fall
				 * back, though it doesn't need to here — the server says which URL to ask for.
				 *
				 * `alt=""` because the link beside it already carries the flipbook's name,
				 * and `draggable` off because an image inside a link is a drag source by
				 * default — which is a gesture that starts on a card and ends somewhere else
				 * entirely, over a grid where dragging is how a finger scrubs.
				 */}
				<img
					className={styles.thumb}
					src={item.thumbnail_svg_url ?? item.thumbnail_url}
					alt=""
					loading="lazy"
					decoding="async"
					draggable={false}
					// A picture that won't load leaves the white card it was going to cover,
					// which is what the `background-image` this replaced did on a 404. An
					// `<img>` draws a broken-image icon instead, and a grid of drawings is the
					// last place for one — some archive rows have no thumbnail at all. Set on
					// the element rather than held as state because it is a per-card fact that
					// never reverses: nothing changes a card's `src` once it is on screen.
					onError={(event) => {
						event.currentTarget.style.visibility = 'hidden'
					}}
				/>

				{/* The card's only text. Clipped rather than hidden, because without it
				    every link in the grid has no accessible name. */}
				<span className="visuallyHidden">{name}</span>
			</Link>

			{/* The flipbook itself, on the card the pointer is on and on no other. The
			    fallback is null because there is nothing to stand in for — the thumbnail
			    is already showing, and it is a picture of this flipbook rather than a
			    picture of an absence. */}
			{mine ? (
				<Suspense fallback={null}>
					<FlipbookPreview
						source={item}
						originX={hover.originX}
						playing={hover.playing}
						scrubbing={hover.scrubbing}
					/>
				</Suspense>
			) : null}

			{/*
			 * The way in for a finger, which has no hover to play a card with — and the
			 * only one, since under a finger the card is just a link.
			 *
			 * Pressed, it runs the flipbook; dragged off, it hands the flipbook to the
			 * finger and becomes the same scrub the mouse gets. It sits over the link
			 * rather than in it, so holding it is a hold on a button and iOS offers nothing.
			 *
			 * The label says what the press will do rather than describing a state, which
			 * is how a media control reads out, and is why there is no `aria-pressed`
			 * beside it: two ways of saying one thing is one of them disagreeing eventually.
			 */}
			<button
				type="button"
				className={styles.play}
				aria-label={`${playing ? 'Pause' : 'Play'} ${name}`}
				onPointerDown={(event) => gesture.handlePlayDown(event, item)}
				onPointerMove={gesture.handlePointerMove}
				onPointerUp={gesture.handlePointerUp}
				onPointerCancel={gesture.handlePointerCancel}
				onClick={(event) => gesture.handlePlayClick(event, item)}
			>
				<PlayGlyph playing={playing} />
			</button>

			{/* Moderation happens where you notice something needs it, which is looking at
			    the thing. Renders nothing at all unless you hold the admin token. */}
			{onFlagsChange ? (
				<AdminToggles
					id={item.id}
					flags={{ featured: item.featured, nsfw: item.nsfw }}
					onChange={onFlagsChange}
					className={styles.cardAdmin}
				/>
			) : null}
		</div>
	)
}

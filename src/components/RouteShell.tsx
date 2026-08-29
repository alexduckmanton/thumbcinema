import type { Route } from '../router/routes'
import { galleryPath, galleryView } from '../router/routes'
import { navigate, useLocation } from '../router/Router'
import { ViewToggle } from '../routes/gallery/ViewToggle'
import { CreateButton } from './CreateButton'
import { SiteHeader } from './SiteHeader'
import { useToolLayout } from './toolLayout'

import canvasStyles from '../flipbook/components/FlipbookCanvas.module.css'
import createStyles from '../routes/create/CreatePage.module.css'
import galleryStyles from '../routes/gallery/GalleryPage.module.css'
import playbackStyles from '../routes/playback/PlaybackPage.module.css'

/**
 * The page, before the page.
 *
 * Every route is loaded on demand, so there is a stretch between React booting and the
 * route's chunk landing where the app knows exactly which page is coming and has none
 * of it. That used to be a spinner in the middle of an empty window — which said
 * "something is happening" without saying what or where, and on a navigation from the
 * gallery it replaced a full screen of flipbooks with a single dot.
 *
 * So it draws the page instead: the real header, and the same placeholder the page
 * itself uses while its contents are on the wire. Nothing moves when the route lands.
 * It is the gallery's grid trick applied one level up — lay the shape out first, then
 * let the drawings arrive into it.
 *
 * **It lives in the entry bundle, which is the whole point** — it cannot import
 * anything the routes are lazy about, or it would be waiting on the same download it
 * exists to cover. That is why the pieces here are the small shared ones (`SiteHeader`,
 * `CreateButton`, `ViewToggle`) and why it reads the *pages'* stylesheets rather than
 * carrying copies. A placeholder in the shape of the page is only worth having if it
 * is exactly the shape of the page: `--book-reserve` differs between create and
 * playback, and again in a short window, so a hand-written approximation would be
 * subtly the wrong size in three layouts and drift further from there. Importing a
 * stylesheet is not the cross-module *selector* the rest of the tree avoids — the
 * classes are applied to this markup, not reached into.
 *
 * What that costs: those four stylesheets move into the entry, so every route
 * downloads ~3 kB gzipped of CSS for the layouts it isn't. Measured against a spinner
 * standing in front of the drawing tool, it is not a close call.
 */

/**
 * The placeholder cards in the boot grid, and in the gallery's own — the same number
 * for the same reason, so a first page landing on top of the boot shell doesn't change
 * the count under the reader. See the note in `GalleryPage`.
 */
export const GALLERY_SKELETON = Array.from({ length: 20 }, (_, index) => index)

export interface RouteShellProps {
	route: Route
}

export function RouteShell({ route }: RouteShellProps) {
	switch (route.name) {
		case 'gallery':
			return <GalleryShell />
		case 'playback':
			// Remix, from the first frame, and the id comes off the pathname — this shell
			// knows which flipbook is coming without waiting for anything. Getting that
			// right here is most of the fix: the page's own button settles as soon as the
			// metadata lands, but this one is up for the whole of the route chunk's
			// download, which is why a refresh showed "New" for so much longer than a
			// navigation from the gallery did.
			return <BookShell content={playbackStyles.content} remixOf={route.id} />
		case 'create':
			// Its own shape rather than the playback page's: the drawing tool is a rail, a
			// stage and a page bar now, and the sheet of paper does not stand in a column.
			return <CreateShell />
		default:
			// Nothing to stand in for — the 404 is a heading and a line of text, and a
			// placeholder in the shape of an apology is worse than a beat of nothing.
			return (
				<SiteHeader width="narrow">
					<CreateButton />
				</SiteHeader>
			)
	}
}

/**
 * The playback page: one sheet of paper, pulsing, in the column it lands in.
 *
 * `content` is the page's own class rather than a copy of it — it carries the column's
 * padding and `--book-reserve`, which is what decides how big the sheet is. Typed as
 * possibly undefined because that is what a CSS module's lookup is under
 * `noUncheckedIndexedAccess`, and `className` takes it either way.
 */
function BookShell({
	content,
	remixOf,
}: {
	content: string | undefined
	/** The flipbook whose page this is standing in for, so the header can offer a remix. */
	remixOf: string | null
}) {
	return (
		<>
			<SiteHeader width="narrow">{remixOf ? <CreateButton remixOf={remixOf} /> : null}</SiteHeader>

			<main className={content}>
				<div className="center">
					<div className={canvasStyles.book}>
						{/* `.sheet` as well as `.skeleton`: there is no canvas under this one to
						    cast the shadow the page's own placeholder borrows. */}
						<div className={`${canvasStyles.skeleton} ${canvasStyles.sheet}`} aria-hidden="true" />
					</div>
				</div>
			</main>

			<Announcement />
		</>
	)
}

/**
 * The drawing tool, before the drawing tool: the rail's space, and a sheet of paper
 * pulsing in the middle of the stage.
 *
 * The header carries nothing at all. The page puts Save in it, and a save button offered
 * before there is a flipbook to save would be a control that is up early rather than a
 * page that is loading — which is the same reason the rail's space and the aiming pad's
 * are drawn empty. See `.shellPanel`.
 *
 * Every class here is the page's own, read off its stylesheet rather than copied, for the
 * reason the note at the top of this file gives: a placeholder is only worth having if it
 * is exactly the shape of the page, and `--book-reserve`, `--panel-width` and the stage's
 * gutters all differ by layout. `.navBand` is empty for the same reason the rail is — the
 * page bar is a control, and a grey pill that turns into a working one is two loading
 * states where the page needs one.
 */
function CreateShell() {
	// The page shape, before the page: `.stage` takes what the header leaves, and without
	// this there is nothing for it to take a share of — the sheet of paper collapses to
	// nothing and the shell draws an empty window. The page wears the same class, and the
	// count inside the hook is what carries it across the handover between them.
	useToolLayout()

	return (
		<>
			<div className={createStyles.headerBar}>
				<SiteHeader />
			</div>

			<main className={createStyles.content}>
				{/* The rail's space and the aiming pad's, both empty. They are here because the
				    drawing is centred between them: a shell missing either would put the sheet
				    of paper somewhere the page does not. */}
				<div className={createStyles.shellPanel} aria-hidden="true" />
				<div className={createStyles.shellPad} aria-hidden="true" />

				<div className={createStyles.stage}>
					<div className={`${canvasStyles.book} ${canvasStyles.fitted}`}>
						{/* `.sheet` as well as `.skeleton`: there is no canvas under this one to
						    cast the shadow the page's own placeholder borrows. */}
						<div className={`${canvasStyles.skeleton} ${canvasStyles.sheet}`} aria-hidden="true" />
					</div>
				</div>
			</main>

			<Announcement />
		</>
	)
}

function GalleryShell() {
	const { search } = useLocation()

	return (
		<>
			<SiteHeader actionsWrap>
				{/* Live, not a picture of one. The shell is up for a moment, but it is a
				    moment someone can click in, and a tab that ignores the press and then
				    reappears working is worse than one that isn't there. Same handler as
				    the gallery's: replace rather than push, because the toggle is a
				    filter and not a place. */}
				<ViewToggle
					view={galleryView(search)}
					onChange={(next) => navigate(galleryPath(next), { replace: true, preserveScroll: true })}
				/>
				<CreateButton />
			</SiteHeader>

			<main className={galleryStyles.content}>
				<div className={galleryStyles.grid}>
					{GALLERY_SKELETON.map((card) => (
						<span
							key={card}
							className={galleryStyles.skeleton}
							style={{ '--card': card } as React.CSSProperties}
							aria-hidden
						/>
					))}
				</div>
			</main>

			<Announcement />
		</>
	)
}

/**
 * What the placeholders cannot say.
 *
 * The same wording the pages use once they are mounted, so a screen reader hears one
 * "Loading" for the whole wait rather than one per stage of it.
 */
function Announcement() {
	return (
		<p role="status" className="visuallyHidden">
			Loading
		</p>
	)
}

# Remixes

Pressing **Remix** on a flipbook opens the drawing tool on a full editable copy of it,
and what you save from there is listed under the original. Two nullable columns and one
partial index; no new table, no new route, no new endpoint.

- **A remix keeps the shape of what it was drawn from.** A remix of a 16:9 flipbook is
  640×360 for ever, including a remix of that remix — the drawing tool restates its
  coordinate space from the file it opened, because the coordinates being imported are in
  that file's space and nothing else would land them where they were drawn. It is the one
  place a page size is inherited rather than being what a new flipbook gets, and it is why
  the two shapes will go on appearing in the gallery indefinitely rather than the older one
  ageing out. See `docs/drawing-tool.md`.
- **`remix_of` is the direct parent and `remix_root` is the oldest ancestor, and both
  are stored** even though the lineage is displayed flat. The root is what makes the
  list one indexed keyset scan instead of a recursive CTE on every playback page; the
  parent is what makes "Remixed from" *true*, because with the root alone a remix of a
  remix credits the wrong flipbook. The root is also derivable from the parent and the
  parent is not derivable from the root, so storing only the root would throw away what
  can't be recovered. A tree view is a display change from here, not a migration.
- **Both are written once, at insert, from the parent row**: `remix_root =
  parent.remix_root ?? parent.id`. Never updated, which is also why cycles are
  impossible — a parent has to exist to be pointed at.
- **The parent is resolved server-side and the link is *dropped* rather than the save
  refused.** `resolveRemixParent` in `lib/flipbooks.js`. A parent that doesn't exist or
  is `legacy-json` means the flipbook saves as an original, because a field that decides
  which page something gets listed on is not worth losing somebody's drawing over.
- **No `legacy-json` remixes, at either end.** The 2012 flipbooks are point lists that
  only come back through the pencil, so what the tool could open is a resampled copy
  rather than the artwork. The button is absent on those and the server refuses them
  too; they go on playing and printing exactly as before.
- **The button guesses Remix and takes itself away if it guessed wrong**, rather than
  waiting to be sure. It read `format` first and said "New" until the metadata landed,
  which meant *every* visit to *every* flipbook showed the wrong label and then changed
  it. Barely visible arriving from the gallery; a long, obvious flip on a refresh,
  because `RouteShell` was also saying "New" for the whole of the route chunk's
  download — two flashes, and the one nobody looked at first was the bigger. A label
  that is right at once for almost everything beats one that is right eventually for
  everything: `legacy-json` is 147 of the 585 archive rows and none of the flipbooks
  saved since. Where the guess is wrong the button **goes** rather than reverting to
  "New", which would be the same flash with the labels swapped; those pages still reach
  the tool through the wordmark. Traced frame by frame at 20ms, throttled and not: a
  refresh now goes blank → Remix and stops.
- **`RouteShell` passes the id too, and that is the half that mattered.** It has it
  already — `matchRoute` parses it out of the pathname, so the shell knows which
  flipbook is coming without waiting for anything at all. Same rule as the disabled row
  of edit actions on the create shell: a header that changes at the handover is exactly
  what that file exists to prevent.
- **`/create?remix=<id>` is a query parameter, not a route.** It doesn't change what the
  page *is*, `matchRoute` stays a function of the pathname alone, and — the part that
  matters — the URL survives the crash-recovery reload.
- **Recovered work beats the URL, and carries its own parentage.** `tc:remix-of` is
  written beside the recovery file. `Recovery` reloads the same URL, so without the
  guard a restore and a fresh fetch would both replay into one scene; and reading the
  parent back off the URL instead would be right almost always and wrong in the case
  that matters — a *stale* recovery file restored onto a page opened with somebody
  else's `?remix=` takes the artwork from one flipbook and the credit from another.
- **An untouched remix doesn't warn you about unsaved work**, and `canUndo` is what says
  so. `loadSvg` clears the history, so a freshly-opened remix has nothing to undo and
  anything at all done to it puts a step on the stack — "changed since it was loaded" is
  precisely what a non-empty undo stack means. Asked only of a remix: crash-recovered
  work has an empty history too, and that genuinely is unsaved work.
- **`remix_of` as a listing filter must never degrade to no filter.** Every other reader
  of an optional column degrades to "no row has one"; a filter degrades the other way,
  and a remix listing that lost its `WHERE` would answer "what was made from this
  flipbook" with the entire gallery. So the fallback is `WHERE false`, and a malformed
  id is a 404 rather than a silent `null`. Covered both ways in `lib/flipbooks.test.js`.
- **`queryColumnAware` stands down one column at a time**, which is what `querySvgAware`
  became. It parses the column name out of the error, because these arrived in separate
  migrations and a database can be missing any subset — dropping the whole set on the
  first failure would take the SVG thumbnails off every card for the length of the remix
  deploy window. Postgres phrases it three ways and the INSERT one is `column "x" of
  relation "flipbooks" does not exist`; missing that phrasing is invisible in unit tests
  and cost a save its SVG thumbnail when run against a real unmigrated database.
- **The list is keyed on the root, so a remix and its original show the same family** —
  and the page filters *itself* out of it, because a card that plays the drawing six
  inches above it and links to where you already are is not a useful card. What is not
  in the list is the root, on the page of a remix of a remix: it is the one member of a
  lineage carrying no `remix_root`. `remix_of` is the way back up, one step at a time.
- **No count in the heading.** The list is paginated, so the only number available is how
  many have been fetched, and "12 remixes" above twelve of thirty is worse than silence.
- **The card moved to `src/flipbook/card/` and the list is `lazy()`.** See **Code splitting** in
  [`architecture.md`](architecture.md): the card is shared with the gallery, and importing it plainly on the
  playback page would fetch it in front of the artwork on every visit to every flipbook
  in order to draw a list most of them haven't got.

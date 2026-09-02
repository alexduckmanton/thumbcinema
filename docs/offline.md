# Offline

Draw with no connection, save with no connection, and the flipbook goes up by itself the
next time there is one. Two pieces that don't know about each other: a **service worker**
that makes the site openable at all, and a **queue** that holds a save until it can be
posted.

```
save  ──> POST /saveflipbook ──> /f/{id}          the ordinary path, unchanged
      └─> no answer ──> IndexedDB ──> /f/local-…  the queue
                            │
                            └─ online ──> POST /saveflipbook ──> /f/{id}
```

Everything lives in `src/offline/`:

| | |
|---|---|
| `db.ts` | the four IndexedDB calls, and the only place that API is spoken |
| `pending.ts` | the queue: what a queued save is, and how the rest of the app sees one |
| `sync.ts` | posting them, when there's something to post them over |
| `online.ts` | `navigator.onLine`, as a hook, for wording messages |
| `register.ts` | turning the worker on, in production only |
| `sw.js` | the worker itself — not imported by anything; see the build plugin |

## The rules

- **The queue takes a save that got no answer, and only that.** `isNetworkFailure` in
  `src/lib/api.ts` is the test, and it is a fact about the response rather than about
  `navigator.onLine`: everything in the API client throws `ApiError` when there was a
  response to read, so anything else is the network. A 413 stays a 413 — a flipbook too
  big to save now will be too big tomorrow, and queueing it would turn a message you can
  act on into a card that never publishes.
- **A queued flipbook is an ordinary flipbook everywhere it is shown.** It has an id, a
  permalink, a card in the grid and a page of its own that plays. That is
  `pendingSummary` and `pendingFlipbook`, which hand back the same `FlipbookSummary` and
  `Flipbook` the API does — with the artwork as a `blob:` URL, so the gallery's preview
  cache and the playback page fetch it exactly as they fetch anything else. The
  alternative was an "or is it local?" branch in four files.
- **`local-` is the whole of what makes an id local.** Server ids are `[a-z0-9]` — ten
  characters from a restricted alphabet, or `a{wordpress_post_id}` for the archive — so
  nothing the server can mint contains a hyphen and nothing can collide. `/f/local-…` is
  a real URL that reloads, shares within the device, and 404s nowhere.
- **IndexedDB, not localStorage.** A queued save is the whole drawing: up to ~2.5 MB of
  SVG plus a PNG of the cover. localStorage is a ~5 MB budget for the origin, shared with
  the drawing tool's crash-recovery file, so the second offline save would fill it and the
  third would throw.
- **The record is erased from storage the instant it publishes, before anything else.**
  There is no key to deduplicate on server side; the only thing standing between a queue
  and a flipbook published twice is that erase, `stillQueued`, and the lock below.
- **A background flush must never reject.** The create page listens for
  `unhandledrejection` and shows the crash-recovery screen — see `useCrashRecovery` — so
  an upload failing in the background could put a red screen in front of somebody's
  drawing. `flushPending` swallows, and what it swallows stays in the queue.
- **The worker never touches `/api/*` or `/saveflipbook`.** A gallery listing is a live
  thing and a stale one is worse than none; and a save has to fail honestly, because
  failing honestly is what puts it in the queue.

## What happens when

**Saving with nothing to save to.** `handleSave` posts as normal, and on a network
failure writes the payload whole to IndexedDB and goes to `/f/local-…` with a toast
saying so. It leaves the page with `window.location.href`, like an ordinary save — except
where there is no service worker to answer for the site, when a real load would be the
browser's error page; there it navigates inside the app instead and carries the paper
scene along for one page. Everything about that decision is in the comment at the bottom
of `handleSave`.

**Waiting.** The card sits at the top of **All**, faded, until it publishes. All rather
than Featured because Featured is a curated list of rows in a table and this isn't a row
yet. Its own page says what's going on and offers to throw it away, which is the one thing
you can do to a queued flipbook besides wait.

**Publishing.** `startOfflineSync` flushes on boot and on the browser's `online` event —
boot as well, because a tab closed offline and opened online never sees the event. Oldest
first, one at a time (they are megabyte uploads on a connection that has just come back),
stopping at the first network failure since the second will fail for the same reason. One
toast for the run.

**Two tabs.** Both see `online`, and the queue is shared. `withLock` — the Web Locks API —
serialises the flushes, and `stillQueued` re-asks storage inside the lock, so the second
tab finds nothing left to do. Without locks (older Safari) the flush simply runs: the
duplicate needs two tabs reconnecting in the same instant, and a flipbook published twice
beats one published never.

**Published, while you're looking at it.** The entry stays in the list for the rest of the
page view, unfaded, linking to the real flipbook — a card vanishing under the reader looks
like data loss. It's gone on the next load, by which time the listing carries the real row.
The gallery drops any published entry whose id is already in the fetched page, which is
what stops the two of them appearing together after a tab switch.

**Refused.** A server that answered is a server with an opinion, so the entry is kept and
marked with what the server said, and the flush carries on to the next one. Its page shows
the reason, and offers to discard. It is retried on the next boot or `online` event, which
costs one request and is how a transient 500 sorts itself out.

## The service worker

`src/offline/sw.js` is a source file with two markers in it. `serviceWorkerPlugin` in
`vite.config.ts` fills them in at build time from the bundle's own file names — which are
content-hashed and not knowable before the build — and emits `dist/sw.js`. The build
throws if the markers have moved, because a precache list that is wrong is an app that
opens offline missing a chunk.

- **Everything the build emits is precached except paper.js, which is kept the first
  time it is fetched.** It is ~210 KB — two thirds of everything the build emits — and
  only the two drawing routes ever ask for it, so charging every first visit to the
  gallery for it in the background is the wrong way round. One online visit to the
  drawing tool is what puts it on the device; the fetch handler's `/assets/` branch keeps
  whatever it fetches, and everything under that path is content-hashed, so it is safe to
  keep and safe to serve without revalidating. Nothing here touches the chunk graph
  either way — paper is in no route's preload set, precached or not.
- **Until that visit, `/create` offline says so.** The route's own chunks are precached,
  so the page mounts and then the engine can't be built; `useFlipbookEngine` throws that
  to the app's `ErrorBoundary`, whose fallback reads `navigator.onLine` and says the piece
  it needs isn't on the device yet rather than "something broke". Nothing broke — a
  download hasn't happened — and the fix is a connection rather than another go.
- **`/` and not `/index.html`.** Under `cleanUrls` the deployed filesystem has no
  `/index.html` at all — that path is a 308 — and `cache.addAll` rejects on a redirect.
  It's the same trap as the rewrite in `vercel.json`; see CLAUDE.md.
- **Navigations are network-first, precached files cache-first.** A deploy lands the
  moment it's reachable, and the cache is the fallback; hashed assets can't change under
  a name, so there's nothing to revalidate.
- **`ignoreVary` is not optional.** A font is fetched in CORS mode even same-origin — see
  the `crossorigin` on the preloads in `index.html` — so its request carries an `Origin`
  header the plain fetch behind `cache.addAll` did not. A host answering `Vary: Origin`
  then stores a response the font request can never match, and the typefaces silently miss
  offline while everything else works. This was measured, not guessed: it is exactly what
  happened under `vite preview`.
- **Registered in production only.** In dev, Vite serves modules rewritten on every change
  and a cache in front of that is a morning wasted. `sw.js` doesn't exist in dev anyway.
- **`vercel.json` serves `/sw.js` with `max-age=0, must-revalidate`.** A cached worker is
  a deploy that never arrives.

## What this deliberately isn't

- **You can't browse offline.** The gallery is a live listing of somebody else's rows and
  nothing caches it; with no connection it says so plainly and points at the drawing tool.
  Flipbooks you have queued are still there, because they're on the device. The
  Featured/All toggle goes with the listing — two views of something there is no way to
  fetch are one control too many — and `RouteShell` takes the same view, reading
  `navigator.onLine` directly so the placeholder doesn't show a toggle the page is about
  to remove. That state is the one place on the site set in Pecita besides the wordmark:
  being offline is a fact about the reader's afternoon rather than an error, and the two
  states beside it, which really are error reports, stay in Inter.
- **The drawing tool needs one online visit before it works offline.** That is the
  bargain in the bullet above, and it is deliberate: the alternative charges every visit
  to the gallery — the page most visits are — for paper.js in the background. Anyone who
  has drawn a flipbook once has it.
- **You can't start a remix offline.** The drawing tool opens a remix by fetching the
  flipbook it's remixing. A connection that drops *during* one is fine — the parent is
  only an id, it rides along in the queue, and the server resolves it when the save
  finally lands.
- **A queued flipbook can't be remixed, moderated, or listed as anybody's parent.** It
  isn't a row yet, and everything in that list is about rows. Its page shows no Remix
  button and no admin toggles.
- **There is no background sync and no retry timer.** The triggers are boot and `online`.
  A Background Sync registration would post from a closed tab, which is a nice thing to
  have and a second code path to keep true; two triggers cover the cases anybody has.
- **`time-capsule` has none of this**, like everything else since 2013. Nothing here
  touches the schema or the API, so there is nothing for it to be out of step with.

# Deployment

Vercel for hosting, Neon for Postgres. Both free at this scale.

## 1. Database (Neon)

1. Create a project at [neon.tech](https://neon.tech). Any region near your users;
   the free tier gives 0.5 GB of storage, which the 77 MB archive sits well inside.
2. Copy the **pooled** connection string — the host has `-pooler` in it, like
   `ep-xxx-pooler.eu-west-2.aws.neon.tech`.

   This matters. Serverless functions open and drop connections constantly, and the
   direct endpoint will exhaust the connection limit under any real traffic. The
   pooler is pgbouncer and is what the endpoint is for.
3. Locally:

   ```bash
   cp .env.example .env
   # paste the pooled connection string into DATABASE_URL
   npm run db:migrate
   npm run db:import-archive
   npm run db:stats
   ```

## 2. Hosting (Vercel)

```bash
npx vercel link
```

**If you created the Neon database through Vercel's Storage tab, `DATABASE_URL` is
already set** — the integration writes it, plus a dozen `POSTGRES_*` and `PG*`
aliases the app doesn't use, to all three environments. `vercel env add DATABASE_URL`
will then fail with *"another environment variable with the same name exists"*, and
that's the correct outcome: there is nothing to add. Check with `vercel env ls`, and
confirm the value is the **pooled** host with `vercel env pull`.

Only add it by hand if you made the Neon project directly at neon.tech:

```bash
npx vercel env add DATABASE_URL production
npx vercel env add DATABASE_URL preview
```

The admin token is never set by the integration, so it always needs adding:

```bash
# Generate one first, and keep a copy
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
npx vercel env add ADMIN_TOKEN production
```

Then deploy:

```bash
npx vercel --prod
```

**Environment variables are baked into a deployment when it is built.** Adding or
changing one does nothing until you redeploy — `vercel redeploy <url>` rebuilds the
existing commit with the current values. Symptom of forgetting: every API route 500s
with `DATABASE_URL is not set` while `vercel env ls` clearly shows it set.

There is no build step. Vercel serves `public/` at the web root and turns `api/index.js`
into a function; `vercel.json` supplies the rewrites, `cleanUrls` and cache headers.

Nothing else needs configuring — no framework preset, no build command, no output
directory.

### Keep the function near the database

Every API request makes at least one query, so the function and the Neon project
should be in the same region. Vercel defaults new projects to `iad1` (Washington);
if Neon is somewhere else, the gallery pays a Pacific round trip per query — an
`iad1` function against a Sydney database served the listing in ~450 ms.

This is why `vercel.json` pins the region:

```json
"regions": ["syd1"]
```

Keep it matched to wherever the Neon project is. Counter-intuitively it should
track the *database*, not the visitors: static pages and artwork are served from
Vercel's CDN edge regardless, so the only thing the function's location changes is
how far it is from Postgres. A single region is fine on the free tier; listing more
than one needs a paid plan.

## 3. Admin mode

Once deployed, visit **once**:

```
https://thumbcinema.alexduckmanton.com/?admin=<your ADMIN_TOKEN>
```

The token is saved to that browser's `localStorage` and immediately scrubbed from the
address bar. From then on, in that browser, every gallery card and flipbook page shows
two toggles:

- **heart** — featured. Puts the flipbook on the home page's default tab.
- **report flag** — NSFW. Hides it from *both* tabs while leaving its own URL working.
  This is also how you pull an abusive save, which matters because saving is public
  and unthrottled.

The token is sent on reads too, which is what makes NSFW flipbooks visible to you in
the All tab — otherwise anything you hid would be impossible to find again.

Notes:

- **Do it per browser.** Phone and laptop each need the link once.
- **If `ADMIN_TOKEN` is unset or shorter than 16 characters the admin API 404s.** It
  fails closed, so forgetting it is safe rather than dangerous.
- **To revoke**, change the env var and redeploy. Any stored copy stops working.
- Don't put the `?admin=` link anywhere public — it's the whole credential.

## 4. Domain

In the Vercel project's **Settings → Domains**, add
`thumbcinema.alexduckmanton.com`. Vercel will give you a CNAME to add wherever
`alexduckmanton.com`'s DNS lives:

```
thumbcinema   CNAME   cname.vercel-dns.com
```

TLS is issued automatically once the record resolves. No code change is needed —
nothing in the app hardcodes a hostname.

## Preview deployments

Every branch gets a preview URL. Point preview at a **Neon branch** rather than
production:

1. In Neon, create a branch off `main` — it's copy-on-write, so you get the full
   archive to test against without paying for a second copy.
2. Set that branch's pooled connection string as the `preview` value of
   `DATABASE_URL`.

This is also the nicest way to develop locally: real data, and you can reset the
branch whenever you've made a mess.

## Working offline

If you'd rather not depend on Neon for local work, any Postgres 14+ will do:

```bash
docker run -d --name thumbcinema-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=thumbcinema \
  -p 5432:5432 postgres:16

# .env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/thumbcinema"

npm run db:migrate
npm run db:import-archive
```

`lib/db.js` disables TLS automatically for localhost connection strings.

## Costs

| | Free tier | This project |
|---|---|---|
| Neon storage | 0.5 GB | 77 MB archive + growth |
| Neon compute | 190 compute-hours/mo | scales to zero when idle |
| Vercel bandwidth | 100 GB/mo | artwork is gzipped and CDN-cached `immutable` |
| Vercel functions | 100 GB-hrs/mo | one small function, mostly cache misses |

The thing most likely to move first is Neon storage, and only if the site gets a lot
of new flipbooks. `npm run db:stats` reports current usage.

## Monitoring

- `npm run db:stats` — row counts, storage, views
- Vercel dashboard → Logs — function errors; the router logs anything 5xx with the
  method and path
- Neon dashboard → Monitoring — storage and compute against the free tier

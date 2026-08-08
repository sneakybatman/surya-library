# Design Doc: Surya Foundation Family Library (Web)

**Goal:** Replace the VB6 + Oracle desktop app with a browser-based catalog of ~2,000 books that any family member can use from any device, costs $0/month, and survives five years of near-zero attention.

---

## 1. Recommended Stack

| Layer | Choice |
|---|---|
| Frontend | Static single page: vanilla HTML/CSS/JS, no build step. Search via **MiniSearch** (~7KB, vendored into the repo). PWA manifest for a home-screen icon. |
| Backend | One **Cloudflare Worker** (plain `fetch` handler, ~6 routes; no framework — six routes don't need one). Serves the static assets and the JSON API. |
| Database | **Cloudflare D1** (managed SQLite). One `books` table. |
| Hosting | **Cloudflare Workers free tier**, on a free `library-surya.workers.dev` URL (custom domain optional, ~$10/yr). |
| Source/CI | GitHub repo; deploy with `wrangler deploy` from macOS (pin the wrangler version). |

**Why this wins:**
- **The dataset is tiny, so exploit that.** 2,000 rows is ~300KB of JSON. The client fetches `/api/books` once (ETag-cached), and MiniSearch gives instant-as-you-type fuzzy search entirely in the browser — critical for transliterated Hindi titles where "Godaan"/"Godan" and "Premchand"/"Prem Chand" must both hit. No server-side search code, no indexes to tune, fast even on a cheap phone on 4G in India.
- **No build step, no framework, vendored dependencies** means nothing rots. A React/Vite app untouched for 3 years often won't build; a folder of static files will serve forever.
- **Workers have no cold starts** (V8 isolates, ~0ms), unlike every free container/VM tier. For a low-traffic family app, cold starts are the #1 free-tier pain, and this eliminates it.
- **SQLite is the escape hatch.** If Cloudflare ever turns hostile, `wrangler d1 export` gives you a `.sql` file that loads into literally anything.

**Alternatives rejected:**
- **Supabase + Netlify/Vercel:** Supabase free tier *pauses projects after ~7 days of inactivity* — a low-traffic family app will trip this constantly, and un-pausing is exactly the maintenance chore we're avoiding. Also more moving parts (Postgres, auth service, SDK churn).
- **Firebase (Hosting + Firestore + Auth):** Firestore can't do fuzzy title search; the SDK churns every year; Google's deprecation record over a 5-year horizon is poor. Heavy lock-in.
- **PocketBase on a VPS:** Genuinely lovely single binary + SQLite + admin UI, but it needs a ~$4–5/month VPS plus OS patching. Not $0, not zero-maintenance. (It's the fallback if Cloudflare's free tier ever dies.)

**Minimal schema sketch (superseded by the full schema in `02-schema.md`):** a single `books` table with title/author (dual script), almirah, shelf, status, notes.

---

## 2. Hosting Plan & Free-Tier Reality Check

**Free-tier limits vs. actual load:** Workers free = 100,000 requests/day, 10ms CPU each; D1 free = 5GB storage, 5M row reads/day, 100k writes/day. Ten family members might generate a few hundred requests/day and a 300KB database. Utilization: well under 1%. Cloudflare's free tier has been stable for a decade and is core to their go-to-market, making it the safest free bet available.

**If the free tier changes anyway:** Workers paid plan is $5/month flat — the worst case is "cheap," not "dead." And because the app is a static folder + one SQLite file, migrating to PocketBase on any VPS, or even Fly/Render, is an afternoon, not a rewrite. The nightly CSV in GitHub (see §4) means the data is never hostage.

**Estimated cost: $0/month.** Optionally +$10/year for a custom domain (nice for parents' bookmarks, not required).

---

## 3. Auth: Shared Family PIN, Long-Lived Cookie

Threat model: the data is a book catalog. The worst realistic outcome of a breach is a vandalized shelf number — and backups undo that. So:

- One **shared family passphrase** (e.g. a 6-digit PIN or short Hindi phrase). Entered on a simple login page.
- The Worker verifies it and sets a **signed, HttpOnly cookie** (HMAC-SHA256 with a secret stored via `wrangler secret`), valid **1 year**. Parents type the PIN once per device, then never again.
- Rate-limit the login endpoint (5 attempts / 15 min per IP, trivially done in the Worker) so the PIN can't be brute-forced.
- Rotating the PIN = changing one secret; no user table, no password resets, no email delivery to debug at 2am.

Reject magic links (email delivery is a perpetual maintenance surface) and per-user accounts (needless for <10 trusted people).

---

## 4. Backup Strategy (Defense in Depth)

The family already lost this data once. Four independent layers:

1. **Git as the archive:** the original extracted CSV is committed to the repo on day one.
2. **Nightly automated export:** a GitHub Actions cron runs `wrangler d1 export` (or hits an authenticated `/api/export`) and commits `books.csv` to the repo *only when it changed*. Git history = free, versioned, off-Cloudflare backups on GitHub's infrastructure. *Gotcha:* GitHub disables scheduled workflows after 60 days of repo inactivity — it emails a warning first; the workflow's own commits count as activity, so in practice one click a year at most.
3. **D1 Time Travel:** built-in 30-day point-in-time restore, zero setup.
4. **"Download CSV" button in the UI**, visible to everyone. Any family member can pull a full copy to their phone at any time — the direct antidote to "we lost access."

Optionally, once a year, email the CSV to two family members. Total cost: $0.

---

## 5. ISBN Barcode Scanning in a Mobile Browser

Feasible and well-trodden, with one design rule: **manual entry is the primary flow; "Scan" is a button on the Add Book form** — most older Hindi titles predate ISBN.

- Camera access via `getUserMedia` works on Android Chrome and iOS Safari; it requires HTTPS, which Cloudflare provides automatically.
- **Decoding:** use the native **`BarcodeDetector` API** where available (Chrome/Android — likely most of the family), and fall back to **`zxing-wasm`** (actively maintained ZXing-C++ WASM build; reads EAN-13 reliably, works on iOS Safari). Vendor the WASM file in the repo. Avoid QuaggaJS (abandoned) and @zxing/browser (maintenance mode).
- **Flow:** scan → EAN-13 starting 978/979 → query **Open Library** (`openlibrary.org/isbn/{isbn}.json`, no key) with **Google Books** (`googleapis.com/books/v1/volumes?q=isbn:…`, keyless for low volume) as fallback → prefill title/author → user confirms and adds almirah/shelf manually. Do the lookups through the Worker to sidestep CORS quirks.
- If either metadata API dies someday, the button degrades gracefully to manual entry — core app unaffected.

Hindi input note: phone keyboards (Gboard Hindi/transliteration) handle Devanagari natively, so `title_devanagari` needs no special input widget.

---

## 6. Deployment & the 5-Year Maintenance Story

**Shipping updates:** edit on the Mac → `git push` → `wrangler deploy` (10 seconds). Optionally a GitHub Action deploys on push to `main`. Pin `wrangler` in `package.json` — it's the only npm dependency in the whole project.

**What breaks in 5 years, honestly:**
- *The deployed Worker:* nothing. Cloudflare keeps deployed Workers running indefinitely; it needs no redeploys to stay alive.
- *The frontend:* nothing. Vanilla JS + vendored libs have no dependency graph to rot; browsers don't break old JS.
- *`wrangler` CLI:* will have new major versions — only matters on the day you next want to change something; budget 30 minutes then.
- *Google Books/Open Library APIs:* may change; affects only the autofill nicety.
- *GitHub Actions cron:* may need its once-a-year "keep enabled" click (§4).

**Steady-state attention required: ~zero.** No servers to patch, no database to vacuum, no certificates to renew, no framework upgrades. This is the payoff of the boring stack.

---

## 7. Phased Build Plan

**Phase 0 — Read-only MVP (weekend 1).** D1 schema; import the CSV (`wrangler d1 execute --file seed.sql`); one static page with search box, results list showing title/author/**almirah + shelf**/status; PIN login; deploy. *The family can find books — the core value — after two days.*

**Phase 1 — Editing (weekend 2).** Add/Edit forms, availability toggle ("mark as lent to…"), Download CSV button, nightly backup Action, PWA manifest + large-type CSS for the parents' phones.

**Phase 2 — Nice-to-haves (as motivated).** Barcode scan + ISBN autofill; Devanagari titles displayed alongside transliteration; filters by almirah/language; login rate-limiting polish.

**Stop there.** Every unbuilt feature is future maintenance you don't owe anyone.

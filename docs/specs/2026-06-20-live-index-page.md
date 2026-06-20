# Design: a live, auto-generated index page

> Status: spec for review · 2026-06-20
> Inspiration (functionality only, **not** the template): https://tools.simonwillison.net/

## Goal

Replace today's hand-curated demo gallery at `/` with a **live, zero-maintenance index of
every deploy on the instance** — the getonup analog of `tools.simonwillison.net`. The index
reflects current R2 state with no rebuild step, true to getonup's "always live" premise.

## What we're borrowing from tools.simonwillison.net (and what we're not)

That site's value is three things: (1) a zero-maintenance **auto-generated** directory of your
artifacts, (2) **chronological discovery** (recently added / by-month), (3) **provenance** (a
colophon linking each tool to the chat that built it). It is automation-driven, **not**
search-driven — it has no search, filter, or sort.

We adopt (1) and (2). We adopt a **light** version of (3): an auto-generated one-line
description per entry (no LLM, no chat transcripts — getonup doesn't capture those). We take
none of the visual template.

## Locked decisions

1. **Listing model: all deploys, public.** The index lists every deploy on the instance,
   with no auth. This is a deliberate shift from today's privacy posture (unguessable
   `/s/:id` URLs that are unlisted-by-default) — see Risks. The opt-in alternative is noted
   as a future toggle so the change is reversible.
2. **Row content: title · date · auto-generated description.** Grouped by month, newest
   first, with a per-month count — the by-month structure from the reference site.
3. **The current curated gallery is preserved**, not deleted: snapshot it to `docs/mockups/`
   as a design reference, and stop the demo script from rewriting the homepage.

## Architecture

```
GET /              → static index shell (ASSETS, zero Worker CPU)
                       └─ on load, fetch ─▶ GET /api/index  (public JSON)
                                              └─ R2 prefix list + parallel _meta.json reads (I/O only)

deploy (CLI)       → extract description from the artifact ─▶ _meta.json gains `description`
```

No new infrastructure. The index page is a static shell served by the existing `ASSETS`
binding; it renders client-side from a single public JSON endpoint. The Worker stays
pure-I/O, consistent with the project's "~no CPU" constraint.

## Changes

### 1. Server — `server/src/index.ts`

- **New route `GET /api/index` (public, no token).** Mirrors `handleList`'s R2 traversal but
  returns a trimmed, non-sensitive projection per deploy:
  `{ id, title, description, type, created_at, bytes }`. Sorted newest-first (as `handleList`
  already does). `GET /api/list` is unchanged and remains token-gated.
- **`handleDeploy` stores `description`.** Accept an optional `body.description` (string,
  trimmed, capped like `title` at ~200 chars) and include it in the `_meta.json` it writes.
  No description extraction happens on the server — it only persists what the CLI sends.

### 2. CLI — `cli/src/` (deploy path in `index.ts`, plus `api.ts` `DeployBody`)

At deploy time, derive `description` automatically and send it in the deploy body:

- **Pick the entry HTML to scan:** `html` type → the source content; `static` folder → the
  folder's `index.html`; wrapped `react`/`vue`/`js` → none (it's source code, not a document).
- **Extract, in priority order:** `<meta name="description" content="…">` → else `<title>…`
  (only if it differs from the deploy `title`/filename) → else leave unset.
- If unset, send nothing; the page synthesizes a fallback at render time (below). This keeps
  the stored data honest (a real description only when one genuinely exists) and means **no
  per-deploy schema is required for old deploys to look complete**.
- `mcp.ts` deploy path gets the same extraction (shared helper).

### 3. Index page — `server/public/index.html` (rewritten, hand-authored, committed)

A self-contained HTML+JS shell (our own visual language). On load:

- `fetch('/api/index')`, group deploys by `created_at` month, render newest month first.
- Each row: **title** (links to `/s/:id`) · **date** · **description**.
- **Description fallback** (client-side, for deploys with no `description`, including every
  artifact deployed before this feature): synthesize `"<type> · <n> file(s) · <size>"` from
  `type` / `bytes` (file count isn't in the trimmed projection — use a `"<type> · <size>"`
  form, or add `files`-count to the projection if we want the count; default: `type · size`).
- Empty state: a friendly "nothing deployed yet — `getonup deploy …`" message.
- A light header (instance name + one line on what getonup is). No search/filter/sort.

This file currently holds the curated gallery and is **overwritten by `publish-demo.mjs`** —
both of those facts change (next section).

### 4. Preserve the curated gallery + stop the homepage rewrite

- **Snapshot** the current rendered `server/public/index.html` to
  `docs/mockups/landing-gallery.html`, bringing its `thumbs/` (so the mockup still renders) —
  or self-contain it. It stays as a design reference only; it is not served.
- **`scripts/publish-demo.mjs`:** remove the homepage-writing block (lines ~203–208 that
  write `server/public/index.html` and copy `server/public/thumbs/`). The script still
  deploys the 20 landing demos, so they now appear in the live index automatically. The
  separate "gallery folder" deploy (line ~199) is redundant with the live index and may be
  dropped (optional cleanup, not required).

## Out of scope (YAGNI — the reference site has none of these either)

- Search / filter / sort.
- LLM-generated descriptions (the reference site's Haiku step).
- A rich per-deploy colophon/detail page or redeploy history.
- `updated_at` + a "recently updated" section. getonup's stable-id redeploy could power this,
  but it needs preserving `created_at` across redeploys; easy follow-up, not MVP.
- `sitemap.xml` / RSS. Only matters if SEO on a self-hosted index is wanted; ~1-hour add-on.

## Risks & tradeoffs

- **Privacy (chosen knowingly).** "All deploys public" means a quick, semi-private share is
  now discoverable on the homepage. Documented; the opt-in-listing alternative (a `listed`
  meta flag + `--list` flag, filtered endpoint) remains available as a future toggle.
- **Scale.** `/api/index` reads one `_meta.json` per deploy — fine for hundreds, heavy for
  thousands (thousands of R2 GETs per homepage hit). Mitigation if it grows: maintain a
  single cached aggregate index object updated on deploy/delete. Note the threshold; do not
  pre-build the cache.
- **Description quality.** Extraction is strong for hand-written HTML, weak for auto-wrapped
  React (title is usually the filename). The synthesized fallback keeps those rows
  informative without over-promising.

## Verification (success criteria)

1. `GET /api/index` returns `200` + JSON **without** an `Authorization` header; `GET /api/list`
   still returns `401` without a token. (server test)
2. Deploying an HTML file containing `<meta name="description" content="X">` results in
   `_meta.json.description === "X"`, surfaced by `/api/index`. (integration test)
3. Deploying a React component (no description) stores no `description`; the index renders it
   with a synthesized fallback line. (unit + manual)
4. `/` renders the live index grouped by month, newest first, each title linking to `/s/:id`;
   a freshly-deployed artifact appears with no rebuild. (manual via `wrangler dev`)
5. A deploy whose `_meta.json` predates this feature (no `description`) still renders with a
   fallback line. (manual: deploy, hand-strip the field, reload)
6. The curated gallery exists under `docs/mockups/`; `publish-demo.mjs` no longer writes
   `server/public/index.html`; `npm run demo` leaves the live index in place and the 20 demos
   show up in it. (manual)

## Open questions

- Spec lives at `docs/specs/` (repo's `docs/`-oriented convention) rather than the skill's
  default `docs/superpowers/specs/`. Move if you'd prefer elsewhere.
- Include a file **count** in `/api/index` (enables `type · N files · size` fallback) or keep
  the projection minimal (`type · size`)? Minor; defaulting to minimal unless you want counts.

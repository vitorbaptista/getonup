# Conjure — Plan (v2)

> **Conjure** — open-source, self-hostable **OneClickLive**. Turn any AI-generated web
> artifact into a **live, shareable URL** with one command. A small CLI you (or your coding
> agent) run locally; a self-hosted **Cloudflare Worker + R2** backend that **scales to zero**
> (~$0 idle). Free software (MIT). You bring a deploy token; viewers need nothing.
>
> `conjure deploy index.html` → `https://your-conjure.example/s/ab12cd34` ✨

_Reference product: https://oneclicklive.app (paste AI code → instant live site, auto-wraps
React/Vue with Babel+Tailwind, Cloudflare edge sandbox, browser-only, closed-source, paid).
Conjure does the same magic but **open-source, self-hostable, scale-to-zero, and CLI/agent-
driven** so any agent gains a "publish this live" superpower._

**Locked decisions (from the user):** primary input = a **single HTML file** (also a static
folder, and single-file React/Vue/JS auto-wrapped); **deploy-token** auth; **path-based**
URLs on one hostname. A narrow dynamic backend is a *nice-to-have* but must never break
scale-to-zero → **static-only MVP**, dynamic deferred.

---

## 1. What it does (user / agent flow)

1. **Install once:** `npm i -g conjure-live` (or `npx conjure …`, or a single binary via
   `curl … | sh`). Configure: `conjure login --url https://your-conjure.example --token <T>`.
2. **An agent (or you) builds an artifact** — a `.html`, a single `.jsx/.tsx`, a `.vue`, a
   `.js`, or a built static folder.
3. **Publish:** `conjure deploy artifact.tsx` → the CLI auto-detects the type, **auto-wraps**
   single components into a self-contained page (React 18 + Babel + esm.sh import maps +
   Tailwind; Vue 3 CDN), uploads to your Worker, and prints a **live URL** in seconds.
4. **Share the link.** No viewer login. Scales to zero between visits.
5. **Manage:** `conjure list`, `conjure open <id>`, `conjure rm <id>`.

Also: `cat artifact.html | conjure deploy -` (shellshare-style pipe), `--open` to launch the
browser, `--json` for scripts/agents.

### Why CLI (the differentiator vs OneClickLive)
OneClickLive is browser-paste only. Conjure is **driven by a CLI** so it composes with any
agent: the agent writes a file and runs one command. We ship an `AGENTS.md` snippet + a
Claude Code skill (+ optional MCP server, stretch) so "tell your agent to use Conjure" is
copy-paste.

---

## 2. Architecture

```
   ┌──────────── your machine ────────────┐         ┌──────────── Cloudflare (your account) ───────────┐
   │  conjure CLI (Node/TS, one command)  │  HTTPS  │  ONE Worker (one `wrangler deploy`)               │
   │   • detect + AUTO-WRAP the artifact  │  Bearer │   POST /api/deploy   (token) → store bundle in R2 │
   │     (html / react / vue / js / dir)  │ ──────▶ │   GET  /api/list     (token) → list deploys       │
   │   • bundle → POST /api/deploy        │         │   DEL  /api/deploy/:id (token)→ delete            │
   │   • print live URL                   │ ◀────── │   GET  /s/:id[/*]            → serve from R2       │
   └──────────────────────────────────────┘  {url}  │   GET  /                    → landing/health      │
                                                     │         (+ optional browser paste UI, stretch)    │
        agent calls the CLI ↑                        │  R2 bucket "BUCKET": <id>/index.html, assets, meta│
                                                     └────────────────────────────────────────────────────┘
        secret: CONJURE_DEPLOY_TOKEN (Worker secret)            storage: R2 (scale-to-zero, no egress fees)
```

**Server = a pure static host.** It stores uploaded bytes in R2 and serves them with correct
content-types + security headers. **All cleverness (detection, wrapping, bundling) lives in
the CLI** → the Worker does ~no CPU work (safe within the 10ms free limit), and the wrapping
logic is versioned/tested in the CLI rather than the edge.

**Why this hits every constraint:**
- *One unit / scale-to-zero:* one Worker + one R2 bucket; Workers bill per request, R2 per
  storage/op, no egress fees → ~$0 idle. `wrangler deploy` ships it.
- *Trivial self-host:* set one secret (`CONJURE_DEPLOY_TOKEN`), create one R2 bucket
  (Deploy-to-Cloudflare button provisions it), done. Point the CLI at it.
- *Safe:* viewing is public and the API is **bearer-token** (not a browser cookie), so a
  served artifact's JS has no session to steal; path-based default (document the per-deploy
  **subdomain** upgrade for origin isolation between artifacts); security headers on every
  served response; per-deploy size cap; optional opt-in CSP on served artifacts.
- *Auth delegated:* deploy token by default; Cloudflare Access can wrap the whole Worker
  (incl. the API) with zero app code as an upgrade.

---

## 3. The auto-wrap engine (the "magic", in the CLI)

Detect input type and produce a single self-contained `index.html` (+ any sibling assets):

| Input | Detection | Output |
|---|---|---|
| Full HTML doc | `<!doctype`/`<html>` present | host as-is |
| HTML fragment | HTML tags, no `<html>` | wrap in a minimal styled shell |
| **React/JSX/TSX** | `export default`/JSX/`import … react` | shell with React 18 + ReactDOM (esm.sh), `@babel/standalone` (`text/babel`, presets react+typescript), import-map from scanned deps (allowlist), Tailwind Play CDN; mount default export to `#root`; runtime error overlay |
| **Vue SFC** | `<template>`/`<script setup>` | shell with Vue 3 (esm.sh/CDN), compile SFC, mount |
| Plain JS | `.js`, no markup | wrap in HTML with `<div id="app">` + `<script>` |
| **Static folder** | a directory | upload all files; `index.html` is the entry; no wrapping |

- **Import maps** scan `import … from "<pkg>"` and map allowlisted bare specifiers to pinned
  `https://esm.sh/<pkg>@<ver>` (react, react-dom, lucide-react, recharts, clsx, three,
  framer-motion, d3, zustand, marked, …); unknown specifiers → a friendly "unsupported
  dependency" note instead of a blank page. Versions pinned; optional SRI.
- Wrapped pages are **standalone** (the URL *is* the site, not an iframe wrapper) — exactly
  OneClickLive's behavior. (Templates reuse the sandbox/import-map research already done.)
- `--type <html|react|vue|js|static>` overrides detection; `--no-wrap` hosts raw.

---

## 4. Server (`server/`, one Worker)

- **`POST /api/deploy`** (Bearer `CONJURE_DEPLOY_TOKEN`): body = a small manifest + files
  (single HTML inline, or a `multipart`/tar/zip for multi-file). Validate token, total-size
  cap, file count, path-safety (no `..`). Generate a short random `id` (e.g. 8 url-safe
  chars). Write each file to R2 at `<id>/<path>`; write `<id>/_meta.json`
  (`{id,title,type,files,bytes,created_at}`). Return `{ id, url }`.
- **`GET /s/:id` and `GET /s/:id/*`**: look up R2 object (`/s/:id` → `<id>/index.html`).
  Stream the body with the right `Content-Type` (from stored metadata/extension),
  `Cache-Control`, and security headers (`X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options`/`frame-ancestors` configurable, optional
  CSP). 404 (styled) if missing.
- **`GET /api/list`** (token) → deploys (from R2 prefix listing of `*/_meta.json`).
  **`DELETE /api/deploy/:id`** (token) → delete all `<id>/*`.
- **`GET /`** → a small landing page (what it is + how to install the CLI + health). Optional
  **browser paste UI** (drop a file / paste code → same `/api/deploy`) as a stretch, so it's
  usable without the CLI too.
- **Correct status codes:** 401 (no/bad token), 404 (missing id), 413 (too large), 400 (bad
  input). No silent failures.
- `wrangler.jsonc`: one `r2_buckets` binding `BUCKET` with a default name (Deploy button
  provisions it). Static landing via Workers Static Assets (or inline). Minimal CPU per
  request (pure I/O) → free-tier safe.

---

## 5. CLI (`cli/`, Node + TypeScript)

- **Commands:** `login` (save `{url, token}` to `~/.config/conjure/config.json`, or read
  `CONJURE_URL`/`CONJURE_TOKEN` env), `deploy <path|->`, `list`, `open <id>`, `rm <id>`,
  `whoami`/`config`.
- **`deploy`:** resolve input → detect type → auto-wrap → collect files → `POST /api/deploy`
  → print the URL (plain on stdout for piping; `--json` for agents; `--open` to launch).
  Flags: `--name`, `--type`, `--no-wrap`, `--quiet`.
- **Agent-friendly:** deterministic output (URL is the last stdout line), non-zero exit on
  failure with a clear message, `--json`, no interactive prompts in `deploy`.
- **Distribution:** npm package (`npx conjure-live` / `npm i -g`), plus a `bun build
  --compile` single-binary target + a `curl … | sh` installer (the "one binary" / shellshare
  install story). Node CLI is the MVP; binary packaging follows.

---

## 6. Agent integration (the point)

- **`AGENTS.md` / README snippet:** "To publish a web artifact live, run
  `conjure deploy <file>` and share the printed URL." Drop into Claude Code / Cursor / Aider.
- **Claude Code skill** (`/conjure` or a `conjure-deploy` skill) that wraps the CLI.
- **(Stretch) MCP server** exposing a `deploy_artifact` tool so MCP-aware agents discover it.

---

## 7. Repo layout

```
conjure/
├── README.md            # Deploy-to-Cloudflare badge, 5-min self-host, CLI usage, agent snippet
├── LICENSE (MIT) · PLAN.md · PROGRESS.md · CONTRIBUTING.md
├── package.json         # npm workspaces: cli, server
├── cli/
│   ├── package.json · tsconfig.json · bin/conjure.js
│   └── src/ index.ts · commands/{deploy,list,login,rm,open}.ts · wrap/{detect,react,vue,html,js,importmap}.ts · config.ts · api.ts
├── server/
│   ├── wrangler.jsonc · package.json · tsconfig.json
│   ├── src/ index.ts · routes/{deploy,serve,list,landing}.ts · auth.ts · store.ts · ids.ts · headers.ts
│   └── assets/ (landing page; optional paste UI)
├── shared/ wrap-templates (if shared) · types.ts
├── examples/ hello.html · counter.tsx · todo.vue · static-site/
└── install.sh           # curl|sh installer
```

---

## 8. Build phases (each independently verifiable)

1. **Scaffold** — workspaces; `server/` Worker (hello + R2 binding + `wrangler.jsonc`);
   `cli/` skeleton; MIT, `.dev.vars.example` (`CONJURE_DEPLOY_TOKEN=`). `wrangler dev` runs.
2. **Server core** — `POST /api/deploy` (token, R2 write, id) + `GET /s/:id[/*]` (R2 serve +
   headers) + status codes. Verify with `curl` against `wrangler dev`.
3. **CLI deploy (HTML/static)** — config, detect, upload a single HTML file & a folder, print
   URL. End-to-end: `conjure deploy examples/hello.html` → working live URL locally.
4. **Auto-wrap** — React/TSX → self-contained page (Babel + esm.sh import maps + Tailwind);
   Vue; JS fragment; import-map scan + allowlist; error overlay. Unit tests for detection +
   wrapping. Deploy `examples/counter.tsx` and see it run.
5. **Management** — `list`, `rm`, `open`; `/api/list` + `DELETE`. Landing page.
6. **Safety + hardening** — security headers, size/file caps, path-safety, optional CSP,
   document subdomain-isolation + Cloudflare Access upgrades.
7. **Agent integration** — `AGENTS.md` snippet + Claude Code skill; `--json`/exit codes.
8. **Polish + packaging** — distinctive landing/CLI UX, single-binary build (`bun --compile`)
   + `curl|sh` installer, examples, GIF.
9. **Docs + one-click deploy** — README with Deploy-to-Cloudflare badge, token setup, custom
   domain/subdomain notes, agent guide.
10. **Verify** — `wrangler dev` smoke; deploy each example type; confirm scale-to-zero shape;
    optional real Cloudflare deploy test.

Use `codex exec "<prompt>"` (GPT 5.5 — note: NOT `codex -p`, which is `--profile`) for
independent module work/review; give subagents explicit goals + loop-until-tests-pass.

---

## 9. Risks → mitigations

1. **Served artifact abuses the API / reads another deploy's data** → API is bearer-token
   (no origin cookie to steal); path-based default + documented per-deploy subdomain for
   origin isolation; security headers; optional CSP `connect-src` allowlist.
2. **Malicious upload (huge/zip-bomb/path traversal)** → size + file-count caps, reject `..`
   and absolute paths, stream to R2, content-type from a safe map.
3. **CDN supply chain (esm.sh/Babel/Tailwind in wrapped pages)** → pin versions, optional
   SRI, document a self-hosted esm.sh mirror for air-gapped installs.
4. **Open deploy endpoint burns storage** → token required; size caps; document Cloudflare
   Access / rate-limit on `/api/*`; optional max-deploys.
5. **Free-tier limits (Workers 100k req/day; R2 10GB + op limits)** → fine for self-host;
   static-asset-style serving is cheap; `$5/mo` only at scale.
6. **"One binary" expectation** → ship npm (works via `npx` everywhere) **and** a compiled
   single binary + installer so the literal one-binary story holds.
7. **Dynamic-backend temptation** → explicitly out of MVP; if added later, only via a
   scale-to-zero path (per-deploy Worker / Workers for Platforms), behind a flag.

---

## 10. Definition of done (MVP)

- `npm i -g conjure-live` (or `npx`) → `conjure deploy hello.html` against a self-hosted
  Worker → a working public live URL in seconds.
- One **Deploy to Cloudflare** click → set `CONJURE_DEPLOY_TOKEN` → working instance.
- Auto-wraps a single `.tsx`/`.vue`/`.js` into a live page (OneClickLive parity); hosts a
  static folder; path-based `/s/:id`; `list`/`rm`/`open` work.
- A coding agent can publish by running one CLI command (documented snippet + skill).
- $0 when idle; clean MIT repo; README a non-expert follows in ~5 minutes.
```

### Status
- Research workflow ✅ (transferable infra facts). Old chat-UI plan ✅ discarded after user
  correction. oneclicklive reviewed ✅. **This plan (v2) is the active one.** Next: scaffold
  (phase 1) → server core (phase 2).

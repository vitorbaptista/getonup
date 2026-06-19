<div align="center">

# ✨ Conjure

**Your AI artifact, live in seconds.**

Turn any AI-generated web artifact — an HTML file, a React/Vue component, or a built static
folder — into a **live, shareable URL** with one command. Open-source, self-hosted, scale-to-zero. A tiny CLI any coding agent can call; a single Cloudflare
Worker backend that **scales to zero** (~$0 when idle).

```bash
cjr deploy counter.tsx
✓ live → https://conjure.example.com/s/iwcmg3dt
```

[![License: MIT](https://img.shields.io/badge/license-MIT-22d3ee)](./LICENSE)
&nbsp;·&nbsp; one Worker + R2 &nbsp;·&nbsp; scale-to-zero &nbsp;·&nbsp; bring your own API key

<br/>

<img src="docs/landings/midnight.png" alt="Conjure landing page" width="760" />

</div>

---

## Why

AI assistants generate gorgeous little apps — but they're trapped in a chat window. Getting one
onto a real URL usually means a closed, browser-only, paid service. Conjure does it from the
command line, on infrastructure you own:

- **Open-source & self-hosted** — your Cloudflare account, your data, your token. MIT.
- **CLI-first / agent-native** — your coding agent runs one command and gets a URL back.
  Drop the snippet in `AGENTS.md` and every agent gains a "publish this live" superpower.
- **Scale-to-zero** — one Cloudflare Worker + an R2 bucket. No always-on server, no database.
  ~$0 when nobody's looking.
- **Auto-wrap** — hand it a bare `.tsx`/`.vue`/`.js` and it becomes a self-contained, runnable
  page (React 18 + Babel + Tailwind, Vue 3). Or a full HTML file / static folder, served as-is.

---

## Quickstart

### 1. Host the server (≈ 5 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
[Node](https://nodejs.org) ≥ 20.

```bash
git clone https://github.com/YOUR_USERNAME/conjure.git
cd conjure
npm install

# create the R2 bucket the Worker stores deploys in
npx --workspace server wrangler r2 bucket create conjure

# set your deploy token (anything secret; the CLI uses it to publish)
echo "CONJURE_DEPLOY_TOKEN=$(openssl rand -hex 32)" # copy this value
npx --workspace server wrangler secret put CONJURE_DEPLOY_TOKEN   # paste it when prompted

# ship it
npm run deploy
# → https://conjure.<your-subdomain>.workers.dev
```

That's the whole backend: one Worker, one bucket, one secret. It costs nothing at idle.

> **Tip:** put it behind [Cloudflare Zero Trust / Access](#hardening) and disable the default
> `*.workers.dev` route for a locked-down instance — no app code required.

### 2. Install & point the CLI

```bash
# from the cloned repo (until the npm package is published):
npm run build --workspace cli
npm link --workspace cli            # installs `cjr` (+ `conjure`, `conjure-live` aliases)
#   (or just: alias cjr="node $(pwd)/cli/dist/index.js")

cjr login --url https://conjure.<your-subdomain>.workers.dev --token <your-token>
```

Config is saved to `~/.config/conjure/config.json`, or pass `CONJURE_URL` / `CONJURE_TOKEN`
as env vars (handy for CI and agents).

> **Command name:** the CLI is **`cjr`** (short and collision-free). `conjure` and `conjure-live`
> are aliases — but bare `conjure` clashes with ImageMagick's `/usr/bin/conjure` on many systems,
> so the docs use `cjr`.

### 3. Deploy something

```bash
cjr deploy index.html              # a full HTML file → served as-is
cjr deploy counter.tsx --open      # a React component → auto-wrapped & opened
cjr deploy card.vue                # a Vue SFC → auto-wrapped
cat art.html | cjr deploy -        # pipe from stdin (shellshare-style)
cjr deploy ./dist                  # a built static site (needs index.html)

cjr list                           # everything you've published
cjr rm <id>                        # take one down
```

Every `deploy` prints the live URL as the last line of stdout (use `--json` for structured
output, `--quiet` for just the URL) — easy to script and easy for an agent to read.

---

### Preview locally first — no deploy, no token

`cjr serve` is the server *and* the uploader in one command. It wraps your artifact and
hosts it on `localhost` with live-reload — nothing leaves your machine, no Cloudflare needed:

```bash
cjr serve counter.tsx --open --watch   # http://localhost:4321, reloads on save
cjr serve ./dist                        # serve a built folder
cat page.html | cjr serve -             # from stdin
```

Then `cjr deploy` the same artifact when you want a public URL.

## Give it to your agent

This is the point. Add a few lines to your project's `AGENTS.md` (or `CLAUDE.md`,
`.cursorrules`, …) and your agent can publish its own work:

```markdown
## Publishing artifacts

To share a web artifact (HTML page, React/Vue component, or built static site) as a live URL,
run: `cjr deploy <file-or-dir>` and give the user the printed URL.
- Single components are auto-wrapped (React/Vue/Tailwind) — just point at the .tsx/.vue/.html.
- Use `--json` if you need to parse the result.
```

See [`AGENTS.md`](./AGENTS.md) in this repo for a ready-to-copy block, and
[`skills/conjure`](./skills/conjure) for a Claude Code skill.

### …or as an MCP server

`cjr mcp` runs Conjure as an [MCP](https://modelcontextprotocol.io) server over stdio, exposing
`deploy_artifact`, `list_deploys`, and `remove_deploy` as tools. Point any MCP-aware agent at it —
no shelling out:

```json
{
  "mcpServers": {
    "conjure": {
      "command": "cjr",
      "args": ["mcp"],
      "env": { "CONJURE_URL": "https://your-conjure.example", "CONJURE_TOKEN": "your-token" }
    }
  }
}
```

---

## Supported inputs

| You give it | Conjure does |
|---|---|
| `.html` (full document) | serves it verbatim |
| `.html` (fragment) | wraps it in a minimal styled page |
| `.jsx` / `.tsx` | React 18 + `@babel/standalone` + esm.sh import map + Tailwind; mounts your default export |
| `.vue` | Vue 3 + `vue3-sfc-loader` |
| `.js` | a module shell (with an esm.sh import map if you use bare imports) |
| a directory | uploads the folder as a static site (must contain `index.html`) |

`import` statements for npm packages (e.g. `lucide-react`, `recharts`) are resolved at runtime
via [esm.sh](https://esm.sh) — no bundler, no build step. Use `--no-wrap` to host raw source,
`--type` to override detection, `--no-tailwind` to skip the Tailwind CDN.

---

## How it works

```
  conjure CLI                         one Cloudflare Worker
  ───────────                         ─────────────────────
  detect + auto-wrap   ──POST /api/deploy (Bearer token)──▶   store files in R2 under <id>/
  the artifact          ◀──────────── { id, url } ──────────  write <id>/_meta.json
                                                              GET /s/<id>[/*] → stream from R2
  share the URL  ◀────────────────────────────────────────   GET /        → landing page
```

- **The server is a dumb static host.** All the cleverness (type detection, wrapping, import
  maps) runs in the CLI. The Worker just stores bytes and serves them — near-zero CPU, so it
  stays inside Cloudflare's free-tier 10 ms/invocation budget and scales to zero.
- **Storage is [R2](https://developers.cloudflare.com/r2/)** (object storage, no egress fees,
  generous free tier). No database to run or pay for.
- **Auth is a deploy token** (a Worker secret), not a browser session. Deployed sites are
  public; only publishing needs the token.

---

## Security model

Conjure serves untrusted, AI-generated code. The design keeps that safe:

- **No session to steal.** The serving origin carries no Conjure auth cookie — auth is a CLI
  bearer token. A malicious artifact's JS has nothing to exfiltrate from your account.
- **Fail-closed deploys.** If `CONJURE_DEPLOY_TOKEN` isn't set, the deploy API is disabled.
- **Hard caps** on total size (`MAX_BYTES`, default 20 MB) and file count (`MAX_FILES`),
  path-traversal rejection, and `nosniff` / `no-referrer` headers on served files.
- **Path-based by default** (`/s/<id>`). For stronger isolation between deployments, serve each
  on its own subdomain (see Hardening).

### Hardening

- **Put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)**
  for human auth with zero app code, and **disable the default `workers.dev` route** so only
  your Access-protected custom domain is reachable.
- **Per-deploy subdomain isolation:** map a wildcard (`*.conjure.example.com`) and serve
  `<id>.conjure.example.com` so each artifact gets its own origin. (Path-based is the simple
  default; subdomains are the upgrade.)
- **Rate-limit `/api/*`** with a Cloudflare WAF rule to bound abuse and spend.

---

## Configuration

| Setting | Where | Default | What |
|---|---|---|---|
| `CONJURE_DEPLOY_TOKEN` | Worker **secret** | — (required) | the token the CLI publishes with |
| `MAX_BYTES` | `wrangler.jsonc` `vars` | `20971520` | max total bytes per deploy |
| `MAX_FILES` | `wrangler.jsonc` `vars` | `300` | max files per deploy |
| `CONJURE_PUBLIC_URL` | `wrangler.jsonc` `vars` | request origin | force the base URL in printed links |
| `CONJURE_URL` / `CONJURE_TOKEN` | CLI env | from `~/.config/conjure` | server + token for the CLI |

---

## Hosting alternatives

Conjure's own backend is one Cloudflare Worker + R2 (above). But the artifacts you host with it
are just self-contained HTML, so you can host them other ways too — pick by what your artifacts
actually need:

| | **Conjure** (Worker + R2) | **GitHub Pages** | **Datasette Apps** |
|---|---|---|---|
| Infra | 1 Worker + 1 bucket | none (a Git repo) | a running [Datasette](https://datasette.io) server |
| Cost at idle | ~$0 (scale-to-zero) | $0 (static) | cost of an always-on server |
| Publish | `cjr deploy` (token) | `git push` | paste into a "Create app" form |
| Dynamic data | no (static / client-side) | no | **yes** — SQL queries, auth, writes |
| Best for | instant shareable URLs, agent-driven, scale-to-zero | a versioned collection of static tools | apps that need a real database + permissions |

### GitHub Pages — a repo of static HTML ([simonw/tools](https://github.com/simonw/tools) style)

Conjure isn't the only way to host. Since your agent produces self-contained HTML, you can commit
those files to a Git repo and let GitHub Pages serve them — each becomes
`youruser.github.io/repo/tool.html` (a `CNAME` adds a custom domain), and you can group them in
folders. Preview locally with `cjr serve` first, then:

```bash
git -C tools add dashboard.html && git commit -m "add dashboard" && git push   # the push *is* the deploy
```

Zero infrastructure, free, fully Git-versioned, scales to zero — but **static only** (no dynamic
routes). Here Conjure isn't in the loop at all; GitHub Pages is the host.

### Datasette Apps — when an artifact needs real data

[Datasette Apps](https://simonwillison.net/2026/Jun/18/datasette-apps/) host HTML+JS apps inside a
[Datasette](https://datasette.io) instance: each runs in a tightly sandboxed `<iframe>` (no
cookie/localStorage access, strict CSP) and talks back to Datasette via `postMessage` to run **SQL
queries** (`await datasette.query(db, sql)`) with the **logged-in user's permissions** and
optional allow-listed writes. That's the thing pure static hosting can't do: relational data,
auth, and server-backed state.

The trade-off: it needs a **persistent Datasette server** (so no scale-to-zero / $0-idle), and
apps are authored in Datasette's UI rather than via `cjr`. So it isn't "better in all senses" —
it's the right pick when your artifact is a *data app* (a dashboard over your own DB, an internal
tool), while Conjure and GitHub Pages win for instant, scale-to-zero hosting of standalone
artifacts. You can even combine them: prototype the UI with `cjr serve`, then move it into a
Datasette App once it needs a database.

## Limitations & roadmap

- **Static & client-side only** (no server-side Python/full-stack). This is what keeps it
  scale-to-zero. A future flag may add per-deploy Workers for dynamic apps.
- esm.sh / the Tailwind & Babel CDNs are runtime dependencies of wrapped pages — versions are
  pinned; a self-hosted esm.sh mirror is a planned option for air-gapped installs.
- Planned: a "Deploy to Cloudflare" one-click button, an MCP server for agents, custom
  domains/subdomains UX, optional D1 metadata index, and a browser paste UI.

---

## Landing page designs

Five landing-page directions ship in [`landings/`](./landings) — Midnight, Scanini, Shellshare,
PostHog, and Claude — plus a **gallery** that links to all of them (the current homepage). Every
one was generated and then **deployed through Conjure's own CLI**, so they double as a live demo.
See [`LANDINGS.md`](./LANDINGS.md) for the gallery and live URLs. Swap the homepage to a single
design with `cp landings/<key>.html server/public/index.html`.

## Development

```bash
npm install
npm run dev                 # wrangler dev (local server at http://localhost:8787)
npm test                    # CLI wrap-engine unit tests
npm run typecheck           # both workspaces
```

See [`PLAN.md`](./PLAN.md) for the full design and [`PROGRESS.md`](./PROGRESS.md) for status.

## License

[MIT](./LICENSE) — Conjure contributors.

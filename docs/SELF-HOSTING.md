# Self-hosting getonup

getonup's backend is **one Cloudflare Worker + one R2 bucket** — it scales to zero, so it costs
~$0 when idle. This guide covers deploying it to a public URL, configuring it, and securing it.

> Just want to try getonup on your machine? You don't need any of this — see
> [Run it locally](../README.md#run-it-locally-no-cloudflare-account) in the README. `npm run dev`
> uses local miniflare storage with no Cloudflare account.

## Deploy to Cloudflare (≈ 5 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
[Node](https://nodejs.org) ≥ 20.

```bash
git clone https://github.com/YOUR_USERNAME/getonup.git   # your fork
cd getonup
npm install

# create the R2 bucket the Worker stores deploys in
npx --workspace server wrangler r2 bucket create getonup

# set your deploy token — generate one, pipe ONLY the value into the secret, and save it
TOKEN=$(openssl rand -hex 32)
echo -n "$TOKEN" | npx --workspace server wrangler secret put GETONUP_DEPLOY_TOKEN
echo "$TOKEN"   # this exact value is what you pass to `getonup login --token`

# ship it
npm run deploy
# → https://getonup.<your-subdomain>.workers.dev
```

That's the whole backend: one Worker, one bucket, one secret. It costs nothing at idle.

## Point the CLI at your instance

```bash
npm run build --workspace cli
npm link --workspace cli            # installs `getonup`

getonup login --url https://getonup.<your-subdomain>.workers.dev --token <your-token>
```

Config is saved to `~/.config/getonup/config.json`, or pass `GETONUP_URL` / `GETONUP_TOKEN` as env
vars. Now `getonup deploy <file>` publishes to your instance. See the [CLI reference](./CLI.md).

## Configuration

| Setting | Where | Default | What |
|---|---|---|---|
| `GETONUP_DEPLOY_TOKEN` | Worker **secret** | — (required) | the token the CLI publishes with |
| `MAX_BYTES` | `server/wrangler.jsonc` `vars` | `20971520` | max total bytes per deploy |
| `MAX_FILES` | `server/wrangler.jsonc` `vars` | `300` | max files per deploy |
| `GETONUP_PUBLIC_URL` | `server/wrangler.jsonc` `vars` | request origin | force the base URL in printed links |
| `GETONUP_URL` / `GETONUP_TOKEN` | CLI env | from `~/.config/getonup` | server + token for the CLI |

## Security model

getonup serves untrusted, AI-generated code. The design keeps that safe:

- **No session to steal.** The serving origin carries no getonup auth cookie — auth is a CLI bearer
  token. A malicious artifact's JS has nothing to exfiltrate from your account.
- **Fail-closed deploys.** If `GETONUP_DEPLOY_TOKEN` isn't set, the deploy API is disabled.
- **Hard caps** on total size (`MAX_BYTES`) and file count (`MAX_FILES`), path-traversal rejection,
  and `nosniff` / `no-referrer` headers on served files.
- **Path-based by default** (`/s/<id>`). For stronger isolation between deployments, serve each on
  its own subdomain (see Hardening).

### Hardening

- **Put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)**
  for human auth with zero app code, and **disable the default `workers.dev` route** so only your
  Access-protected custom domain is reachable.
- **Per-deploy subdomain isolation:** map a wildcard (`*.getonup.example.com`) and serve
  `<id>.getonup.example.com` so each artifact gets its own origin. (Path-based is the simple
  default; subdomains are the upgrade.)
- **Rate-limit `/api/*`** with a Cloudflare WAF rule to bound abuse and spend.

## How it works

```
  getonup CLI                              one Cloudflare Worker
  ───────                              ─────────────────────
  detect + auto-wrap   ──POST /api/deploy (Bearer token)──▶   store files in R2 under <id>/
  the artifact          ◀──────────── { id, url } ──────────  write <id>/_meta.json
  share the URL  ◀──────── GET /s/<id>[/*] stream from R2 ──   GET / → gallery / landing
```

- **The server is a dumb static host.** All the cleverness (type detection, wrapping, import maps)
  runs in the CLI. The Worker just stores bytes and serves them — near-zero CPU, so it stays inside
  Cloudflare's free-tier budget and scales to zero.
- **Storage is [R2](https://developers.cloudflare.com/r2/)** — no egress fees, generous free tier,
  no database to run or pay for.

See [PLAN.md](../PLAN.md) for the full design.

## Limitations

- **Static & client-side only** — no server-side code. This is what keeps it scale-to-zero. A
  future flag may add per-deploy Workers for dynamic apps.
- **Runtime CDN dependencies** — wrapped pages load React/Vue/Babel/Tailwind and any npm imports
  from CDNs (esm.sh, jsDelivr, the Tailwind Play CDN) at runtime. React/Babel are major-version
  pinned, esm.sh deps pin the React peer, and `vue3-sfc-loader` is minor-pinned; the Tailwind Play
  CDN is intentionally unversioned. A self-hosted esm.sh mirror is a planned option for air-gapped
  installs.

## Hosting alternatives

The artifacts getonup produces are self-contained HTML, so you can host them other ways too — pick
by what your artifacts actually need:

| | **getonup** (Worker + R2) | **GitHub Pages** | **Datasette Apps** |
|---|---|---|---|
| Infra | 1 Worker + 1 bucket | none (a Git repo) | a running [Datasette](https://datasette.io) server |
| Cost at idle | ~$0 (scale-to-zero) | $0 (static) | cost of an always-on server |
| Publish | `getonup deploy` (token) | `git push` | paste into a "Create app" form |
| Dynamic data | no (static / client-side) | no | **yes** — SQL queries, auth, writes |
| Best for | instant URLs, agent-driven, scale-to-zero | a versioned set of static tools | apps that need a real database |

**GitHub Pages** ([simonw/tools](https://github.com/simonw/tools) style): commit your
self-contained HTML files to a repo and enable [GitHub Pages](https://pages.github.com) — each file
becomes `youruser.github.io/repo/tool.html` (a `CNAME` adds a custom domain), and you can group them
in folders. Preview with `getonup serve` first; the `git push` *is* the deploy. Zero infrastructure,
static only.

**[Datasette Apps](https://simonwillison.net/2026/Jun/18/datasette-apps/):** host HTML+JS apps
inside a [Datasette](https://datasette.io) instance — each runs in a tightly sandboxed `<iframe>`
and talks back via `postMessage` to run **SQL queries** with the **logged-in user's permissions**.
That's the thing static hosting can't do: relational data, auth, server-backed state. The
trade-off: it needs a persistent server (no scale-to-zero), and apps are authored in Datasette's UI
rather than via `getonup`. Prototype the UI with `getonup serve`, then move it into a Datasette App once it
needs a database.

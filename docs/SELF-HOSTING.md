# Self-hosting getonup

getonup's backend is **one Cloudflare Worker + one R2 bucket** — it scales to zero, so it costs
~$0 when idle. This guide covers deploying it to a public URL, configuring it, and securing it.

> Just want to try getonup on your machine? You don't need any of this — see
> [Run it locally](../README.md#run-it-locally-no-cloudflare-account) in the README. `npm run dev`
> uses local miniflare storage with no Cloudflare account.

## Deploy to Cloudflare (≈ 5 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
[Node](https://nodejs.org) ≥ 22.18.

```bash
git clone https://github.com/vitorbaptista/getonup.git   # or your own fork
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
  and `nosniff` / `no-referrer` / `X-Frame-Options: SAMEORIGIN` headers on served files (set
  `GETONUP_FRAME_ANCESTORS` to a CSP value, or `""`, if you need artifacts embeddable elsewhere).
- **The deploy token is the trust boundary.** Anyone holding `GETONUP_DEPLOY_TOKEN` can deploy any
  content and choose its served `Content-Type`, so `nosniff` protects viewers from MIME-sniffing,
  not against what the token-holder serves. Treat the token like a deploy key.
- **No built-in rate limiting.** The default Worker does not throttle `/api/*` or failed auth. For
  any publicly reachable instance the Cloudflare WAF rate-limit rule under [Hardening](#hardening)
  is **required, not optional** — the 256-bit token makes online brute-force infeasible, but
  unthrottled requests can still burn quota.
- **Path-based by default** (`/s/<id>`). For stronger isolation between deployments, serve each on
  its own subdomain (see Hardening).

### Hardening

- **Put the deploy API behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)**
  (Zero Trust) for an extra, edge-enforced auth layer with zero app code — see
  [Deploy behind Cloudflare Access](#deploy-behind-cloudflare-access-service-token) below.
- **Per-deploy subdomain isolation:** map a wildcard (`*.getonup.example.com`) and serve
  `<id>.getonup.example.com` so each artifact gets its own origin. (Path-based is the simple
  default; subdomains are the upgrade.)
- **Rate-limit `/api/*`** with a Cloudflare WAF rule — **required for any public instance** — to
  bound abuse and spend (the default Worker does no application-level throttling).

### Deploy behind Cloudflare Access (service token)

[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/)
gates a hostname at the edge: any request without a valid identity is bounced to a login page
*before* it reaches the Worker. That's great for humans but breaks a CLI — so Access issues a
**service token** for non-interactive clients (your CLI, an agent, CI). getonup sends it as the two
`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, which Access validates at the edge.

This stacks on top of the deploy token: Access decides *who can reach the API at all*, the
`GETONUP_DEPLOY_TOKEN` decides *who can publish*.

> **Scope Access to `/api/*`, not the whole host.** Published artifacts (`/s/<id>`) are meant to be
> public with no login. If you protect the bare hostname, every viewer hits the Access login wall.
> Create the Access application for the **path** `getonup.example.com/api` so only the deploy/manage
> API is gated and `/s/*` stays open.

1. In the Zero Trust dashboard, **Access → Applications** → add a **Self-hosted** app for
   `getonup.example.com/api` (and disable the default `workers.dev` route so only the
   Access-protected custom domain is reachable).
2. **Access → Service credentials → Service Tokens → Create.** Copy the **Client ID** and
   **Client Secret** (the secret is shown once).
3. Add a policy on the app with action **Service Auth** that includes that service token. (A plain
   *Allow* policy still forces an interactive login — the action must be **Service Auth**.)
4. Point the CLI at it — env vars (best for CI/agents) or persist them with `login`:

   ```bash
   export GETONUP_ACCESS_CLIENT_ID=<client-id>
   export GETONUP_ACCESS_CLIENT_SECRET=<client-secret>
   getonup deploy index.html        # now sails through Access

   # …or save them alongside the server + token:
   getonup login --url https://getonup.example.com --token <deploy-token> \
     --access-client-id <client-id> --access-client-secret <client-secret>
   ```

   `getonup whoami` shows whether a service token is configured. Rotate by creating a new token in
   the dashboard and updating the env vars / re-running `login`.

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

# Conjure — Progress

**Status: MVP complete and verified end-to-end.** See [PLAN.md](./PLAN.md) for the design,
[README.md](./README.md) to use it, [LANDINGS.md](./LANDINGS.md) for the UI options.

## Done ✅

- **Monorepo** — npm workspaces (`cli`, `server`), MIT, `.gitignore`, `install.sh`, examples.
- **Server** (`server/` — one Cloudflare Worker + R2):
  - `POST /api/deploy` (Bearer token, fail-closed), `GET /api/list`, `DELETE /api/deploy/:id`,
    `GET /api/health`, `GET /s/:id[/*]` (R2 serve + security headers), `GET /` landing.
  - Size/file caps, path-traversal rejection, content-type map, proper status codes, styled 404.
  - Default homepage is the polished **Midnight** landing.
- **CLI** (`cli/` — `conjure`):
  - Command is **`cjr`** (`conjure` / `conjure-live` are aliases; bare `conjure` clashes with ImageMagick).
  - `login`, `deploy <file|dir|->`, **`serve`** (zero-config local hosting + auto-wrap + live-reload,
    no token/Cloudflare), `list`,
    `rm`, `open`, `whoami`, **`mcp`** (run as an MCP server for agents); flags `--json/--quiet/--open/--watch/--port/--out/--name/--type/--no-wrap/--no-tailwind`.
  - **MCP server** (`cjr mcp`, stdio): `deploy_artifact` / `list_deploys` / `remove_deploy` tools.
  - Docs cover **hosting alternatives**: GitHub Pages (simonw/tools style) and Datasette Apps.
  - **Auto-wrap engine**: HTML (full/fragment), React/JSX/TSX (React 18 + Babel + esm.sh import
    maps + Tailwind), Vue SFC (vue3-sfc-loader), plain JS. `</script>` escaping, error overlay.
  - 10 unit tests pass; esbuild bundles to a single `dist/index.js`.
- **Verified in a real browser** — deployed `counter.tsx`; React mounts, renders, interactive.
- **Agent integration** — `AGENTS.md` snippet + `skills/conjure` Claude Code skill.
- **Docs** — README (5-min self-host, CLI, security, hardening), PLAN, LANDINGS, this file.
- **15 landing-page designs** (`landings/`): **10 shadcn.io DESIGN.md systems** (Linear, Vercel,
  Stripe, Supabase, Raycast, GitHub, Cursor, Notion, Figma, Hugging Face — each built from the
  system's real fetched tokens) + **5 originals** (Midnight, Scanini, Shellshare, PostHog,
  Claude). A **gallery** (`gallery/`) links to all 15 and is the homepage. Every page (and the
  gallery, a multi-file deploy) was **deployed through Conjure's own CLI**. Screenshots in
  `docs/landings/`, gallery in `docs/gallery.png`.

## Verified

- `npm test` (CLI), `npm run typecheck` (both) — green.
- `wrangler dev` + `curl` + CLI: HTML deploy, React auto-wrap render, multi-file static folder,
  `list`, `rm`, 401 without token, 404 missing id.

## Roadmap (not blocking; ask anytime)

- "Deploy to Cloudflare" one-click button (needs the repo public on GitHub).
- MCP server exposing a `deploy_artifact` tool (CLI + skill already cover agents).
- Single-binary packaging (`bun build --compile`) + `curl | sh` install.
- Per-deploy subdomain isolation; optional D1 metadata index; browser paste UI.

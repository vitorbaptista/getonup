# getonup — Progress

**Status: MVP complete and verified end-to-end.** See [PLAN.md](./PLAN.md) for the design,
[README.md](./README.md) to use it, [LANDINGS.md](./LANDINGS.md) for the UI options.

## Done ✅

- **Monorepo** — npm workspaces (`cli`, `server`), MIT, `.gitignore`, `install.sh`, examples.
- **Server** (`server/` — one Cloudflare Worker + R2):
  - `POST /api/deploy` (Bearer token, fail-closed), `GET /api/list`, `DELETE /api/deploy/:id`,
    `GET /api/health`, `GET /s/:id[/*]` (R2 serve + security headers), `GET /` landing.
  - Size/file caps, path-traversal rejection, content-type map, proper status codes, styled 404.
  - Default homepage is the **gallery** (links to all 15 landings); regenerate with `npm run demo`,
    or swap to one design via `cp landings/<key>.html server/public/index.html`.
- **CLI** (`cli/` — `getonup`):
  - Command is **`getonup`**.
  - `login`, `deploy <file|dir|->`, **`serve`** (zero-config local hosting + auto-wrap + live-reload,
    no token/Cloudflare), `list`,
    `rm`, `open`, `whoami`, **`mcp`** (run as an MCP server for agents); flags `--json/--quiet/--open/--watch/--port/--out/--name/--type/--no-wrap/--no-tailwind`.
  - **MCP server** (`getonup mcp`, stdio): `deploy_artifact` / `list_deploys` / `remove_deploy` tools.
  - Docs cover **hosting alternatives**: GitHub Pages (simonw/tools style) and Datasette Apps.
  - **Auto-wrap engine**: HTML (full/fragment), React/JSX/TSX (React 18 + Babel + esm.sh import
    maps + Tailwind), Vue SFC (vue3-sfc-loader), plain JS. `</script>` escaping, error overlay.
  - Unit tests for the wrap engine, serve, and mcp pass; esbuild bundles to a single `dist/index.js`.
- **Verified in a real browser** — deployed `counter.tsx`; React mounts, renders, interactive.
- **Agent integration** — `AGENTS.md` snippet + `skills/getonup` Claude Code skill.
- **Docs** — README (5-min self-host, CLI, security, hardening), PLAN, LANDINGS, this file.
- **15 landing-page designs** (`landings/`): **10 shadcn.io DESIGN.md systems** (Linear, Vercel,
  Stripe, Supabase, Raycast, GitHub, Cursor, Notion, Figma, Hugging Face — each built from the
  system's real fetched tokens) + **5 originals** (Midnight, Scanini, Shellshare, PostHog,
  Claude). A **gallery** (`gallery/`) links to all 15 and is the homepage. Every page (and the
  gallery, a multi-file deploy) was **deployed through getonup's own CLI**. Screenshots in
  `docs/landings/`, gallery in `docs/gallery.png`.
- **Reproducible demo** — `npm run demo` (`scripts/publish-demo.mjs`) redeploys all 15 landings +
  the gallery to your server and sets the homepage, so deploy IDs aren't hand-managed.

## Verified

- `npm test` (CLI), `npm run typecheck` (both) — green.
- `wrangler dev` + `curl` + CLI: HTML deploy, React auto-wrap render, multi-file static folder,
  `list`, `rm`, 401 without token, 404 missing id.

## Roadmap (not blocking; ask anytime)

- "Deploy to Cloudflare" one-click button (needs the repo public on GitHub).
- Single-binary packaging (`bun build --compile`) + `curl | sh` install.
- Per-deploy subdomain isolation; optional D1 metadata index; browser paste UI.

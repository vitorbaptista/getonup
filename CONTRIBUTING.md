# Contributing to Conjure

Thanks for helping! Conjure is a small, dependency-light monorepo — easy to hack on.

## Layout

```
cli/      the `cjr` CLI (Node + TypeScript) — auto-wrap engine, deploy/serve/build/mcp
server/   one Cloudflare Worker — token-auth deploy API + R2 static hosting at /s/:id
landings/ + gallery/   the demo landing-page designs (deployed through Conjure itself)
examples/ sample artifacts you can deploy/serve
```

## Develop

```bash
npm install
npm run dev                 # wrangler dev — local server at http://localhost:8787
npm test                    # CLI unit tests (wrap engine, serve, mcp)
npm run typecheck           # both workspaces
npm run build --workspace cli   # bundle the CLI to cli/dist/index.js
```

Run the CLI from source without building: `npm --workspace cli run dev -- <args>`
(e.g. `npm --workspace cli run dev -- serve examples/counter.tsx`).

For a quick local loop, point the CLI at the dev server:

```bash
export CONJURE_URL=http://localhost:8787 CONJURE_TOKEN=dev-local-token-abc123
node cli/dist/index.js deploy examples/counter.tsx --open
```

## Where things live

- **Auto-wrap** (the magic): `cli/src/wrap.ts` — type detection + the HTML templates for
  React/Vue/JS/HTML, esm.sh import maps, `</script>` escaping. Add a new artifact type here
  and a test in `cli/test/wrap.test.ts`.
- **Server**: `server/src/index.ts` — keep it a dumb static host (near-zero CPU so it stays in
  the free-tier budget). Validate inputs, return correct status codes.
- **CLI commands**: `cli/src/index.ts` (dispatch) + `serve.ts` / `mcp.ts`.

## Ground rules

- Add a test for behavior changes (`node:test`, run with `npm test`).
- Keep the server's per-request work minimal — heavy logic belongs in the CLI.
- The deploy API serves untrusted code; preserve the security properties (token-gated writes,
  no session cookie on the serving origin, size/path caps).
- No secrets in commits — `.dev.vars` is gitignored; use `.dev.vars.example`.

By contributing you agree your work is licensed under the repo's [MIT License](./LICENSE).

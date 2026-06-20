# Contributing to getonup

Thanks for helping! getonup is a small, dependency-light monorepo — easy to hack on.

## Layout

```
cli/      the `getonup` CLI (Node + TypeScript) — auto-wrap engine, deploy/serve/build/mcp
server/   one Cloudflare Worker — token-auth deploy API + R2 static hosting at /s/:id
landings/ + gallery/   the demo landing-page designs (deployed through getonup itself)
examples/ sample artifacts you can deploy/serve
```

## Develop

```bash
npm install
npm run setup        # build + link the getonup CLI, write a local deploy token (server/.dev.vars)
npm run dev          # wrangler dev — local server at http://localhost:8787 (no Cloudflare needed)
npm test             # unit tests (cli) + server tests — both workspaces
npm run typecheck    # both workspaces
```

### Pre-commit hooks

We use [prek](https://github.com/j178/prek) (a fast, drop-in `pre-commit` replacement) to run
file hygiene checks plus `typecheck` and `test` before every commit. Install the git hook once:

```bash
prek install              # wires up .git/hooks/pre-commit from .pre-commit-config.yaml
prek run --all-files      # optional: run every hook against the whole repo
```

(Plain `pre-commit install` works too if you have that instead.)

`npm run setup` prints a ready-to-run `getonup login` line with the generated token. Then:

```bash
getonup deploy examples/counter.tsx --open      # or, without building/linking:
npm run getonup -- deploy examples/counter.tsx  # runs the CLI from source via tsx
```

## Where things live

- **Auto-wrap** (the magic): `cli/src/wrap.ts` — type detection + the HTML templates for
  React/Vue/JS/HTML, esm.sh import maps, `</script>` escaping. Add a new artifact type here
  and a test in `cli/test/wrap.test.ts`.
- **Server**: `server/src/index.ts` — keep it a dumb static host (near-zero CPU so it stays in
  the free-tier budget). Validate inputs, return correct status codes.
- **CLI commands**: `cli/src/index.ts` (dispatch) + `serve.ts` / `mcp.ts`.

## Releasing

The CLI publishes to npm automatically on a GitHub Release, via the OIDC trusted-publish workflow
([`.github/workflows/publish.yml`](.github/workflows/publish.yml)). The release tag must match the
`version` in `cli/package.json`. To cut a release:

1. Bump `version` in `cli/package.json` and move the `## [Unreleased]` notes in
   [`CHANGELOG.md`](./CHANGELOG.md) under the new version heading.
2. Commit and merge to `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`, then create a GitHub Release for that tag
   (`gh release create vX.Y.Z --generate-notes`).
4. `publish.yml` builds the CLI and runs `npm publish --workspace cli --provenance`.

## Ground rules

- Add a test for behavior changes (`node:test`, run with `npm test`).
- Keep the server's per-request work minimal — heavy logic belongs in the CLI.
- The deploy API serves untrusted code; preserve the security properties (token-gated writes,
  no session cookie on the serving origin, size/path caps).
- No secrets in commits — `.dev.vars` is gitignored; use `.dev.vars.example`.

By contributing you agree your work is licensed under the repo's [MIT License](./LICENSE).

# Changelog

All notable changes to getonup are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- `getonup deploy` now fails clearly when an API call receives a Cloudflare Access / Zero Trust
  login interstitial instead of JSON, including Access pages that return a 2xx status. The error
  points to `GETONUP_ACCESS_CLIENT_ID` / `GETONUP_ACCESS_CLIENT_SECRET` instead of letting a bogus
  response masquerade as a deploy result.

### Added
- **Multiple server profiles.** `config.json` can now hold several named profiles with a default:
  `{ "default": "main", "profiles": { "main": {…}, "other": {…} } }`. Create them with
  `getonup login --profile <name>` (the first becomes the default; `--default` re-points it), pick
  one per command with `--profile <name>` or the `GETONUP_PROFILE` env var, and list them with the
  new `getonup profiles` command. A typo'd `--profile`/`GETONUP_PROFILE` fails loudly rather than
  silently targeting another server. A pre-existing flat `config.json` keeps working unchanged (read
  as a single `default` profile) and is rewritten into the profile format on the next `login`.
  `GETONUP_URL` / `GETONUP_TOKEN` / `GETONUP_ACCESS_*` still override the resolved profile per field.
- Deploying a folder no longer requires a root `index.html`. The entry is resolved as: a root
  `index.html`, else the sole top-level HTML file, else `--index-file <file>` to choose among
  several (an explicit `--index-file` is authoritative and also overrides an existing
  `index.html`). `--index-file` may name any HTML file inside the folder (a subdirectory path is
  allowed) and must be one the folder actually contains — a path that escapes the folder, an
  absolute path, or a missing file is rejected. A folder with no top-level HTML keeps the previous
  "must contain index.html" behavior. The chosen file's bytes are copied to `index.html` (the
  original file is kept). `getonup serve` and the `deploy_artifact` MCP tool follow the same rule
  (`serve --index-file`, MCP `index_file`).

## [0.5.1] — 2026-06-20

### Fixed
- `getonup version` (and `--version` / `-v`) now report the installed version instead of a stale,
  hard-coded `0.1.0`. The version is read from `package.json` at build time.

### Changed
- `getonup login`'s usage line and `--help` now list the optional `--access-client-id` /
  `--access-client-secret` Cloudflare Access flags, so they're discoverable from the command itself
  (previously they appeared only in the help footer).

## [0.5.0] — 2026-06-20

### Added
- **Live index homepage.** `/` is now an auto-generated, public index of every artifact published
  to the instance — grouped by month, newest first, each linking to its live `/s/<id>` URL. Backed
  by a new public `GET /api/index` endpoint (a trimmed, no-token projection; the token-gated
  `GET /api/list` is unchanged). The CLI auto-derives a one-line description for each deploy from the
  artifact's HTML (`<meta name="description">` → `<title>`) at deploy time and stores it in the
  deploy metadata. See [docs/specs/2026-06-20-live-index-page.md](docs/specs/2026-06-20-live-index-page.md).

### Changed
- The homepage now lists **all** deploys publicly. Previously the host served a hand-curated demo
  gallery and a deploy was discoverable only if you knew its `/s/<id>` URL; the index makes every
  deploy on an instance visible. The original gallery is preserved as a design reference under
  [`docs/mockups/`](docs/mockups). (Crawlers remain blocked instance-wide via the root `robots.txt`.)

## [0.4.0] — 2026-06-20

### Added
- Cloudflare Access support: set `GETONUP_ACCESS_CLIENT_ID` / `GETONUP_ACCESS_CLIENT_SECRET` (or
  pass `--access-client-id` / `--access-client-secret` to `getonup login`) and the CLI sends the
  `CF-Access-Client-Id` / `CF-Access-Client-Secret` service-token headers so it gets past an
  Access-protected instance at the edge. Stacks on top of the deploy token; `whoami` reports it.
  See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md#deploy-behind-cloudflare-access-zero-trust).

## [0.3.0] — 2026-06-20

### Fixed
- Auto-wrap no longer misdetects plain HTML fragments that contain a self-closing tag
  (`<br/>`, `<img/>`) as React, and no longer hands non-runnable files (`.css`, `.json`, `.yml`, …)
  to Babel — those render in an escaped read-only viewer instead of a runtime error page.
- `getonup open <id>` errors when the CLI is not configured instead of printing a scheme-less path.
- Onboarding: the README quickstart clones the real repo URL, an Install section documents
  `npm i -g getonup` / `npx getonup`, and the supported Node floor is a single `>=22.18` across the repo.

### Security
- `/s/<id>/_meta.json` is no longer publicly readable (it had exposed an artifact's title, file
  list, byte size, and timestamp without the deploy token), and a deploy can no longer upload a
  file named `_meta.json`.
- Served artifacts now send `X-Frame-Options: SAMEORIGIN` by default (configurable, including off,
  via `GETONUP_FRAME_ANCESTORS`).

### Added
- `getonup deploy --id <slug>` (alias `--slug`) redeploys to a stable URL `/s/<slug>`, overwriting
  in place and pruning any files the new deploy no longer includes — for the iterate-and-reshare loop.
- A server test suite (local miniflare) covering the auth / caps / path-traversal security
  boundary, plus CLI unit tests for arg parsing, file encoding, config precedence, and API error
  handling. CI runs both workspaces on a Node 22 / 24 matrix.
- CLI package metadata (`repository`, `homepage`, `bugs`, `author`) so the npm page links back to
  the source.

## [0.2.0] — 2026-06-20

### Added
- Markdown files (`.md` / `.markdown`) render to a styled static HTML page (GFM, light/dark),
  with leading YAML frontmatter stripped.

## [0.1.0] — 2026-06-20

Initial release: the `getonup` CLI (`deploy`/`serve`/`list`/`rm`/`open`/`mcp`, auto-wrap for
HTML/React/Vue/JS) and the single Cloudflare Worker + R2 server.

[Unreleased]: https://github.com/vitorbaptista/getonup/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/vitorbaptista/getonup/releases/tag/v0.3.0
[0.2.0]: https://github.com/vitorbaptista/getonup/releases/tag/v0.2.0
[0.1.0]: https://github.com/vitorbaptista/getonup/releases/tag/v0.1.0

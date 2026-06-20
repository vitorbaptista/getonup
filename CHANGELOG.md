# Changelog

All notable changes to getonup are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- A server test suite (local miniflare) covering the auth / caps / path-traversal security
  boundary, plus CLI unit tests for arg parsing, file encoding, config precedence, and API error
  handling. CI runs both workspaces on a Node 20 / 22 matrix.
- CLI package metadata (`repository`, `homepage`, `bugs`, `author`) so the npm page links back to
  the source.

## [0.2.0] — 2026-06-20

### Added
- Markdown files (`.md` / `.markdown`) render to a styled static HTML page (GFM, light/dark),
  with leading YAML frontmatter stripped.

## [0.1.0] — 2026-06-20

Initial release: the `getonup` CLI (`deploy`/`serve`/`list`/`rm`/`open`/`mcp`, auto-wrap for
HTML/React/Vue/JS) and the single Cloudflare Worker + R2 server.

[Unreleased]: https://github.com/vitorbaptista/getonup/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vitorbaptista/getonup/releases/tag/v0.2.0
[0.1.0]: https://github.com/vitorbaptista/getonup/releases/tag/v0.1.0

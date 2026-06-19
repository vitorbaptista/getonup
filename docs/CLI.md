# `cjr` — CLI reference

Conjure's CLI. The command is **`cjr`**; `conjure` and `conjure-live` are aliases (bare `conjure`
clashes with ImageMagick on many systems, so docs use `cjr`). From the repo without installing,
use `npm run cjr -- <args>`.

Configuration is read from `~/.config/conjure/config.json` (written by `cjr login`) or the
`CONJURE_URL` / `CONJURE_TOKEN` environment variables, which take precedence (handy for CI and
agents). `deploy` and `serve` print the live URL as the last line of stdout.

## Commands

### `cjr login --url <server> --token <token>`
Save the server URL + deploy token to `~/.config/conjure/config.json`. Sanity-checks that the
server is reachable and warns if its deploy API is disabled.

### `cjr deploy <file|dir|->`  ·  aliases: `up`, `push`
Publish an artifact to a live URL.

- `<file>` — `.html`, `.jsx`/`.tsx`, `.vue`, `.js`/`.ts`. Single components are auto-wrapped.
- `<dir>` — a built static site (must contain `index.html` at its root).
- `-` — read the artifact from stdin (pair with `--type`).

| Flag | Effect |
|---|---|
| `--name <title>` | a human title for the deploy |
| `--type html\|react\|vue\|js\|static` | override type detection |
| `--no-wrap` | host the source verbatim (skip auto-wrap) |
| `--no-tailwind` | don't inject the Tailwind CDN |
| `--open` | open the URL in your browser |
| `--json` | print `{"id","url","files","bytes"}` |
| `--quiet` | print only the URL |

```bash
cjr deploy report.html
cjr deploy dashboard.tsx --open
cat app.html | cjr deploy - --type html --json
cjr deploy ./dist --name "my site"
```

### `cjr serve <file|dir|->`  ·  alias: `preview`
Wrap + host an artifact on `localhost` — no token, no deploy, nothing leaves your machine.

| Flag | Effect |
|---|---|
| `--port <n>` | port (default `4321`; auto-increments if taken) |
| `--host <h>` | bind address (default `localhost`; use `0.0.0.0` to reach it from your LAN) |
| `--watch` | live-reload on file changes |
| `--open` | open the URL in your browser |
| `--no-wrap` / `--no-tailwind` | host raw source / skip the Tailwind CDN |

```bash
cjr serve counter.tsx --open --watch
cjr serve ./dist --host 0.0.0.0
cat page.html | cjr serve -
```

### `cjr list`  ·  alias: `ls`
List everything published to the configured server.

### `cjr rm <id>`  ·  aliases: `delete`, `remove`
Delete a published artifact by its id (the `<id>` in `/s/<id>`).

### `cjr open <id|url>`
Open a published artifact in your browser.

### `cjr whoami`  ·  alias: `config`
Show the configured server and whether a token is set.

### `cjr mcp`
Run Conjure as an [MCP](https://modelcontextprotocol.io) server over stdio, exposing
`deploy_artifact`, `list_deploys`, and `remove_deploy` tools to MCP-aware agents (Claude Code,
Cursor, …). Configure it with:

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

### `cjr version`  ·  `cjr help`
Print the version / usage. `--version`, `-v`, `--help`, and `-h` work too.

## Auto-wrap quick reference

| Input | Result |
|---|---|
| `.html` (full document) | served verbatim |
| `.html` (fragment) | wrapped in a minimal styled page |
| `.jsx` / `.tsx` | React 18 + Babel + esm.sh import map + Tailwind; mounts the default export |
| `.vue` | Vue 3 via `vue3-sfc-loader` |
| `.js` / `.ts` | a module shell, transpiled in-browser, with an esm.sh import map for bare imports |
| a directory | uploaded as a static site (entry: `index.html`) |

Bare `import`s of npm packages resolve at runtime via [esm.sh](https://esm.sh) — no bundler, no
build step. Use `--type` to override detection and `--no-wrap` to host source as-is.

# `getonup` — CLI reference

getonup's CLI. The command is **`getonup`**. From the repo without installing, use
`npm run getonup -- <args>`.

Configuration is read from `~/.config/getonup/config.json` (written by `getonup login`) or the
`GETONUP_URL` / `GETONUP_TOKEN` environment variables, which take precedence (handy for CI and
agents). `deploy` and `serve` print the live URL as the last line of stdout.

## Commands

### `getonup login --url <server> --token <token>`
Save the server URL + deploy token to `~/.config/getonup/config.json`. Sanity-checks that the
server is reachable and warns if its deploy API is disabled.

### `getonup deploy <file|dir|->`  ·  aliases: `up`, `push`
Publish an artifact to a live URL.

- `<file>` — `.html`, `.jsx`/`.tsx`, `.vue`, `.js`/`.ts`, `.md`/`.markdown`. Single components are auto-wrapped.
- `<dir>` — a built static site (must contain `index.html` at its root).
- `-` — read the artifact from stdin (pair with `--type`).

| Flag | Effect |
|---|---|
| `--name <title>` | a human title for the deploy |
| `--type html\|react\|vue\|js\|markdown\|static` | override type detection |
| `--no-wrap` | host the source verbatim (skip auto-wrap) |
| `--no-tailwind` | don't inject the Tailwind CDN |
| `--open` | open the URL in your browser |
| `--json` | print `{"id","url","files","bytes"}` |
| `--quiet` | print only the URL |

```bash
getonup deploy report.html
getonup deploy dashboard.tsx --open
cat app.html | getonup deploy - --type html --json
getonup deploy ./dist --name "my site"
```

### `getonup serve <file|dir|->`  ·  alias: `preview`
Wrap + host an artifact on `localhost` — no token, no deploy, nothing leaves your machine.

| Flag | Effect |
|---|---|
| `--port <n>` | port (default `4321`; auto-increments if taken) |
| `--host <h>` | bind address (default `localhost`; use `0.0.0.0` to reach it from your LAN) |
| `--watch` | live-reload on file changes |
| `--open` | open the URL in your browser |
| `--no-wrap` / `--no-tailwind` | host raw source / skip the Tailwind CDN |

```bash
getonup serve counter.tsx --open --watch
getonup serve ./dist --host 0.0.0.0
cat page.html | getonup serve -
```

### `getonup list`  ·  alias: `ls`
List everything published to the configured server.

### `getonup rm <id>`  ·  aliases: `delete`, `remove`
Delete a published artifact by its id (the `<id>` in `/s/<id>`).

### `getonup open <id|url>`
Open a published artifact in your browser.

### `getonup whoami`  ·  alias: `config`
Show the configured server and whether a token is set.

### `getonup mcp`
Run getonup as an [MCP](https://modelcontextprotocol.io) server over stdio, exposing
`deploy_artifact`, `list_deploys`, and `remove_deploy` tools to MCP-aware agents (Claude Code,
Cursor, …). Configure it with:

```json
{
  "mcpServers": {
    "getonup": {
      "command": "getonup",
      "args": ["mcp"],
      "env": { "GETONUP_URL": "https://your-getonup.example", "GETONUP_TOKEN": "your-token" }
    }
  }
}
```

### `getonup version`  ·  `getonup help`
Print the version / usage. `--version`, `-v`, `--help`, and `-h` work too.

## Auto-wrap quick reference

| Input | Result |
|---|---|
| `.html` (full document) | served verbatim |
| `.html` (fragment) | wrapped in a minimal styled page |
| `.jsx` / `.tsx` | React 18 + Babel + esm.sh import map + Tailwind; mounts the default export |
| `.vue` | Vue 3 via `vue3-sfc-loader` |
| `.js` / `.ts` | a module shell, transpiled in-browser, with an esm.sh import map for bare imports |
| `.md` / `.markdown` | rendered to a styled static HTML page (GFM, light/dark); leading YAML frontmatter stripped |
| a directory | uploaded as a static site (entry: `index.html`) |

Bare `import`s of npm packages resolve at runtime via [esm.sh](https://esm.sh) — no bundler, no
build step. Use `--type` to override detection and `--no-wrap` to host source as-is.

# `getonup` — CLI reference

getonup's CLI. The command is **`getonup`**. Install it with `npm i -g getonup` (or run it
ad-hoc with `npx getonup <args>`). From a clone without installing, use `npm run getonup -- <args>`.

Configuration is read from `~/.config/getonup/config.json` (written by `getonup login`) or the
`GETONUP_URL` / `GETONUP_TOKEN` environment variables, which take precedence (handy for CI and
agents). `deploy` and `serve` print the live URL as the last line of stdout.

Deploying to **more than one server?** Give each a named [profile](#profiles) and switch between
them with `--profile <name>` (or `GETONUP_PROFILE`).

If your instance sits behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(Zero Trust), also set `GETONUP_ACCESS_CLIENT_ID` / `GETONUP_ACCESS_CLIENT_SECRET` (a service
token); the CLI sends them as `CF-Access-Client-Id` / `CF-Access-Client-Secret` so it gets past
Access at the edge.
See [Deploy behind Cloudflare Access](./SELF-HOSTING.md#deploy-behind-cloudflare-access-zero-trust).

## Commands

### `getonup login --url <server> --token <token>`  ·  `[--profile <name>] [--default]`
Save the server URL + deploy token to `~/.config/getonup/config.json`. Sanity-checks that the
server is reachable and warns if its deploy API is disabled. For instances behind Cloudflare Access,
add `--access-client-id <id> --access-client-secret <secret>` to store a service token too.
`login` writes exactly what you pass — it's declarative, so re-run it with every flag you want kept
(re-running with just `--url`/`--token` clears a previously stored Access token, the same way it
would clear `--token`). To rotate one value without touching the rest, edit `config.json` or use the
`GETONUP_*` env vars instead.

`--profile <name>` writes to a named profile instead of the implicit `default` one (see
[Profiles](#profiles)). The first profile you log into becomes the default automatically; pass
`--default` to re-point the default at the profile you're logging into.

### `getonup deploy <file|dir|->`  ·  aliases: `up`, `push`
Publish an artifact to a live URL.

- `<file>` — `.html`, `.jsx`/`.tsx`, `.vue`, `.js`/`.ts`, `.md`/`.markdown`. Single components are auto-wrapped.
- `<dir>` — a built static site (must contain `index.html` at its root).
- `-` — read the artifact from stdin (pair with `--type`).

| Flag | Effect |
|---|---|
| `--name <title>` | a human title for the deploy |
| `--id <slug>` (alias `--slug`) | redeploy to a **stable URL** `/s/<slug>`, overwriting whatever is there. 2–64 chars, `a–z 0–9 -`, starts alphanumeric. Without it, each deploy mints a fresh id. |
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
Show the active profile, its server, and whether a token is set. Add `--profile <name>` to inspect
a specific one.

### `getonup profiles`
List every configured profile, one per line, with a `*` next to the default.

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

## Profiles

To deploy to **multiple servers**, store each as a named profile. `config.json` then looks like:

```json
{
  "default": "main",
  "profiles": {
    "main":  { "url": "https://main.example",  "token": "…" },
    "client": { "url": "https://client.example", "token": "…" }
  }
}
```

```bash
getonup login --url https://main.example   --token … --profile main     # first → becomes default
getonup login --url https://client.example --token … --profile client
getonup deploy report.html                       # → main (the default)
getonup deploy report.html --profile client      # → client, just this once
getonup login --url https://client.example --token … --profile client --default   # make client the default
getonup profiles                                 # see them all, * marks the default
```

Pick a profile per command with `--profile <name>` (on `deploy`, `list`, `rm`, `open`, `whoami`) or
the `GETONUP_PROFILE` env var; `--profile` wins over the env var, which wins over the stored default.
The `GETONUP_URL` / `GETONUP_TOKEN` / `GETONUP_ACCESS_*` env vars still override the resolved profile
field-by-field, so CI can keep injecting a token while the rest comes from a profile. A pre-profiles
flat `config.json` keeps working untouched — it's read as a single profile named `default`, and is
rewritten into the format above the next time you `login`. To delete a profile, edit `config.json`.

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

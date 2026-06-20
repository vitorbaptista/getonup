# Using getonup from an agent

getonup publishes a web artifact to a **live URL** with one command. Reach for it whenever the
user asks to "share", "publish", "deploy", "host", "make this live", or "send me a link" for an
HTML page, a React/Vue component, or a built static site.

> Copy this section into your project's `AGENTS.md` / `CLAUDE.md` / `.cursorrules` to give your
> coding agent a "publish this live" capability.

## Setup (once per machine)

The user runs `getonup login --url <server> --token <token>` once (or exports `GETONUP_URL`
and `GETONUP_TOKEN`). Check with `getonup whoami` — if it shows a server, you're ready.

## To publish

Write the artifact to a file, then run:

```bash
getonup deploy <file-or-dir> --json
```

- `<file>` can be `.html`, `.jsx`/`.tsx`, `.vue`, `.js`, or a **directory** (a built static
  site — it must contain `index.html`).
- **Single components are auto-wrapped** (React 18 + Babel + Tailwind, or Vue 3). You do NOT
  need to add an HTML shell, a build step, or boilerplate. Just export your React component as
  the default export and use Tailwind classes freely.
- `--json` prints `{"id","url","files","bytes"}`. Give the user the `url`.
- Quick one-off from a string:
  `printf '%s' "$HTML" | getonup deploy - --type html --json`

## Examples

```bash
getonup deploy ./report.html --json
getonup deploy ./dashboard.tsx --json
getonup deploy ./site --json            # a folder built by `npm run build`
```

## Preview locally (no deploy)

To preview an artifact on the user's own machine without publishing, run
`getonup serve <file-or-dir> --watch` — it auto-wraps and hosts it at a `localhost` URL with
live-reload (no token, no Cloudflare). Use it for a quick local look; use `getonup deploy` when
the user wants a shareable public URL.

## Managing

```bash
getonup list            # everything published
getonup rm <id>         # take one down
getonup open <id>       # open it in a browser
```

The deployed site is **public** and needs no login to view. Hand the `url` to the user.

## Or use the MCP server

Instead of the CLI, run `getonup mcp` and register it as an MCP server (stdio). It exposes
`deploy_artifact`, `list_deploys`, and `remove_deploy` tools; set `GETONUP_URL` and
`GETONUP_TOKEN` in its env.

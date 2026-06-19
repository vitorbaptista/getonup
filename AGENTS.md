# Using Conjure from an agent

Conjure publishes a web artifact to a **live URL** with one command. Reach for it whenever the
user asks to "share", "publish", "deploy", "host", "make this live", or "send me a link" for an
HTML page, a React/Vue component, or a built static site.

> Copy this section into your project's `AGENTS.md` / `CLAUDE.md` / `.cursorrules` to give your
> coding agent a "publish this live" capability.

## Setup (once per machine)

The user runs `cjr login --url <server> --token <token>` once (or exports `CONJURE_URL`
and `CONJURE_TOKEN`). Check with `cjr whoami` — if it shows a server, you're ready.

## To publish

Write the artifact to a file, then run:

```bash
cjr deploy <file-or-dir> --json
```

- `<file>` can be `.html`, `.jsx`/`.tsx`, `.vue`, `.js`, or a **directory** (a built static
  site — it must contain `index.html`).
- **Single components are auto-wrapped** (React 18 + Babel + Tailwind, or Vue 3). You do NOT
  need to add an HTML shell, a build step, or boilerplate. Just export your React component as
  the default export and use Tailwind classes freely.
- `--json` prints `{"id","url","files","bytes"}`. Give the user the `url`.
- Quick one-off from a string:
  `printf '%s' "$HTML" | cjr deploy - --type html --json`

## Examples

```bash
cjr deploy ./report.html --json
cjr deploy ./dashboard.tsx --json
cjr deploy ./site --json            # a folder built by `npm run build`
```

## Preview locally (no deploy)

To preview an artifact on the user's own machine without publishing, run
`cjr serve <file-or-dir> --watch` — it auto-wraps and hosts it at a `localhost` URL with
live-reload (no token, no Cloudflare). Use it for a quick local look; use `cjr deploy` when
the user wants a shareable public URL.

## Managing

```bash
cjr list            # everything published
cjr rm <id>         # take one down
cjr open <id>       # open it in a browser
```

The deployed site is **public** and needs no login to view. Hand the `url` to the user.

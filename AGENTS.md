# Agent instructions

> This file is the single source of truth for agent guidance in this repo.
> `CLAUDE.md` is a symlink to it, so every harness (Claude Code, Codex, Cursor, …)
> reads the same content.

## Working guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Using getonup from an agent

getonup publishes a web artifact to a **live URL** with one command. Reach for it whenever the
user asks to "share", "publish", "deploy", "host", "make this live", or "send me a link" for an
HTML page, a React/Vue component, or a built static site.

> Copy this section into your project's `AGENTS.md` / `CLAUDE.md` / `.cursorrules` to give your
> coding agent a "publish this live" capability.

### Setup (once per machine)

The user runs `getonup login --url <server> --token <token>` once (or exports `GETONUP_URL`
and `GETONUP_TOKEN`). Check with `getonup whoami` — if it shows a server, you're ready.

### To publish

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

### Examples

```bash
getonup deploy ./report.html --json
getonup deploy ./dashboard.tsx --json
getonup deploy ./site --json            # a folder built by `npm run build`
```

### Preview locally (no deploy)

To preview an artifact on the user's own machine without publishing, run
`getonup serve <file-or-dir> --watch` — it auto-wraps and hosts it at a `localhost` URL with
live-reload (no token, no Cloudflare). Use it for a quick local look; use `getonup deploy` when
the user wants a shareable public URL.

### Managing

```bash
getonup list            # everything published
getonup rm <id>         # take one down
getonup open <id>       # open it in a browser
```

The deployed site is **public** and needs no login to view. Hand the `url` to the user.

### Or use the MCP server

Instead of the CLI, run `getonup mcp` and register it as an MCP server (stdio). It exposes
`deploy_artifact`, `list_deploys`, and `remove_deploy` tools; set `GETONUP_URL` and
`GETONUP_TOKEN` in its env.

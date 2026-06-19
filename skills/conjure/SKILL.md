---
name: conjure-deploy
description: Publish a web artifact (HTML page, React/Vue component, or built static folder) to a live, shareable URL using the self-hosted Conjure CLI. Use when the user asks to share, publish, deploy, or host a page/component, or says "make this live" / "give me a link".
---

# Deploy an artifact with Conjure

Conjure turns a web artifact into a live URL with one command (`conjure deploy`). The server is
the user's own self-hosted Cloudflare Worker.

## Steps

1. **Check config.** Run `conjure whoami`. If it shows no server, ask the user to run
   `conjure login --url <server> --token <token>` (or set `CONJURE_URL` / `CONJURE_TOKEN`),
   then continue.
2. **Have a file.** Write the artifact to disk if needed — `page.html`, `app.tsx`, `card.vue`,
   `script.js`, or a built `./dist` directory (a folder must contain `index.html`).
3. **Deploy:**
   ```bash
   conjure deploy <file-or-dir> --json
   ```
   - React/Vue/JS single files are **auto-wrapped** (React 18 + Babel + Tailwind, or Vue 3) —
     no HTML shell or build step needed. Export the React component as the **default** export
     and use Tailwind classes freely.
   - Use `--type html|react|vue|js|static` to override detection, `--no-wrap` to host raw.
4. **Share.** Read the `url` field from the JSON and give it to the user. It's public; no login
   to view.

## Manage

```bash
conjure list            # everything published
conjure open <id>       # open in a browser
conjure rm <id>         # remove one
```

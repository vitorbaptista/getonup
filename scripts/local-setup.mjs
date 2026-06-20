#!/usr/bin/env node
/**
 * Local-run bootstrap. Ensures a deploy token exists for `wrangler dev` (server/.dev.vars,
 * gitignored) and prints the exact next steps. Running it needs NO Cloudflare account —
 * `wrangler dev` serves everything from local miniflare storage.
 *
 *   npm run setup            # build the CLI, create a local token, print how to run
 *   (predev runs this with --quiet so `npm run dev` always has a token)
 */
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_VARS = join(ROOT, "server/.dev.vars");
const quiet = process.argv.includes("--quiet");

let token;
try {
  token = (((await readFile(DEV_VARS, "utf8")).match(/^GETONUP_DEPLOY_TOKEN=(.+)$/m) || [])[1] || "").trim();
} catch {
  /* no .dev.vars yet */
}

let created = false;
if (!token) {
  token = randomBytes(24).toString("hex");
  await writeFile(
    DEV_VARS,
    `# Local deploy token for \`wrangler dev\` (gitignored). Regenerate by deleting this file.\nGETONUP_DEPLOY_TOKEN=${token}\n`,
    "utf8",
  );
  created = true;
}

if (quiet) {
  if (created) process.stdout.write("✓ created server/.dev.vars with a local deploy token\n");
  process.exit(0);
}

process.stdout.write(`
✓ Local setup ready — no Cloudflare account needed.

  1. Start the server (local miniflare; serves at http://localhost:8787):
       npm run dev

  2. In another terminal, point the CLI at it and publish an artifact:
       getonup login --url http://localhost:8787 --token ${token}
       getonup deploy ./path/to/artifact.html        # → prints a live /s/<id> URL
       getonup serve  ./path/to/artifact.html         # …or preview with no server at all

  3. (Optional) publish the demo landings to your local server (they appear on the live index at /):
       GETONUP_URL=http://localhost:8787 GETONUP_TOKEN=${token} npm run demo

  The token lives in server/.dev.vars (gitignored). If \`getonup\` isn't on your PATH, this setup
  tried to link it; otherwise run \`npm link --workspace cli\`, or use \`npm run getonup -- <args>\`.
`);

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, saveConfig, resolveAccess, type Config } from "./config.js";
import * as api from "./api.js";
import { parseArgs, type Args } from "./args.js";
import { walkDir } from "./files.js";
import { detectType, wrapToHtml, type ArtifactType } from "./wrap.js";
import { describeHtml } from "./describe.js";
import { serve } from "./serve.js";
import { runMcp } from "./mcp.js";

const VERSION = "0.1.0";

// ---- tiny output helpers ---------------------------------------------------
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};
function err(msg: string): never {
  process.stderr.write(c.red("error: ") + msg + "\n");
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore */
  }
}

// ---- commands --------------------------------------------------------------

async function cmdLogin(args: Args): Promise<void> {
  const url = (args.flags.url as string) || args._[0];
  const token = (args.flags.token as string) || args._[1];
  if (!url) err("usage: getonup login --url <server-url> --token <deploy-token>");
  // Optional Cloudflare Access service-token (for instances behind Access), from flags or env.
  const accessClientId =
    (args.flags["access-client-id"] as string) || process.env.GETONUP_ACCESS_CLIENT_ID || undefined;
  const accessClientSecret =
    (args.flags["access-client-secret"] as string) || process.env.GETONUP_ACCESS_CLIENT_SECRET || undefined;
  const cfg: Config = {
    url: String(url).replace(/\/+$/, ""),
    token: token ? String(token) : undefined,
    accessClientId,
    accessClientSecret,
  };
  const access = resolveAccess(cfg); // throws on a half-configured pair, before we hit the network
  // Sanity-check the server (with the Access token, in case the API is behind Access).
  try {
    const h = await api.health(cfg.url!, access);
    if (!h?.ok) throw new Error("unexpected response");
    if (!h.deployEnabled) {
      process.stderr.write(
        c.dim("note: server reports GETONUP_DEPLOY_TOKEN is not set — deploys will be rejected until it is.\n"),
      );
    }
  } catch (e) {
    err(`could not reach a getonup server at ${cfg.url}: ${(e as Error).message}`);
  }
  const p = await saveConfig(cfg);
  process.stdout.write(c.green("✓") + ` logged in to ${c.cyan(cfg.url!)}\n` + c.dim(`  saved to ${p}\n`));
}

async function cmdDeploy(args: Args): Promise<void> {
  const cfg = await loadConfig();
  const { url, token } = cfg;
  if (!url) err("not configured. Run: getonup login --url <server> --token <token>  (or set GETONUP_URL/GETONUP_TOKEN)");
  const access = resolveAccess(cfg);

  const target = args._[0];
  if (!target) err("usage: getonup deploy <file|dir|->  [--name <title>] [--id <slug>] [--type html|react|vue|js|markdown|static] [--no-wrap] [--open] [--json]");

  const json = !!args.flags.json;
  const quiet = !!args.flags.quiet;
  const noWrap = args.flags["no-wrap"] === true || args.flags.wrap === false;
  const tailwind = args.flags["no-tailwind"] === true ? false : true;
  let title = (args.flags.name as string) || undefined;
  // --id (alias --slug) redeploys to a stable URL, overwriting whatever is there. Validate the
  // same way the server does, so a bad slug fails fast instead of after a round-trip.
  const id = (args.flags.id as string) || (args.flags.slug as string) || undefined;
  if (id !== undefined && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    err("--id must be 2–64 chars of a–z, 0–9, hyphen, starting with a letter or digit");
  }

  let files: api.DeployFile[] = [];
  let type: ArtifactType = "static";

  if (target === "-") {
    const content = await readStdin();
    if (!content.trim()) err("nothing on stdin");
    type = (args.flags.type as ArtifactType) || detectType((args.flags.name as string) || "stdin", content);
    const html = noWrap ? content : wrapToHtml(content, type, { title, tailwind });
    files = [{ path: "index.html", content: html, encoding: "utf8" }];
  } else {
    let s;
    try {
      s = await stat(target);
    } catch {
      err(`no such file or directory: ${target}`);
    }
    if (s!.isDirectory()) {
      type = "static";
      await walkDir(target, target, files);
      if (files.length === 0) err(`directory is empty: ${target}`);
      if (!files.some((f) => f.path === "index.html")) {
        err(`a static folder must contain an index.html at its root (${target})`);
      }
      if (!title) title = basename(target);
    } else {
      const content = await readFile(target, "utf8");
      type = (args.flags.type as ArtifactType) || detectType(target, content);
      if (!title) title = basename(target).replace(/\.[^.]+$/, "");
      const html = noWrap ? content : wrapToHtml(content, type, { title, tailwind });
      files = [{ path: "index.html", content: html, encoding: "utf8" }];
    }
  }

  // Auto-derive a one-line description from the entry HTML (best-effort; undefined when none found).
  const entry = files.find((f) => f.path === "index.html");
  const description = entry && entry.encoding === "utf8" ? describeHtml(entry.content, title) : undefined;

  if (!quiet && !json) {
    const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
    process.stderr.write(
      c.dim(`deploying ${files.length} file(s), ${type}, ~${(bytes / 1024).toFixed(1)} KB → ${url}\n`),
    );
  }

  let result: api.DeployResult;
  try {
    result = await api.deploy(url, token, { id, title: title || null, description, type, files }, access);
  } catch (e) {
    const ae = e as api.ApiError;
    if (ae.status === 401) {
      const msg = (ae.data as { error?: string } | undefined)?.error;
      // Distinguish "the server has no token configured" from "wrong CLI token".
      err(msg && /disabled/i.test(msg)
        ? `${msg} — for local dev run \`npm run setup\` (writes server/.dev.vars); in production use \`wrangler secret put GETONUP_DEPLOY_TOKEN\`.`
        : `unauthorized — check your deploy token (run \`getonup login\`).`);
    }
    err((e as Error).message);
  }

  if (json) {
    process.stdout.write(JSON.stringify(result!) + "\n");
  } else if (quiet) {
    process.stdout.write(result!.url + "\n");
  } else {
    process.stdout.write(c.green("✓ live → ") + c.cyan(result!.url) + "\n");
  }
  if (args.flags.open) openInBrowser(result!.url);
}

async function cmdServe(args: Args): Promise<void> {
  const opts = {
    port: args.flags.port ? Number(args.flags.port) : undefined,
    host: (args.flags.host as string) || undefined,
    open: !!args.flags.open,
    noWrap: args.flags["no-wrap"] === true || args.flags.wrap === false,
    type: args.flags.type as ArtifactType | undefined,
    tailwind: args.flags["no-tailwind"] === true ? false : true,
    watch: args.flags.watch === true || args.flags.w === true,
    quiet: !!args.flags.quiet,
  };
  const target = args._[0];
  if (target === "-") return serve(null, opts, await readStdin());
  if (!target) err("usage: getonup serve <file|dir|-> [--port N] [--open] [--watch] [--type html|react|vue|js|markdown|static] [--no-wrap]");
  try {
    await stat(target);
  } catch {
    err(`no such file or directory: ${target}`);
  }
  return serve(target, opts);
}

async function cmdList(): Promise<void> {
  const cfg = await loadConfig();
  const { url, token } = cfg;
  if (!url) err("not configured. Run: getonup login …");
  const { deploys } = await api.list(url, token, resolveAccess(cfg));
  if (!deploys.length) {
    process.stdout.write(c.dim("no deploys yet.\n"));
    return;
  }
  for (const d of deploys) {
    const when = (d.created_at || "").replace("T", " ").replace(/\..*/, "");
    process.stdout.write(
      `${c.cyan(d.id.padEnd(10))} ${c.dim((d.type || "static").padEnd(7))} ${c.dim(when)}  ${d.title || ""}\n` +
        `  ${url.replace(/\/+$/, "")}/s/${d.id}\n`,
    );
  }
}

async function cmdRm(args: Args): Promise<void> {
  const cfg = await loadConfig();
  const { url, token } = cfg;
  if (!url) err("not configured. Run: getonup login …");
  const id = args._[0];
  if (!id) err("usage: getonup rm <id>");
  try {
    const r = await api.remove(url, token, id, resolveAccess(cfg));
    process.stdout.write(c.green("✓") + ` removed ${id} (${r.files} file(s))\n`);
  } catch (e) {
    err((e as Error).message);
  }
}

async function cmdOpen(args: Args): Promise<void> {
  const { url } = await loadConfig();
  const idOrUrl = args._[0];
  if (!idOrUrl) err("usage: getonup open <id|url>");
  const isUrl = /^https?:\/\//.test(idOrUrl);
  if (!isUrl && !url) err("not configured. Run: getonup login --url <server> --token <token>  (or pass a full URL)");
  const full = isUrl ? idOrUrl : `${url!.replace(/\/+$/, "")}/s/${idOrUrl}`;
  openInBrowser(full);
  process.stdout.write(full + "\n");
}

async function cmdWhoami(): Promise<void> {
  const { url, token, accessClientId, accessClientSecret } = await loadConfig();
  process.stdout.write(`server: ${url || c.dim("(not set)")}\n`);
  process.stdout.write(`token:  ${token ? c.dim("configured") : c.dim("(not set)")}\n`);
  if (accessClientId || accessClientSecret) {
    process.stdout.write(`access: ${accessClientId && accessClientSecret ? c.dim("service token configured") : c.red("incomplete (set both id and secret)")}\n`);
  }
}

function help(): void {
  process.stdout.write(`${c.bold("getonup")} — your AI artifact, live in seconds.

${c.bold("Usage")}
  getonup login --url <server> --token <token>
  getonup deploy <file|dir|->   [--name <title>] [--id <slug>] [--type html|react|vue|js|markdown|static]
                                [--no-wrap] [--no-tailwind] [--open] [--json] [--quiet]
  getonup serve <file|dir|->    [--port N] [--host H] [--open] [--watch] [--no-wrap]   ${c.dim("# local preview, no deploy")}
  getonup list
  getonup open <id|url>
  getonup rm <id>
  getonup whoami
  getonup mcp                       ${c.dim("# run as an MCP server (stdio) for agents")}

${c.bold("Examples")}
  getonup deploy index.html
  getonup deploy counter.tsx --open
  getonup deploy app.tsx --id my-app   ${c.dim("# redeploy to the same /s/my-app URL")}
  cat art.html | getonup deploy - --name demo
  getonup deploy ./dist            ${c.dim("# a built static site (needs index.html)")}
  getonup serve counter.tsx --open --watch   ${c.dim("# instant local preview, live reload, no deploy")}

Config lives in ~/.config/getonup/config.json, or env GETONUP_URL / GETONUP_TOKEN.
Behind Cloudflare Access? Add a service token: GETONUP_ACCESS_CLIENT_ID / GETONUP_ACCESS_CLIENT_SECRET
(or pass --access-client-id / --access-client-secret to login).
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (cmd) {
    case "login": return cmdLogin(args);
    case "deploy": case "up": case "push": return cmdDeploy(args);
    case "serve": case "preview": return cmdServe(args);
    case "mcp": return runMcp();
    case "list": case "ls": return cmdList();
    case "rm": case "delete": case "remove": return cmdRm(args);
    case "open": return cmdOpen(args);
    case "whoami": case "config": return cmdWhoami();
    case "version": case "--version": case "-v": process.stdout.write(`getonup ${VERSION}\n`); return;
    case undefined: case "help": case "--help": case "-h": help(); return;
    default:
      process.stderr.write(c.red(`unknown command: ${cmd}\n\n`));
      help();
      process.exit(1);
  }
}

main().catch((e) => err(e?.message || String(e)));

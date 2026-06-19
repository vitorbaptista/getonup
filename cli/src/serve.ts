/**
 * `conjure serve` — zero-config LOCAL hosting.
 *
 * Combines the server + the auto-wrap uploader into one command: point it at an artifact
 * (file, dir, or stdin), and it wraps it (React/Vue/JS/HTML) and serves it at a localhost URL.
 * No Cloudflare, no token, no deploy — instant local preview, with optional live-reload.
 */
import { createServer, type ServerResponse, type Server } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { join, relative, sep, extname, basename } from "node:path";
import { spawn } from "node:child_process";
import { detectType, wrapToHtml, type ArtifactType } from "./wrap.js";

const TYPE_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", map: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", txt: "text/plain; charset=utf-8",
  wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
  mp4: "video/mp4", mp3: "audio/mpeg", pdf: "application/pdf",
};
function ctypeFor(p: string): string {
  return TYPE_BY_EXT[extname(p).slice(1).toLowerCase()] || "application/octet-stream";
}

export interface ServeOptions {
  port?: number;
  host?: string;
  open?: boolean;
  noWrap?: boolean;
  type?: ArtifactType;
  tailwind?: boolean;
  watch?: boolean;
  quiet?: boolean;
}

type FileMap = Map<string, { body: Buffer; type: string }>;

async function walk(dir: string, base: string, out: FileMap): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === ".DS_Store") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, base, out);
    else if (e.isFile()) {
      const rel = relative(base, full).split(sep).join("/");
      out.set(rel, { body: await readFile(full), type: ctypeFor(rel) });
    }
  }
}

async function build(target: string | null, opts: ServeOptions, stdin?: string): Promise<FileMap> {
  const map: FileMap = new Map();
  if (stdin != null) {
    const type = opts.type || detectType("stdin", stdin);
    const html = opts.noWrap ? stdin : wrapToHtml(stdin, type, { tailwind: opts.tailwind });
    map.set("index.html", { body: Buffer.from(html), type: "text/html; charset=utf-8" });
    return map;
  }
  const s = await stat(target!);
  if (s.isDirectory()) {
    await walk(target!, target!, map);
    if (!map.has("index.html")) throw new Error(`directory has no index.html at its root: ${target}`);
  } else {
    const content = await readFile(target!, "utf8");
    const type = opts.type || detectType(target!, content);
    const title = basename(target!).replace(/\.[^.]+$/, "");
    const html = opts.noWrap ? content : wrapToHtml(content, type, { title, tailwind: opts.tailwind });
    map.set("index.html", { body: Buffer.from(html), type: "text/html; charset=utf-8" });
  }
  return map;
}

const LIVE_RELOAD =
  `<script>(function(){try{var s=new EventSource("/__conjure_live");s.onmessage=function(){location.reload()};}catch(e){}})();</script>`;

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore */
  }
}

function tryListen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onErr = (e: NodeJS.ErrnoException) => {
      server.removeListener("error", onErr);
      if (e.code === "EADDRINUSE") resolve(-1);
      else reject(e);
    };
    server.once("error", onErr);
    server.listen(port, host, () => {
      server.removeListener("error", onErr);
      resolve(port);
    });
  });
}

/** Build the server, listen, and return its info — used by the CLI and by tests. */
export async function startServer(
  target: string | null,
  opts: ServeOptions,
  stdin?: string,
): Promise<{ server: Server; port: number; url: string; close: () => void }> {
  let files = await build(target, opts, stdin);
  const clients = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    let url: string;
    try {
      url = decodeURIComponent((req.url || "/").split("?")[0]);
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad request");
      return;
    }
    if (url === "/__conjure_live") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("retry: 500\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    let key = url === "/" ? "index.html" : url.replace(/^\/+/, "");
    if (key.endsWith("/")) key += "index.html";
    let entry = files.get(key);
    if (!entry && !extname(key)) entry = files.get("index.html"); // SPA-ish fallback
    if (!entry) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>404</title><h1>404</h1><p>Not found.</p>");
      return;
    }
    let body = entry.body;
    if (opts.watch && entry.type.startsWith("text/html")) {
      const html = entry.body.toString("utf8");
      body = Buffer.from(/<\/body>/i.test(html) ? html.replace(/<\/body>/i, LIVE_RELOAD + "</body>") : html + LIVE_RELOAD);
    }
    res.writeHead(200, { "content-type": entry.type, "cache-control": "no-store" });
    res.end(body);
  });

  const host = opts.host || "localhost";
  const start = opts.port || 4321;
  let port = -1;
  for (let p = start; p < start + 25; p++) {
    port = await tryListen(server, p, host);
    if (port > 0) break;
  }
  if (port < 0) throw new Error(`no free port in ${start}..${start + 24}`);

  // Live reload: rebuild + notify on file changes.
  if (opts.watch && target) {
    let timer: NodeJS.Timeout | null = null;
    const rebuild = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          files = await build(target, opts, stdin);
        } catch (e) {
          process.stderr.write(`  rebuild error: ${(e as Error).message}\n`);
        }
        for (const c of clients) {
          try {
            c.write("data: reload\n\n");
          } catch {
            /* client gone */
          }
        }
      }, 120);
    };
    try {
      const st = await stat(target);
      watch(target, st.isDirectory() ? { recursive: true } : {}, rebuild);
    } catch {
      /* watch unsupported here; serve without live reload */
    }
  }

  return { server, port, url: `http://localhost:${port}`, close: () => server.close() };
}

export async function serve(target: string | null, opts: ServeOptions, stdin?: string): Promise<void> {
  const { url } = await startServer(target, opts, stdin);
  if (opts.quiet) {
    process.stdout.write(url + "\n");
  } else {
    process.stdout.write(
      `\n  \x1b[1mconjure serve\x1b[0m — local preview, no deploy needed\n` +
        `  \x1b[36m${url}\x1b[0m\n` +
        (opts.watch ? `  \x1b[2mwatching for changes — live reload on\x1b[0m\n` : "") +
        `  \x1b[2mpress Ctrl+C to stop\x1b[0m\n\n`,
    );
  }
  if (opts.open) openBrowser(url);
  // Keep the process alive until interrupted.
  await new Promise<void>(() => {});
}

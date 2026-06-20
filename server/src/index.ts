/**
 * getonup server — a single Cloudflare Worker.
 *
 *   POST   /api/deploy        (Bearer token)  -> store an artifact in R2, return { id, url }
 *   GET    /api/list          (Bearer token)  -> list deploys
 *   DELETE /api/deploy/:id    (Bearer token)  -> delete a deploy
 *   GET    /api/health                        -> liveness + capabilities
 *   GET    /s/:id[/*]                          -> serve a deployed artifact from R2 (public)
 *   GET    /  (and anything else)              -> static landing page (served from ./public)
 *
 * The Worker does ~no CPU work (pure I/O), so it stays comfortably within the free-tier
 * 10ms/invocation budget and scales to zero. All the "magic" (detecting + wrapping artifacts)
 * lives in the CLI; the server just stores bytes and serves them.
 */

export interface Env {
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** Required to deploy. If unset, the deploy API is disabled (fail-closed). */
  GETONUP_DEPLOY_TOKEN?: string;
  /** Optional: force the base URL printed in deploy responses (e.g. a custom domain). */
  GETONUP_PUBLIC_URL?: string;
  MAX_BYTES?: string;
  MAX_FILES?: string;
  /** Framing policy for served artifacts (tri-state): unset -> `X-Frame-Options: SAMEORIGIN`
   *  (default); a value (e.g. `'self'`) -> `Content-Security-Policy: frame-ancestors <value>`;
   *  empty string -> no framing headers (artifacts embeddable anywhere). */
  GETONUP_FRAME_ANCESTORS?: string;
}

const VERSION = "0.1.0";
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB total per deploy
const DEFAULT_MAX_FILES = 300;

// Unambiguous lowercase base32-ish alphabet (no 0/1/l/o).
const ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

const TYPE_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  wasm: "application/wasm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
};

function genId(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time compare via fixed-length digests — no length short-circuit, so neither the
 *  presented token nor the secret leaks its length through timing. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let r = 0;
  for (let i = 0; i < 32; i++) r |= da[i] ^ db[i];
  return r === 0;
}

async function isAuthed(req: Request, env: Env): Promise<boolean> {
  const token = env.GETONUP_DEPLOY_TOKEN;
  if (!token) return false; // fail-closed: no token configured -> no deploys
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return !!m && (await safeEqual(m[1].trim(), token));
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

function ctypeFor(path: string): string {
  return TYPE_BY_EXT[extOf(path)] || "application/octet-stream";
}

/** Normalize a relative path and reject traversal / absolute / weird inputs. */
function safePath(input: string): string | null {
  let p = String(input || "").replace(/\\/g, "/");
  if (p.includes("\0")) return null;
  p = p.replace(/^\/+/, "");
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  const joined = parts.join("/");
  if (joined.length > 1024) return null;
  return joined;
}

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function notFound(message = "Not found"): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 — getonup</title><style>
    html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0b0d10;color:#e7e9ee;font:500 16px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .card{text-align:center;padding:2rem}h1{font-size:4rem;margin:0;background:linear-gradient(110deg,#7c5cff,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}
    p{color:#9aa0ab}a{color:#22d3ee;text-decoration:none}</style></head>
    <body><div class="card"><h1>404</h1><p>${message}.</p><p><a href="/">getonup</a></p></div></body></html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}

interface UploadFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  contentType?: string;
}

/** A positive integer from an env string, else the default (so "0"/""/"abc" don't silently pass). */
function posInt(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// A caller-supplied deploy id (`--id`): 2–64 chars, starts alphanumeric, then [a-z0-9-]. A subset
// of the serve/delete id charset (which permits hyphens), so a custom id is always servable.
function validSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(s);
}

/** All object keys under a prefix (paginated, so it isn't capped at 1000). */
async function listKeys(env: Env, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix, limit: 1000, cursor });
    for (const o of page.objects) keys.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function handleDeploy(req: Request, env: Env): Promise<Response> {
  if (!(await isAuthed(req, env))) {
    return json(
      { error: env.GETONUP_DEPLOY_TOKEN ? "unauthorized" : "deploy disabled: set GETONUP_DEPLOY_TOKEN" },
      401,
    );
  }

  const maxBytes = posInt(env.MAX_BYTES, DEFAULT_MAX_BYTES);
  const maxFiles = posInt(env.MAX_FILES, DEFAULT_MAX_FILES);

  const declared = Number(req.headers.get("content-length") || "0");
  // base64 inflates ~33%; allow headroom but reject obviously-too-large bodies early. Best-effort:
  // chunked requests carry no content-length and skip this — the per-file loop below is the hard cap.
  if (declared && declared > maxBytes * 2) return json({ error: "payload too large" }, 413);

  let body: { id?: string; title?: string; type?: string; files?: UploadFile[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const files = body?.files;
  if (!Array.isArray(files) || files.length === 0) return json({ error: "no files provided" }, 400);
  if (files.length > maxFiles) return json({ error: `too many files (max ${maxFiles})` }, 413);

  const normalized: { path: string; bytes: Uint8Array; contentType: string }[] = [];
  let total = 0;
  let hasIndex = false;

  for (const f of files) {
    const sp = safePath(f?.path ?? "");
    if (!sp) return json({ error: `invalid file path: ${String(f?.path)}` }, 400);
    if (sp === "_meta.json") return json({ error: "reserved path: _meta.json" }, 400);
    if (sp === "index.html") hasIndex = true;

    let bytes: Uint8Array;
    try {
      bytes =
        f.encoding === "base64"
          ? bytesFromBase64(String(f.content ?? ""))
          : new TextEncoder().encode(String(f.content ?? ""));
    } catch {
      return json({ error: `could not decode file: ${sp}` }, 400);
    }

    total += bytes.length;
    if (total > maxBytes) return json({ error: `payload too large (max ${maxBytes} bytes)` }, 413);

    const contentType =
      typeof f.contentType === "string" && f.contentType ? f.contentType : ctypeFor(sp);
    normalized.push({ path: sp, bytes, contentType });
  }

  if (!hasIndex) return json({ error: "deploy must include an index.html entry file" }, 400);

  // An optional caller-supplied id (`--id`) redeploys to a stable URL; otherwise mint a fresh one.
  const overwrite = typeof body.id === "string" && body.id !== "";
  if (overwrite && !validSlug(body.id!)) {
    return json({ error: "invalid id: 2–64 chars of a–z, 0–9, hyphen, starting with a letter or digit" }, 400);
  }
  const id = overwrite ? body.id! : genId();
  const meta = {
    id,
    title: (String(body.title ?? "").trim().slice(0, 200)) || null,
    type: String(body.type ?? "static"),
    files: normalized.map((f) => f.path),
    bytes: total,
    created_at: new Date().toISOString(),
  };

  // For an overwrite, capture the prior file set first so we can prune anything the new deploy no
  // longer includes (a smaller redeploy must not leave orphans from a larger prior one).
  const priorKeys = overwrite ? await listKeys(env, `${id}/`) : [];

  try {
    await Promise.all(
      normalized.map((f) =>
        env.BUCKET.put(`${id}/${f.path}`, f.bytes, { httpMetadata: { contentType: f.contentType } }),
      ),
    );
    await env.BUCKET.put(`${id}/_meta.json`, JSON.stringify(meta), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (e) {
    // Fresh deploy: roll back the partial write. For an overwrite, leave the prior content in
    // place rather than wipe a working URL on a failed redeploy (re-run to recover).
    if (!overwrite) {
      try {
        const orphans = await env.BUCKET.list({ prefix: `${id}/` });
        if (orphans.objects.length) await env.BUCKET.delete(orphans.objects.map((o) => o.key));
      } catch {
        /* ignore cleanup failure */
      }
    }
    throw e;
  }

  // Prune files left over from a previous, larger deploy at this id (bounded by MAX_FILES).
  if (overwrite) {
    const fresh = new Set([`${id}/_meta.json`, ...normalized.map((f) => `${id}/${f.path}`)]);
    const stale = priorKeys.filter((k) => !fresh.has(k));
    if (stale.length) {
      try {
        await env.BUCKET.delete(stale);
      } catch {
        /* best effort */
      }
    }
  }

  const base = (env.GETONUP_PUBLIC_URL || "").replace(/\/+$/, "") || new URL(req.url).origin;
  return json({ id, url: `${base}/s/${id}`, files: meta.files, bytes: total }, 201);
}

async function handleServe(url: URL, env: Env): Promise<Response> {
  const after = url.pathname.slice("/s/".length);
  if (!after) return notFound();

  const slash = after.indexOf("/");
  const id = slash === -1 ? after : after.slice(0, slash);
  let rest = slash === -1 ? "" : after.slice(slash + 1);
  if (!/^[a-z0-9-]+$/.test(id)) return notFound();

  // Browsers percent-encode path chars (e.g. "my%20logo.png"); decode to match the stored R2 key.
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return notFound(); // malformed percent-encoding
  }

  if (rest === "") rest = "index.html";
  else if (rest.endsWith("/")) rest += "index.html";

  const sp = safePath(rest);
  if (!sp || sp === "_meta.json") return notFound(); // _meta.json is server-internal, never public

  let obj = await env.BUCKET.get(`${id}/${sp}`);
  // Soft SPA fallback: an extension-less path that isn't a real file serves the entry.
  if (!obj && !sp.includes(".")) obj = await env.BUCKET.get(`${id}/index.html`);
  if (!obj) return notFound();

  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType || ctypeFor(sp));
  headers.set("cache-control", "public, max-age=60");
  // Defense in depth. Serving origin carries no getonup session cookie, so a malicious
  // artifact has no host session to steal; these just reduce incidental risk.
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  // Framing policy (tri-state on GETONUP_FRAME_ANCESTORS): unset -> SAMEORIGIN; a value -> CSP
  // frame-ancestors; "" -> no header (embeddable). Note: an absent env var is undefined, not "".
  const fa = env.GETONUP_FRAME_ANCESTORS;
  if (fa === undefined) headers.set("x-frame-options", "SAMEORIGIN");
  else if (fa !== "") headers.set("content-security-policy", `frame-ancestors ${fa}`);
  headers.set("x-getonup-id", id);
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);

  return new Response(obj.body, { headers });
}

async function handleList(req: Request, env: Env): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ delimiter: "/", limit: 1000, cursor });
    for (const p of page.delimitedPrefixes || []) ids.push(p.replace(/\/$/, ""));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const deploys: unknown[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const m = await env.BUCKET.get(`${id}/_meta.json`);
      if (m) {
        try {
          deploys.push(await m.json());
        } catch {
          /* ignore malformed meta */
        }
      }
    }),
  );
  deploys.sort((a: any, b: any) => String(b?.created_at || "").localeCompare(String(a?.created_at || "")));
  return json({ deploys });
}

async function handleDelete(req: Request, env: Env, id: string): Promise<Response> {
  if (!(await isAuthed(req, env))) return json({ error: "unauthorized" }, 401);
  if (!/^[a-z0-9-]+$/.test(id)) return json({ error: "invalid id" }, 400);
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: `${id}/`, limit: 1000, cursor });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) {
      await env.BUCKET.delete(keys);
      total += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (total === 0) return json({ error: "not found" }, 404);
  return json({ deleted: id, files: total });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/api/health") {
        return json({ ok: true, service: "getonup", version: VERSION, deployEnabled: !!env.GETONUP_DEPLOY_TOKEN });
      }
      if (p === "/api/deploy" && req.method === "POST") return await handleDeploy(req, env);
      if (p === "/api/list" && req.method === "GET") return await handleList(req, env);

      const del = p.match(/^\/api\/deploy\/([^/]+)\/?$/);
      if (del && req.method === "DELETE") return await handleDelete(req, env, decodeURIComponent(del[1]));

      if (p.startsWith("/s/")) return await handleServe(url, env);

      if (p.startsWith("/api/")) return json({ error: "not found" }, 404);

      // Everything else: the static landing page (served from ./public via the ASSETS binding).
      return env.ASSETS.fetch(req);
    } catch (err) {
      return json({ error: "internal error", detail: String((err as Error)?.message ?? err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";
import * as api from "../../cli/src/api.js";

// Boots the real Worker in local miniflare (no Cloudflare account) and exercises the security
// boundary end-to-end. Inline `vars` are authoritative over wrangler.jsonc and .dev.vars, so the
// suite controls the token and caps regardless of the local dev environment; low caps make the
// 413 paths testable while leaving the tiny happy-path payloads under them.
const TOKEN = "test-token";
let worker: Awaited<ReturnType<typeof unstable_dev>>;
let base: string;

before(async () => {
  worker = await unstable_dev("src/index.ts", {
    experimental: { disableExperimentalWarning: true },
    vars: { GETONUP_DEPLOY_TOKEN: TOKEN, MAX_FILES: "3", MAX_BYTES: "80" },
  });
  base = `http://127.0.0.1:${worker.port}`;
});

after(async () => {
  await worker?.stop();
});

const file = (path: string, content: string) => ({ path, content, encoding: "utf8" as const });
function deploy(body: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(base + "/api/deploy", { method: "POST", headers, body: JSON.stringify(body) });
}

test("health reports deploy enabled when a token is configured", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  const j = (await r.json()) as { ok: boolean; deployEnabled: boolean };
  assert.equal(j.ok, true);
  assert.equal(j.deployEnabled, true);
});

test("deploy is fail-closed without a valid token", async () => {
  assert.equal((await deploy({ files: [file("index.html", "x")] }, null)).status, 401);
  assert.equal((await deploy({ files: [file("index.html", "x")] }, "wrong-token")).status, 401);
});

test("a valid deploy stores and serves the artifact with the security headers", async () => {
  const r = await deploy({ title: "t", type: "html", files: [file("index.html", "<h1>hi</h1>")] });
  assert.equal(r.status, 201);
  const { id, url } = (await r.json()) as { id: string; url: string };
  assert.ok(id && url.includes(`/s/${id}`));

  // A bare "/s/<id>" must 301 to "/s/<id>/" so relative links in index.html resolve
  // against the deploy root rather than "/s/".
  const bare = await fetch(`${base}/s/${id}`, { redirect: "manual" });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get("location"), `/s/${id}/`);

  const served = await fetch(`${base}/s/${id}/`);
  assert.equal(served.status, 200);
  assert.equal(await served.text(), "<h1>hi</h1>");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.equal(served.headers.get("referrer-policy"), "no-referrer");
  assert.equal(served.headers.get("x-frame-options"), "SAMEORIGIN");

  // _meta.json is server-internal and must never be publicly readable.
  assert.equal((await fetch(`${base}/s/${id}/_meta.json`)).status, 404);
});

test("deploy rejects a missing index.html, a reserved _meta.json, and path traversal", async () => {
  assert.equal((await deploy({ files: [file("a.txt", "x")] })).status, 400); // no index.html
  assert.equal((await deploy({ files: [file("index.html", "x"), file("_meta.json", "{}")] })).status, 400);
  assert.equal((await deploy({ files: [file("../escape", "x"), file("index.html", "x")] })).status, 400);
});

test("deploy enforces the file-count and byte caps", async () => {
  const tooMany = await deploy({ files: ["index.html", "a", "b", "c"].map((p) => file(p, "x")) });
  assert.equal(tooMany.status, 413); // 4 files > MAX_FILES=3
  const tooBig = await deploy({ files: [file("index.html", "x".repeat(200))] });
  assert.equal(tooBig.status, 413); // 200 bytes > MAX_BYTES=80
});

test("serving an unknown id returns 404", async () => {
  assert.equal((await fetch(`${base}/s/zzzzzzzz/`)).status, 404);
});

test("/api/index is public and exposes a trimmed, description-bearing projection", async () => {
  const r = await deploy({
    title: "Indexed",
    description: "A short summary.",
    type: "html",
    files: [file("index.html", "<h1>hi</h1>")],
  });
  assert.equal(r.status, 201);
  const { id } = (await r.json()) as { id: string };

  // Public: no Authorization header is sent.
  const idx = await fetch(`${base}/api/index`);
  assert.equal(idx.status, 200);
  const { deploys } = (await idx.json()) as { deploys: any[] };
  const found = deploys.find((d) => d.id === id);
  assert.ok(found, "the deploy should appear in the public index");
  assert.equal(found.title, "Indexed");
  assert.equal(found.description, "A short summary.");
  assert.equal(found.type, "html");
  assert.equal(typeof found.created_at, "string");
  // The public projection must never leak the file list.
  assert.equal("files" in found, false);
});

test("a deploy with no description surfaces description: null on the index", async () => {
  const r = await deploy({ title: "Plain", type: "html", files: [file("index.html", "<p>x</p>")] });
  const { id } = (await r.json()) as { id: string };
  const { deploys } = (await (await fetch(`${base}/api/index`)).json()) as { deploys: any[] };
  assert.equal(deploys.find((d) => d.id === id)?.description, null);
});

test("/api/list still requires a token, while /api/index does not", async () => {
  assert.equal((await fetch(`${base}/api/list`)).status, 401);
  assert.equal((await fetch(`${base}/api/index`)).status, 200);
});

test("a custom --id deploys to a stable URL and overwrites in place, pruning stale files", async () => {
  const slug = "my-app";
  const r1 = await deploy({ id: slug, files: [file("index.html", "v1"), file("extra.txt", "x")] });
  assert.equal(r1.status, 201);
  const j1 = (await r1.json()) as { id: string; url: string };
  assert.equal(j1.id, slug);
  assert.ok(j1.url.endsWith(`/s/${slug}`));
  assert.equal(await (await fetch(`${base}/s/${slug}/`)).text(), "v1");
  assert.equal((await fetch(`${base}/s/${slug}/extra.txt`)).status, 200);

  // Redeploy the same id with only index.html: content replaced and extra.txt pruned.
  const r2 = await deploy({ id: slug, files: [file("index.html", "v2")] });
  assert.equal(r2.status, 201);
  assert.equal(await (await fetch(`${base}/s/${slug}/`)).text(), "v2");
  assert.equal((await fetch(`${base}/s/${slug}/extra.txt`)).status, 404);
});

test("an invalid --id slug is rejected (400)", async () => {
  assert.equal((await deploy({ id: "AB", files: [file("index.html", "x")] })).status, 400); // uppercase
  assert.equal((await deploy({ id: "-bad", files: [file("index.html", "x")] })).status, 400); // leading hyphen
  assert.equal((await deploy({ id: "a", files: [file("index.html", "x")] })).status, 400); // too short
});

test("the CLI api client round-trips through the live worker", async () => {
  // Closes the cli/src/api.ts -> Worker contract (Bearer header, response shape) end-to-end.
  const res = await api.deploy(base, TOKEN, {
    title: "via-api",
    type: "html",
    files: [{ path: "index.html", content: "<p>ok</p>", encoding: "utf8" }],
  });
  assert.ok(res.id && res.url.includes(`/s/${res.id}`));
  // res.url's host follows GETONUP_PUBLIC_URL (prod in wrangler.jsonc); fetch the local
  // worker by id so the round-trip assertion is independent of the configured base.
  const got = await fetch(`${base}/s/${res.id}/`);
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "<p>ok</p>");
});

// Boot a worker with extra env vars, deploy index.html, and return the served response headers.
async function servedHeadersWith(extraVars: Record<string, string>): Promise<Headers> {
  const w = await unstable_dev("src/index.ts", {
    experimental: { disableExperimentalWarning: true },
    vars: { GETONUP_DEPLOY_TOKEN: TOKEN, ...extraVars },
  });
  try {
    const b = `http://127.0.0.1:${w.port}`;
    const r = await fetch(b + "/api/deploy", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ files: [file("index.html", "x")] }),
    });
    const { id } = (await r.json()) as { id: string };
    return (await fetch(`${b}/s/${id}/`)).headers;
  } finally {
    await w.stop();
  }
}

test("the host serves a robots.txt that blocks every crawler", async () => {
  const r = await fetch(base + "/robots.txt");
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /User-agent: \*/);
  assert.match(body, /Disallow: \//);
});

test("a GETONUP_FRAME_ANCESTORS value sets a CSP frame-ancestors and drops X-Frame-Options", async () => {
  const h = await servedHeadersWith({ GETONUP_FRAME_ANCESTORS: "'self'" });
  assert.equal(h.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(h.get("x-frame-options"), null);
});

test("an empty GETONUP_FRAME_ANCESTORS leaves artifacts embeddable (no framing headers)", async () => {
  const h = await servedHeadersWith({ GETONUP_FRAME_ANCESTORS: "" });
  assert.equal(h.get("x-frame-options"), null);
  assert.equal(h.get("content-security-policy"), null);
});

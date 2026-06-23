import { test } from "node:test";
import assert from "node:assert/strict";
import { deploy, type ApiError } from "../src/api.js";

// Stub global fetch to exercise api.call's response handling without a server.
function stubFetch(status: number, body: string, contentType = "text/plain"): () => void {
  const orig = globalThis.fetch;
  (globalThis as any).fetch = async () =>
    new Response(body, { status, headers: { "content-type": contentType } });
  return () => {
    (globalThis as any).fetch = orig;
  };
}

// Capture the headers api.call sends, so we can assert auth/Access wiring.
function captureFetch(): { headers: () => Record<string, string>; restore: () => void } {
  const orig = globalThis.fetch;
  let seen: Record<string, string> = {};
  (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
    seen = (init.headers as Record<string, string>) || {};
    return new Response(JSON.stringify({ id: "x", url: "u", files: [], bytes: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { headers: () => seen, restore: () => { (globalThis as any).fetch = orig; } };
}

test("a non-JSON HTML error body collapses to a status, not the dumped page", async () => {
  const restore = stubFetch(500, "<html><body>" + "x".repeat(1000) + "</body></html>", "text/html");
  try {
    await assert.rejects(deploy("https://x.example", "tok", { files: [] }), (e: ApiError) => {
      assert.equal(e.status, 500);
      assert.equal(e.message, "HTTP 500");
      return true;
    });
  } finally {
    restore();
  }
});

test("a Cloudflare Access HTML interstitial fails even when it returns 200", async () => {
  const restore = stubFetch(
    200,
    '<!doctype html><title>Cloudflare Access</title><a href="/cdn-cgi/access/login/example">login</a>',
    "text/html",
  );
  try {
    await assert.rejects(deploy("https://x.example", "tok", { files: [] }), (e: ApiError) => {
      assert.equal(e.status, 200);
      assert.match(e.message, /Cloudflare Access blocked https:\/\/x\.example\/api\/deploy/);
      assert.match(e.message, /GETONUP_ACCESS_CLIENT_ID/);
      assert.match(e.message, /GETONUP_ACCESS_CLIENT_SECRET/);
      return true;
    });
  } finally {
    restore();
  }
});

test("a 2xx non-JSON response fails instead of masquerading as a deploy result", async () => {
  const restore = stubFetch(200, "<html><body>not the API</body></html>", "text/html");
  try {
    await assert.rejects(deploy("https://x.example", "tok", { files: [] }), (e: ApiError) => {
      assert.equal(e.status, 200);
      assert.equal(e.message, "HTTP 200");
      return true;
    });
  } finally {
    restore();
  }
});

test("a non-JSON plain-text error is surfaced but truncated to <=300 chars", async () => {
  const restore = stubFetch(400, "boom ".repeat(100));
  try {
    await assert.rejects(deploy("https://x.example", "tok", { files: [] }), (e: ApiError) => {
      assert.equal(e.status, 400);
      assert.ok(e.message.length <= 300, `expected <=300, got ${e.message.length}`);
      return true;
    });
  } finally {
    restore();
  }
});

test("a JSON error surfaces the error field", async () => {
  const restore = stubFetch(401, JSON.stringify({ error: "unauthorized" }), "application/json");
  try {
    await assert.rejects(deploy("https://x.example", "tok", { files: [] }), (e: ApiError) => {
      assert.equal(e.status, 401);
      assert.equal(e.message, "unauthorized");
      return true;
    });
  } finally {
    restore();
  }
});

test("an Access service token is sent as CF-Access-Client-* headers", async () => {
  const cap = captureFetch();
  try {
    await deploy("https://x.example", "tok", { files: [] }, { clientId: "cid.access", clientSecret: "csec" });
    const h = cap.headers();
    assert.equal(h["authorization"], "Bearer tok");
    assert.equal(h["cf-access-client-id"], "cid.access");
    assert.equal(h["cf-access-client-secret"], "csec");
  } finally {
    cap.restore();
  }
});

test("no Access token → no CF-Access-Client-* headers", async () => {
  const cap = captureFetch();
  try {
    await deploy("https://x.example", "tok", { files: [] });
    const h = cap.headers();
    assert.equal(h["cf-access-client-id"], undefined);
    assert.equal(h["cf-access-client-secret"], undefined);
  } finally {
    cap.restore();
  }
});

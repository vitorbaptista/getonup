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

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { respond } from "../src/mcp.js";

async function withMcpEnv(
  user: string | undefined,
  fn: () => Promise<void>,
  extra: Record<string, string> = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "getonup-mcp-"));
  const keys = [
    "GETONUP_CONFIG_DIR",
    "GETONUP_URL",
    "GETONUP_TOKEN",
    "GETONUP_USER",
    "GETONUP_ACCESS_CLIENT_ID",
    "GETONUP_ACCESS_CLIENT_SECRET",
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GETONUP_CONFIG_DIR = dir;
  process.env.GETONUP_URL = "https://getonup.example";
  process.env.GETONUP_TOKEN = "tok";
  if (user === undefined) delete process.env.GETONUP_USER;
  else process.env.GETONUP_USER = user;
  delete process.env.GETONUP_ACCESS_CLIENT_ID;
  delete process.env.GETONUP_ACCESS_CLIENT_SECRET;
  Object.assign(process.env, extra);
  try {
    await fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("initialize returns getonup server info and echoes protocolVersion", async () => {
  const r = await respond({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(r?.result.serverInfo.name, "getonup");
  assert.equal(r?.result.protocolVersion, "2025-06-18");
  assert.ok(r?.result.capabilities.tools);
});

test("tools/list advertises the three hosting tools", async () => {
  const r = await respond({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = r?.result.tools.map((t: any) => t.name).sort();
  assert.deepEqual(names, ["deploy_artifact", "list_deploys", "remove_deploy"]);
});

test("notifications get no reply", async () => {
  assert.equal(await respond({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("unknown method is a JSON-RPC method-not-found error", async () => {
  const r = await respond({ jsonrpc: "2.0", id: 9, method: "bogus/thing" });
  assert.equal(r?.error.code, -32601);
});

test("deploy_artifact sends the configured user as deployed_by", async () => {
  await withMcpEnv("MCP User", async () => {
    const originalFetch = globalThis.fetch;
    let body: any;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "mcp-id", url: "https://getonup.example/s/mcp-id", files: ["index.html"], bytes: 10 }), {
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const response = await respond({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "deploy_artifact", arguments: { content: "<h1>Hi</h1>", type: "html" } },
      });
      assert.equal(response?.result.isError, false);
      assert.equal(body.deployed_by, "MCP User");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("deploy_artifact reports missing user before an incomplete Access configuration", async () => {
  await withMcpEnv(undefined, async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      throw new Error("should not upload");
    };
    try {
      const response = await respond({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "deploy_artifact", arguments: { content: "<h1>Hi</h1>" } },
      });
      assert.equal(response?.result.isError, true);
      assert.match(response?.result.content[0].text, /GETONUP_USER/);
      assert.match(response?.result.content[0].text, /login .*--user/);
      assert.equal(fetched, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, { GETONUP_ACCESS_CLIENT_ID: "incomplete-id" });
});

test("list_deploys displays deployers and uses unknown for historical metadata", async () => {
  await withMcpEnv("Viewer", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ deploys: [
      { id: "new-id", type: "html", title: "New", deployed_by: "Alice" },
      { id: "old-id", type: "html", title: "Old" },
    ] }), { headers: { "content-type": "application/json" } });
    try {
      const response = await respond({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "list_deploys", arguments: {} },
      });
      const text = response?.result.content[0].text;
      assert.match(text, /by Alice/);
      assert.match(text, /by unknown/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

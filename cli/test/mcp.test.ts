import { test } from "node:test";
import assert from "node:assert/strict";
import { respond } from "../src/mcp.js";

test("initialize returns Conjure server info and echoes protocolVersion", async () => {
  const r = await respond({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(r?.result.serverInfo.name, "conjure");
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

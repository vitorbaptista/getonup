import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveAccess } from "../src/config.js";

// loadConfig reads GETONUP_CONFIG_DIR/config.json, with GETONUP_URL/GETONUP_TOKEN overriding it.
async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k]!;
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

test("loadConfig reads the file when no env vars are set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cfg-"));
  try {
    await writeFile(join(dir, "config.json"), JSON.stringify({ url: "https://file.example", token: "filetok" }));
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: undefined, GETONUP_TOKEN: undefined }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, "https://file.example");
      assert.equal(cfg.token, "filetok");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("env vars take precedence over the config file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cfg-"));
  try {
    await writeFile(join(dir, "config.json"), JSON.stringify({ url: "https://file.example", token: "filetok" }));
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: "https://env.example", GETONUP_TOKEN: "envtok" }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, "https://env.example");
      assert.equal(cfg.token, "envtok");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Access service-token: env overrides file, like url/token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cfg-"));
  try {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ url: "u", accessClientId: "file-id", accessClientSecret: "file-sec" }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: undefined, GETONUP_TOKEN: undefined, GETONUP_ACCESS_CLIENT_ID: undefined, GETONUP_ACCESS_CLIENT_SECRET: undefined }, async () => {
      const cfg = await loadConfig();
      assert.deepEqual(resolveAccess(cfg), { clientId: "file-id", clientSecret: "file-sec" });
    });
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_ACCESS_CLIENT_ID: "env-id", GETONUP_ACCESS_CLIENT_SECRET: "env-sec" }, async () => {
      const cfg = await loadConfig();
      assert.deepEqual(resolveAccess(cfg), { clientId: "env-id", clientSecret: "env-sec" });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveAccess: undefined when neither half is set, throws when only one is", () => {
  assert.equal(resolveAccess({ url: "u" }), undefined);
  assert.throws(() => resolveAccess({ url: "u", accessClientId: "id" }), /both/);
  assert.throws(() => resolveAccess({ url: "u", accessClientSecret: "sec" }), /both/);
});

test("malformed config JSON falls back cleanly instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cfg-"));
  try {
    await writeFile(join(dir, "config.json"), "{ not valid json");
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: undefined, GETONUP_TOKEN: undefined }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, undefined);
      assert.equal(cfg.token, undefined);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveAccess, saveProfile, listProfiles, activeProfileName } from "../src/config.js";

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

// --- profiles --------------------------------------------------------------

// Neutralise every GETONUP_* override so a profile test sees only its config file.
const CLEAN_ENV = {
  GETONUP_URL: undefined,
  GETONUP_TOKEN: undefined,
  GETONUP_ACCESS_CLIENT_ID: undefined,
  GETONUP_ACCESS_CLIENT_SECRET: undefined,
  GETONUP_PROFILE: undefined,
};

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cfg-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadConfig resolves the default profile from a {default, profiles} file", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        default: "main",
        profiles: {
          main: { url: "https://main.example", token: "main-tok" },
          other: { url: "https://other.example", token: "other-tok" },
        },
      }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, "https://main.example");
      assert.equal(cfg.token, "main-tok");
    });
  });
});

test("selector and GETONUP_PROFILE pick a non-default profile; selector wins over env", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        default: "main",
        profiles: {
          main: { url: "https://main.example" },
          other: { url: "https://other.example" },
          third: { url: "https://third.example" },
        },
      }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      assert.equal((await loadConfig("other")).url, "https://other.example");
    });
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV, GETONUP_PROFILE: "other" }, async () => {
      assert.equal((await loadConfig()).url, "https://other.example");
      assert.equal((await loadConfig("third")).url, "https://third.example"); // explicit beats env
    });
  });
});

test("an explicit unknown profile throws; a dangling default degrades quietly", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "gone", profiles: { main: { url: "https://main.example" } } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await assert.rejects(() => loadConfig("nope"), /unknown profile/);
      // default points at a deleted profile → no active profile, but no throw
      assert.equal((await loadConfig()).url, undefined);
    });
    // env still specifies a target even when the default dangles
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV, GETONUP_URL: "https://env.example" }, async () => {
      assert.equal((await loadConfig()).url, "https://env.example");
    });
  });
});

test("env vars overlay the selected profile per field", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "main", profiles: { main: { url: "https://main.example", token: "main-tok" } } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV, GETONUP_URL: "https://env.example" }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, "https://env.example"); // env wins
      assert.equal(cfg.token, "main-tok"); // unset env field falls back to the profile
    });
  });
});

test("saveProfile: first profile becomes default, later ones don't, makeDefault re-points", async () => {
  await withTmp(async (dir) => {
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await saveProfile("main", { url: "https://main.example", token: "t1" });
      assert.deepEqual(await listProfiles(), {
        default: "main",
        profiles: { main: { url: "https://main.example", token: "t1" } },
      });
      await saveProfile("other", { url: "https://other.example" });
      assert.equal((await listProfiles()).default, "main"); // unchanged
      await saveProfile("other", { url: "https://other.example" }, { makeDefault: true });
      assert.equal((await listProfiles()).default, "other");
      const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
      assert.equal(onDisk.default, "other");
      assert.deepEqual(Object.keys(onDisk.profiles).sort(), ["main", "other"]);
    });
  });
});

test("saveProfile migrates a legacy flat config, keeping the old creds as the 'default' profile", async () => {
  await withTmp(async (dir) => {
    await writeFile(join(dir, "config.json"), JSON.stringify({ url: "https://legacy.example", token: "legacy-tok" }));
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await saveProfile("prod", { url: "https://prod.example", token: "prod-tok" });
      const { profiles, default: def } = await listProfiles();
      assert.equal(def, "default"); // migration set default="default"; prod isn't the first profile
      assert.equal(profiles.default.url, "https://legacy.example");
      assert.equal(profiles.prod.url, "https://prod.example");
      assert.equal((await loadConfig()).url, "https://legacy.example"); // legacy creds still active
      assert.equal((await loadConfig("prod")).url, "https://prod.example");
    });
  });
});

test("activeProfileName reflects selector / env / default precedence", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "main", profiles: { main: {}, other: {} } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      assert.equal(await activeProfileName(), "main");
      assert.equal(await activeProfileName("other"), "other");
    });
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV, GETONUP_PROFILE: "other" }, async () => {
      assert.equal(await activeProfileName(), "other");
    });
  });
});

test("a corrupt (non-object) profile entry is dropped, not crashed on", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "main", profiles: { main: { url: "https://main.example" }, broken: null, alsoBad: "nope" } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      assert.deepEqual(Object.keys((await listProfiles()).profiles).sort(), ["main"]);
      assert.equal((await loadConfig()).url, "https://main.example");
    });
  });
});

test("an empty-string default is treated as unset", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "", profiles: { a: { url: "https://a.example" } } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      assert.equal((await listProfiles()).default, undefined);
      assert.equal((await loadConfig()).url, undefined); // no active profile (no fallback to the sole one)
      await saveProfile("b", { url: "https://b.example" }); // "no default yet" → b becomes it
      assert.equal((await listProfiles()).default, "b");
    });
  });
});

test("a profile literally named 'default' round-trips alongside the default pointer", async () => {
  await withTmp(async (dir) => {
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await saveProfile("default", { url: "https://d.example", token: "dt" });
      const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
      assert.deepEqual(onDisk, { default: "default", profiles: { default: { url: "https://d.example", token: "dt" } } });
      assert.equal((await loadConfig()).url, "https://d.example");
    });
  });
});

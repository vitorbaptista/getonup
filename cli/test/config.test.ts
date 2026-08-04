import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveAccess, saveProfile, listProfiles, activeProfileName } from "../src/config.js";

// loadConfig reads GETONUP_CONFIG_DIR/config.json, with GETONUP_* values overriding it.
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
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: undefined, GETONUP_TOKEN: undefined, GETONUP_USER: undefined }, async () => {
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
    await writeFile(join(dir, "config.json"), JSON.stringify({ url: "https://file.example", token: "filetok", user: "File User" }));
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: "https://env.example", GETONUP_TOKEN: "envtok", GETONUP_USER: "Env User" }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, "https://env.example");
      assert.equal(cfg.token, "envtok");
      assert.equal(cfg.user, "Env User");
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
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: undefined, GETONUP_TOKEN: undefined, GETONUP_USER: undefined, GETONUP_ACCESS_CLIENT_ID: undefined, GETONUP_ACCESS_CLIENT_SECRET: undefined }, async () => {
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

test("malformed config JSON fails loudly, naming the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cfg-"));
  try {
    await writeFile(join(dir, "config.json"), "{ not valid json");
    await withEnv({ GETONUP_CONFIG_DIR: dir, GETONUP_URL: undefined, GETONUP_TOKEN: undefined, GETONUP_USER: undefined }, async () => {
      await assert.rejects(() => loadConfig(), (e: Error) => {
        assert.match(e.message, /invalid config at .*config\.json: not valid JSON/);
        return true;
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no config file at all is fine — env vars alone still work", async () => {
  await withTmp(async (dir) => {
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, undefined);
      assert.deepEqual(await listProfiles(), { default: undefined, user: undefined, profiles: {} });
    });
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV, GETONUP_URL: "https://env.example", GETONUP_TOKEN: "envtok" }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, "https://env.example");
      assert.equal(cfg.token, "envtok");
    });
  });
});

test("an empty config file is treated as nothing configured", async () => {
  await withTmp(async (dir) => {
    await writeFile(join(dir, "config.json"), "\n");
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      assert.equal((await loadConfig()).url, undefined);
    });
  });
});

// --- profiles --------------------------------------------------------------

// Neutralise every GETONUP_* override so a profile test sees only its config file.
const CLEAN_ENV = {
  GETONUP_URL: undefined,
  GETONUP_TOKEN: undefined,
  GETONUP_USER: undefined,
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
        user: undefined,
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

test("saveProfile migrates a legacy flat config, keeping the old config as the 'default' profile", async () => {
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

test("a corrupt (non-object) profile entry is reported, listing every problem at once", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "main", profiles: { main: { url: "https://main.example" }, broken: null, alsoBad: "nope" } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await assert.rejects(() => listProfiles(), (e: Error) => {
        assert.match(e.message, /profiles\.broken: expected an object, got null/);
        assert.match(e.message, /profiles\.alsoBad: expected an object, got a string/);
        return true;
      });
    });
  });
});

test("the invalid-config error says how to recover, since login is blocked too", async () => {
  await withTmp(async (dir) => {
    await writeFile(join(dir, "config.json"), JSON.stringify({ profiles: { main: { token: 9 } } }));
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await assert.rejects(() => loadConfig(), /delete it and run `getonup login` again/);
      // saveProfile reads before it writes, so `login` can't repair a broken file on its own.
      await assert.rejects(() => saveProfile("main", { url: "https://x.example" }), /invalid config/);
      // unparseable JSON is just as much a lockout, so it needs the same way out
      await writeFile(join(dir, "config.json"), "{ not valid json");
      await assert.rejects(() => loadConfig(), /delete it and run `getonup login` again/);
    });
  });
});

test("saveProfile refuses '__proto__' rather than reporting a save that stored nothing", async () => {
  await withTmp(async (dir) => {
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await assert.rejects(() => saveProfile("__proto__", { url: "https://x.example" }), /not a usable profile name/);
      // every other Object.prototype name assigns normally and round-trips
      await saveProfile("constructor", { url: "https://c.example" });
      assert.equal((await loadConfig("constructor")).url, "https://c.example");
    });
  });
});

test("a profile named after an Object.prototype member is not mistaken for a real one", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "main", profiles: { main: { url: "https://main.example" } } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      for (const name of ["constructor", "toString", "__proto__", "valueOf"]) {
        await assert.rejects(() => loadConfig(name), /unknown profile/, `--profile ${name} should not resolve`);
      }
    });
    // ...and a `default` pointing at one degrades to "no active profile", not to a phantom
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ default: "toString", profiles: { main: { url: "https://main.example" } } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      assert.equal(await activeProfileName(), undefined);
      assert.equal((await loadConfig()).url, undefined);
    });
  });
});

test("wrong types on known keys are rejected, in whichever shape they appear", async () => {
  await withTmp(async (dir) => {
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      const bad: Array<[unknown, RegExp]> = [
        [["not", "an", "object"], /expected an object, got an array/],
        ["just a string", /expected an object, got a string/],
        [{ default: 1, profiles: {} }, /default: expected a string, got a number/],
        [{ user: { name: "x" }, profiles: {} }, /user: expected a string, got an object/],
        [{ profiles: [] }, /profiles: expected an object, got an array/],
        [{ profiles: { main: { token: 42 } } }, /profiles\.main\.token: expected a string, got a number/],
        [{ url: "https://x.example", token: false }, /token: expected a string, got a boolean/],
        // ...including keys the branch that gets taken doesn't itself read
        [{ default: 42, url: "https://legacy.example" }, /default: expected a string, got a number/],
        [{ profiles: { main: {} }, token: 42 }, /token: expected a string, got a number/],
      ];
      for (const [content, pattern] of bad) {
        await writeFile(join(dir, "config.json"), JSON.stringify(content));
        await assert.rejects(() => loadConfig(), pattern, `should reject ${JSON.stringify(content)}`);
      }
    });
  });
});

test("misspelled keys are rejected rather than silently dropped", async () => {
  await withTmp(async (dir) => {
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      const bad: Array<[unknown, RegExp]> = [
        // "profile" for "profiles" — the old code read this as "nothing configured"
        [{ default: "main", profile: { main: { url: "https://x.example" } } }, /^ {2}profile: unknown key/m],
        // a typo'd key next to a valid one: the credential is dropped, auth then fails opaquely
        [{ url: "https://x.example", tokne: "secret" }, /^ {2}tokne: unknown key/m],
        // ...including inside a profile
        [
          { default: "main", profiles: { main: { url: "https://x.example", tokne: "secret" } } },
          /^ {2}profiles\.main\.tokne: unknown key/m,
        ],
      ];
      for (const [content, pattern] of bad) {
        await writeFile(join(dir, "config.json"), JSON.stringify(content));
        await assert.rejects(() => loadConfig(), pattern, `should reject ${JSON.stringify(content)}`);
      }
      // an empty object is still fine — it says "nothing configured", unambiguously
      await writeFile(join(dir, "config.json"), "{}");
      assert.equal((await loadConfig()).url, undefined);
    });
  });
});

test("mixing legacy top-level keys with profiles is rejected as ambiguous", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ url: "https://legacy.example", token: "t", profiles: { main: { url: "https://main.example" } } }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await assert.rejects(() => loadConfig(), /url, token: legacy top-level key\(s\) alongside "profiles"/);
    });
  });
});

test("a v0.7.0 config, with the user inside a profile, still loads", async () => {
  // v0.8.0 moved `user` next to `default` and stopped reading the old position (CHANGELOG),
  // but the file is still a config we recognise — validation must not turn that into a lockout.
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        default: "default",
        profiles: { default: { url: "https://x.example", token: "t", user: "Alice" } },
      }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      const cfg = await loadConfig();
      assert.equal(cfg.url, "https://x.example");
      assert.equal(cfg.token, "t");
      assert.equal(cfg.user, undefined); // still not read from the old position, as documented
      // a stale `user` must be a string like any other — a broken one is still a broken config
      await writeFile(
        join(dir, "config.json"),
        JSON.stringify({ profiles: { default: { url: "https://x.example", user: 42 } } }),
      );
      await assert.rejects(() => loadConfig(), /profiles\.default\.user: expected a string, got a number/);
    });
  });
});

test("a config that cannot be read at all fails loudly (not just a missing one)", async () => {
  await withTmp(async (dir) => {
    await mkdir(join(dir, "config.json")); // a directory where the file should be → EISDIR
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await assert.rejects(() => loadConfig(), /cannot read config at .*config\.json/);
      // it's a lockout like any other config error, so it gets the same way out
      await assert.rejects(() => loadConfig(), /delete it and run `getonup login` again/);
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

test("the global user applies to every profile, with GETONUP_USER taking precedence", async () => {
  await withTmp(async (dir) => {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        default: "main",
        user: "Global User",
        profiles: { main: { url: "https://main.example" }, other: { url: "https://other.example" } },
      }),
    );
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      assert.equal((await loadConfig()).user, "Global User");
      assert.equal((await loadConfig("other")).user, "Global User");
    });
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV, GETONUP_USER: "Environment User" }, async () => {
      assert.equal((await loadConfig("other")).user, "Environment User");
    });
  });
});

test("saveProfile persists the user globally, not under the profile", async () => {
  await withTmp(async (dir) => {
    await withEnv({ GETONUP_CONFIG_DIR: dir, ...CLEAN_ENV }, async () => {
      await saveProfile("main", { url: "https://main.example", token: "tok" }, { user: "Vitor" });
      const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
      assert.equal(onDisk.user, "Vitor");
      assert.equal(onDisk.profiles.main.user, undefined);
      assert.equal((await loadConfig()).user, "Vitor");
      // a second profile inherits it
      await saveProfile("other", { url: "https://other.example" });
      assert.equal((await loadConfig("other")).user, "Vitor");
    });
  });
});

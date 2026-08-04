import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const PKG = fileURLToPath(new URL("../package.json", import.meta.url));

// Run the CLI from source via tsx, without relying on `tsx` being on PATH
// (it's hoisted to the monorepo root). `--import tsx` resolves it as a module.
function runCli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, ...args], {
      cwd: CLI_DIR,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function pkgVersion(): Promise<string> {
  return JSON.parse(await readFile(PKG, "utf8")).version;
}

test("`version` reports the package.json version, not a stale constant", async () => {
  const { code, stdout } = await runCli(["version"]);
  assert.equal(code, 0);
  assert.equal(stdout, `getonup ${await pkgVersion()}\n`);
});

test("`--version` reports the same version as `version`", async () => {
  const { stdout } = await runCli(["--version"]);
  assert.equal(stdout, `getonup ${await pkgVersion()}\n`);
});

test("`login` with no args surfaces the required user and optional Cloudflare Access flags", async () => {
  const { code, stderr } = await runCli(["login"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("--user"), `stderr was: ${stderr}`);
  assert.ok(stderr.includes("--access-client-id"), `stderr was: ${stderr}`);
  assert.ok(stderr.includes("--access-client-secret"), `stderr was: ${stderr}`);
});

test("`login` rejects blank and oversized user names before contacting the server", async () => {
  const env = { GETONUP_USER: "" };
  const blank = await runCli([
    "login", "--url", "https://unused.example", "--token", "tok", "--user", "   ",
  ], env);
  assert.equal(blank.code, 1);
  assert.match(blank.stderr, /user name is required/);
  assert.doesNotMatch(blank.stderr, /could not reach/);

  const oversized = await runCli([
    "login", "--url", "https://unused.example", "--token", "tok", "--user", "x".repeat(101),
  ], env);
  assert.equal(oversized.code, 1);
  assert.match(oversized.stderr, /at most 100 characters/);
  assert.doesNotMatch(oversized.stderr, /could not reach/);
});

test("`login --user` persists the user and `whoami` displays it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cli-"));
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, deployEnabled: true }));
  });
  try {
    const url = await listen(server);
    const env = { GETONUP_CONFIG_DIR: dir, GETONUP_URL: "", GETONUP_TOKEN: "", GETONUP_USER: "" };
    const login = await runCli(["login", "--url", url, "--token", "tok", "--user", "Vitor"], env);
    assert.equal(login.code, 0, login.stderr);
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
    assert.equal(onDisk.user, "Vitor"); // global, not under the profile
    assert.equal(onDisk.profiles.default.user, undefined);

    const whoami = await runCli(["whoami"], env);
    assert.equal(whoami.code, 0, whoami.stderr);
    assert.match(whoami.stdout, /user:\s+Vitor/);

    // a later login for another server reuses the global user and shares it
    const second = await runCli(["login", "--url", url, "--token", "tok2", "--profile", "other"], env);
    assert.equal(second.code, 0, second.stderr);
    assert.match((await runCli(["whoami", "--profile", "other"], env)).stdout, /user:\s+Vitor/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("`deploy` fails before reading or uploading when no user is configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cli-"));
  try {
    const result = await runCli(["deploy", "does-not-exist.html"], {
      GETONUP_CONFIG_DIR: dir,
      GETONUP_URL: "https://unused.example",
      GETONUP_TOKEN: "tok",
      GETONUP_USER: "",
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /GETONUP_USER/);
    assert.match(result.stderr, /login .*--user/);
    assert.doesNotMatch(result.stderr, /no such file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`deploy` sends the resolved user as deployed_by", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cli-"));
  const artifact = join(dir, "index.html");
  await writeFile(artifact, "<h1>Hello</h1>");
  let body: any;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) body = (body || "") + chunk;
    body = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "test-id", url: "https://live.example/s/test-id", files: ["index.html"], bytes: 14 }));
  });
  try {
    const url = await listen(server);
    const result = await runCli(["deploy", artifact, "--json"], {
      GETONUP_CONFIG_DIR: dir,
      GETONUP_URL: url,
      GETONUP_TOKEN: "tok",
      GETONUP_USER: "Environment User",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(body.deployed_by, "Environment User");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("`list` displays deployers and uses unknown for historical metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-cli-"));
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ deploys: [
      { id: "new-id", type: "html", title: "New", created_at: "2026-01-02T00:00:00.000Z", deployed_by: "Alice" },
      { id: "old-id", type: "html", title: "Old", created_at: "2026-01-01T00:00:00.000Z" },
    ] }));
  });
  try {
    const url = await listen(server);
    const result = await runCli(["list"], {
      GETONUP_CONFIG_DIR: dir,
      GETONUP_URL: url,
      GETONUP_TOKEN: "tok",
      GETONUP_USER: "Viewer",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /by Alice/);
    assert.match(result.stdout, /by unknown/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

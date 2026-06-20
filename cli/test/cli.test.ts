import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const PKG = fileURLToPath(new URL("../package.json", import.meta.url));

// Run the CLI from source via tsx, without relying on `tsx` being on PATH
// (it's hoisted to the monorepo root). `--import tsx` resolves it as a module.
function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, ...args], {
      cwd: CLI_DIR,
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

test("`login` with no args surfaces the optional Cloudflare Access flags in its usage", async () => {
  const { code, stderr } = await runCli(["login"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("--access-client-id"), `stderr was: ${stderr}`);
  assert.ok(stderr.includes("--access-client-secret"), `stderr was: ${stderr}`);
});

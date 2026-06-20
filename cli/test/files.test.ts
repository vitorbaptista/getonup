import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileToDeploy, walkDir } from "../src/files.js";
import type { DeployFile } from "../src/api.js";

test("fileToDeploy encodes text as utf8 and binary as base64", () => {
  const text = fileToDeploy("index.html", Buffer.from("<h1>hi</h1>"));
  assert.equal(text.encoding, "utf8");
  assert.equal(text.content, "<h1>hi</h1>");

  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const png = fileToDeploy("logo.png", bytes);
  assert.equal(png.encoding, "base64");
  assert.equal(png.content, bytes.toString("base64"));
});

test("walkDir collects files recursively and skips .git / node_modules / .DS_Store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-walk-"));
  try {
    await writeFile(join(dir, "index.html"), "x");
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "a.css"), "y");
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "config"), "no");
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "pkg.js"), "no");
    await writeFile(join(dir, ".DS_Store"), "no");

    const out: DeployFile[] = [];
    await walkDir(dir, dir, out);
    assert.deepEqual(out.map((f) => f.path).sort(), ["index.html", "sub/a.css"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

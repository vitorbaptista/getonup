import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileToDeploy, walkDir, resolveIndex, promoteIndex } from "../src/files.js";
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

test("resolveIndex: a root index.html is the default; an explicit --index-file overrides it", () => {
  assert.equal(resolveIndex(["index.html", "about.html", "style.css"]), "index.html");
  // an explicit --index-file is authoritative — it picks the homepage even when index.html exists
  assert.equal(resolveIndex(["index.html", "about.html"], "about.html"), "about.html");
  assert.equal(resolveIndex(["index.html"], "index.html"), "index.html");
});

test("resolveIndex: promotes the sole root-level HTML file (.html or .htm, any case)", () => {
  assert.equal(resolveIndex(["report.html", "style.css", "img/logo.png"]), "report.html");
  assert.equal(resolveIndex(["page.htm", "data.json"]), "page.htm");
  assert.equal(resolveIndex(["Report.HTML"]), "Report.HTML");
  // a single HTML file in a subdirectory is NOT promoted (would break its relative links)
  assert.equal(resolveIndex(["docs/only.html", "docs/style.css"]), null);
});

test("resolveIndex: multiple root-level HTML without --index-file is ambiguous", () => {
  assert.throws(
    () => resolveIndex(["home.html", "about.html", "style.css"]),
    /multiple HTML files.*--index-file/s,
  );
  // a subdirectory HTML doesn't count toward the ambiguity
  assert.equal(resolveIndex(["home.html", "sub/other.html"]), "home.html");
});

test("resolveIndex: --index-file picks the homepage among several", () => {
  assert.equal(resolveIndex(["home.html", "about.html"], "about.html"), "about.html");
  // normalizes ./ and leading slash and backslashes
  assert.equal(resolveIndex(["home.html", "about.html"], "./about.html"), "about.html");
});

test("resolveIndex: --index-file may point to a file inside a subdirectory", () => {
  assert.equal(resolveIndex(["a.html", "sub/x.html"], "sub/x.html"), "sub/x.html");
  // a subdirectory --index-file overrides a root index.html too
  assert.equal(resolveIndex(["index.html", "docs/page.html"], "docs/page.html"), "docs/page.html");
});

test("resolveIndex: --index-file must be an HTML file that is inside the folder", () => {
  assert.throws(() => resolveIndex(["a.html", "b.html"], "missing.html"), /not inside the folder.*a\.html, b\.html/s);
  assert.throws(() => resolveIndex(["a.html", "b.html"], "notes.txt"), /must name an \.html/);
  // a path that escapes the folder (or is absolute) can never match a walked file → rejected
  assert.throws(() => resolveIndex(["a.html"], "../escape.html"), /not inside the folder/);
  assert.throws(() => resolveIndex(["a.html"], "/etc/passwd.html"), /not inside the folder/);
});

test("resolveIndex: a folder with no root-level HTML returns null", () => {
  assert.equal(resolveIndex(["data.json", "style.css", "img/logo.png"]), null);
  assert.equal(resolveIndex([]), null);
});

test("promoteIndex: copies the chosen file's content to index.html, keeping the original", () => {
  const files: DeployFile[] = [
    { path: "report.html", content: "<h1>report</h1>", encoding: "utf8" },
    { path: "style.css", content: "body{}", encoding: "utf8" },
  ];
  promoteIndex(files, "report.html");
  const index = files.find((f) => f.path === "index.html");
  assert.equal(index?.content, "<h1>report</h1>");
  // the original is still present (inter-page links / its own URL keep working)
  assert.ok(files.some((f) => f.path === "report.html"));
  // exactly one index.html entry
  assert.equal(files.filter((f) => f.path === "index.html").length, 1);
});

test("promoteIndex: is a no-op when the entry is already index.html", () => {
  const files: DeployFile[] = [{ path: "index.html", content: "x", encoding: "utf8" }];
  promoteIndex(files, "index.html");
  assert.deepEqual(files, [{ path: "index.html", content: "x", encoding: "utf8" }]);
});

test("promoteIndex: --index-file override replaces an existing index.html in place (no duplicate)", () => {
  const files: DeployFile[] = [
    { path: "index.html", content: "<h1>old</h1>", encoding: "utf8" },
    { path: "about.html", content: "<h1>about</h1>", encoding: "utf8" },
  ];
  promoteIndex(files, "about.html");
  assert.equal(files.filter((f) => f.path === "index.html").length, 1);
  assert.equal(files.find((f) => f.path === "index.html")?.content, "<h1>about</h1>");
  assert.ok(files.some((f) => f.path === "about.html"));
});

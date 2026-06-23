import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/serve.js";

test("serve wraps a React artifact and hosts it locally", async () => {
  const { url, close } = await startServer(null, { port: 4399 }, "export default function App(){ return <h1>hi</h1>; }");
  try {
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.match(html, /type="importmap"/);
    assert.match(html, /window\.__getonup_default = function App/);
    // SPA-ish fallback: unknown extension-less path serves the entry
    assert.equal((await fetch(url + "/whatever")).status, 200);
    // a missing asset (with extension) 404s
    assert.equal((await fetch(url + "/nope.css")).status, 404);
  } finally {
    close();
  }
});

test("serve hosts a raw HTML string unchanged", async () => {
  const { url, close } = await startServer(null, { port: 4400 }, "<!doctype html><title>x</title><body>RAWBODY</body>");
  try {
    assert.match(await (await fetch(url)).text(), /RAWBODY/);
  } finally {
    close();
  }
});

test("serve --watch injects a live-reload client", async () => {
  const { url, close } = await startServer(null, { port: 4401, watch: true }, "<!doctype html><body>hello</body>");
  try {
    assert.match(await (await fetch(url)).text(), /EventSource\("\/__getonup_live"\)/);
  } finally {
    close();
  }
});

test("serve promotes a folder's sole HTML file to the index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-serve-"));
  try {
    await writeFile(join(dir, "report.html"), "<!doctype html><body>REPORTBODY</body>");
    await writeFile(join(dir, "style.css"), "body{}");
    const { url, close } = await startServer(dir, { port: 4402 });
    try {
      // "/" serves the promoted report.html
      assert.match(await (await fetch(url)).text(), /REPORTBODY/);
      // the original file and its assets remain reachable at their own paths
      assert.match(await (await fetch(url + "/report.html")).text(), /REPORTBODY/);
      assert.equal((await fetch(url + "/style.css")).status, 200);
    } finally {
      close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("serve --index-file picks the homepage among several HTML files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-serve-"));
  try {
    await writeFile(join(dir, "home.html"), "<!doctype html><body>HOMEBODY</body>");
    await writeFile(join(dir, "about.html"), "<!doctype html><body>ABOUTBODY</body>");
    const { url, close } = await startServer(dir, { port: 4403, indexFile: "about.html" });
    try {
      assert.match(await (await fetch(url)).text(), /ABOUTBODY/);
      assert.match(await (await fetch(url + "/home.html")).text(), /HOMEBODY/);
    } finally {
      close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("serve --index-file accepts a file inside a subdirectory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-serve-"));
  try {
    await mkdir(join(dir, "pages"));
    await writeFile(join(dir, "pages", "home.html"), "<!doctype html><body>SUBHOME</body>");
    const { url, close } = await startServer(dir, { port: 4406, indexFile: "pages/home.html" });
    try {
      assert.match(await (await fetch(url)).text(), /SUBHOME/);
      assert.match(await (await fetch(url + "/pages/home.html")).text(), /SUBHOME/);
    } finally {
      close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("serve promotes a sole .htm file and serves it as text/html", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-serve-"));
  try {
    await writeFile(join(dir, "page.htm"), "<!doctype html><body>HTMBODY</body>");
    const { url, close } = await startServer(dir, { port: 4404 });
    try {
      const res = await fetch(url);
      assert.match(res.headers.get("content-type") || "", /text\/html/);
      assert.match(await res.text(), /HTMBODY/);
    } finally {
      close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("serve surfaces resolveIndex's detailed error for a bad --index-file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "getonup-serve-"));
  try {
    await writeFile(join(dir, "home.html"), "<!doctype html><body>x</body>");
    await assert.rejects(
      startServer(dir, { port: 4405, indexFile: "missing.html" }),
      /--index-file is not inside the folder.*home\.html/s,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

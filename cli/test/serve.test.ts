import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/serve.js";

test("serve wraps a React artifact and hosts it locally", async () => {
  const { url, close } = await startServer(null, { port: 4399 }, "export default function App(){ return <h1>hi</h1>; }");
  try {
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.match(html, /type="importmap"/);
    assert.match(html, /window\.__conjure_default = function App/);
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
    assert.match(await (await fetch(url)).text(), /EventSource\("\/__conjure_live"\)/);
  } finally {
    close();
  }
});

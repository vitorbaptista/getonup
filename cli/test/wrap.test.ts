import { test } from "node:test";
import assert from "node:assert/strict";
import { detectType, wrapToHtml } from "../src/wrap.js";

test("detects types by extension", () => {
  assert.equal(detectType("a.html", "<h1>hi</h1>"), "html");
  assert.equal(detectType("a.tsx", "export default function App(){return <div/>}"), "react");
  assert.equal(detectType("a.jsx", "export default () => <div/>"), "react");
  assert.equal(detectType("a.vue", "<template><div/></template>"), "vue");
  assert.equal(detectType("a.js", "console.log(1)"), "js");
});

test("detects react from content in .js", () => {
  assert.equal(detectType("a.js", "import {useState} from 'react'; export default function A(){}"), "react");
});

test("sniffs type with no extension", () => {
  assert.equal(detectType("stdin", "<!doctype html><html></html>"), "html");
  assert.equal(detectType("stdin", "<template><div/></template>"), "vue");
  assert.equal(detectType("stdin", "export default function App(){return <div/>}"), "react");
  assert.equal(detectType("stdin", "alert(1)"), "js");
});

test("full html passes through unchanged", () => {
  const src = "<!doctype html><html><body>hi</body></html>";
  assert.equal(wrapToHtml(src, "html"), src);
});

test("react wrap produces a runnable document", () => {
  const src = "export default function App(){ const [n] = React.useState(0); return <h1>{n}</h1>; }";
  const out = wrapToHtml(src, "react", { title: "T" });
  assert.match(out, /<!doctype html>/);
  assert.match(out, /type="importmap"/);
  assert.match(out, /esm\.sh\/react@18/);
  assert.match(out, /babel\/standalone/);
  assert.match(out, /window\.__conjure_default = function App/); // export default rewritten
  assert.match(out, /createRoot/);
  assert.match(out, /<title>T<\/title>/);
});

test("react wrap captures the aggregate `export { X as default }` form", () => {
  const src = "function App(){ return <h1>hi</h1>; }\nexport { App as default };";
  const out = wrapToHtml(src, "react");
  assert.match(out, /window\.__conjure_default = App;/);
  assert.doesNotMatch(out, /export\s*\{/); // the export statement was rewritten away
});

test("react wrap leaves a default re-export (`... from`) intact, not corrupted", () => {
  const src = 'function x(){return <i/>}\nexport { Thing as default } from "./z";';
  const out = wrapToHtml(src, "react");
  assert.match(out, /export\s*\{\s*Thing as default\s*\}\s*from\s*"\.\/z"/);
  assert.doesNotMatch(out, /window\.__conjure_default = Thing;from/); // not corrupted into a syntax error
});

test("react wrap preserves sibling named exports alongside the default", () => {
  const src = "function A(){return <i/>}\nfunction B(){}\nexport { A as default, B };";
  const out = wrapToHtml(src, "react");
  assert.match(out, /window\.__conjure_default = A;/);
  assert.match(out, /export \{ B \};/);
});

test("plain .ts is transpiled (not shipped as a raw module)", () => {
  assert.equal(detectType("a.ts", "const x: number = 1; export {};"), "js");
  const out = wrapToHtml("const n: number = 1;\ndocument.body.textContent = String(n);", "js");
  assert.match(out, /data-presets="typescript"/);
  assert.match(out, /@babel\/standalone/);
});

test("react wrap captures a same-line `export default` (after a `;`)", () => {
  const src = 'import React from "react"; export default function App(){ return <h1>hi</h1>; }';
  const out = wrapToHtml(src, "react");
  assert.match(out, /window\.__conjure_default = function App/);
  assert.doesNotMatch(out, /;\s*export default function App/); // the real export was rewritten
});

test("react wrap injects React import when missing", () => {
  const out = wrapToHtml("export default () => <div/>", "react");
  assert.match(out, /import React from "react";/);
});

test("react wrap maps third-party imports to esm.sh", () => {
  const out = wrapToHtml("import {Heart} from 'lucide-react'; export default ()=> <Heart/>", "react");
  assert.match(out, /"lucide-react":\s*"https:\/\/esm\.sh\/lucide-react\?external=react,react-dom"/);
});

test("escapes </script> in embedded user code", () => {
  const out = wrapToHtml("export default ()=> <div>{`</script>`}</div>", "react");
  assert.ok(!out.includes("</script></script>"));
  assert.match(out, /<\\\/script>/);
});

test("vue wrap embeds source safely and loads sfc loader", () => {
  const out = wrapToHtml("<template><div>{{1}}</div></template>", "vue");
  assert.match(out, /vue3-sfc-loader/);
  assert.match(out, /vue@3/);
  assert.ok(!/<\/template>\s*<\/script>/.test(out)); // source is a JS string, < escaped
});

test("js wrap adds import map only when bare imports exist", () => {
  assert.doesNotMatch(wrapToHtml("alert(1)", "js"), /importmap/);
  assert.match(wrapToHtml("import confetti from 'canvas-confetti'; confetti()", "js"), /importmap/);
});

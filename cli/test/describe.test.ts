import { test } from "node:test";
import assert from "node:assert/strict";
import { describeHtml } from "../src/describe.js";

test("prefers <meta name=description> over the title", () => {
  const html = `<!doctype html><html><head><title>My Page</title>
    <meta name="description" content="Does a useful thing."></head><body></body></html>`;
  assert.equal(describeHtml(html, "my-page"), "Does a useful thing.");
});

test("meta description is attribute-order- and quote-insensitive, and entity-decoded", () => {
  assert.equal(describeHtml(`<meta content='Tom &amp; Jerry' name=description>`), "Tom & Jerry");
  assert.equal(describeHtml(`<meta NAME="description" CONTENT="Caps work">`), "Caps work");
});

test("falls back to <title> when it adds something beyond the deploy title", () => {
  assert.equal(describeHtml(`<title>Quarterly Sales Report</title>`, "report"), "Quarterly Sales Report");
});

test("skips a <title> that just echoes the deploy title or the wrapper default", () => {
  assert.equal(describeHtml(`<title>report</title>`, "report"), undefined);
  assert.equal(describeHtml(`<title>Report</title>`, "report"), undefined); // case-insensitive
  assert.equal(describeHtml(`<title>getonup artifact</title>`, "counter"), undefined);
});

test("returns undefined for source code with no real markup, and for empty input", () => {
  assert.equal(describeHtml(`export default function App(){ return <div>hi</div>; }`, "app"), undefined);
  assert.equal(describeHtml("", "x"), undefined);
});

test("collapses whitespace and caps length at 200", () => {
  assert.equal(describeHtml(`<meta name="description" content="  a\n   b  ">`), "a b");
  const long = describeHtml(`<meta name="description" content="${"x".repeat(300)}">`);
  assert.equal(long?.length, 200);
});

test("never throws on an out-of-range numeric entity (must not abort a deploy)", () => {
  // String.fromCodePoint throws above 0x10FFFF; describeHtml must swallow it and not block upload.
  assert.doesNotThrow(() => describeHtml(`<meta name="description" content="&#x110000;">`));
  assert.doesNotThrow(() => describeHtml(`<title>&#9999999999;</title>`, "t"));
});

test("ignores data-name / data-content attributes (boundary, not a bare \\b)", () => {
  // A stray data-name must not trigger the description path.
  assert.equal(describeHtml(`<meta data-name="description" content="X">`, "t"), undefined);
  // When both data-content and content are present, read the real content attribute.
  assert.equal(describeHtml(`<meta name="description" data-content="WRONG" content="RIGHT">`), "RIGHT");
});

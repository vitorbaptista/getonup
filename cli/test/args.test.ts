import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

test("parseArgs handles --k=v, --k v, boolean flags, positionals and -", () => {
  // The subcommand is stripped before parseArgs, so "deploy" here is just a positional.
  const a = parseArgs(["deploy", "file.tsx", "--name=demo", "--type", "react", "--open", "-"]);
  assert.deepEqual(a._, ["deploy", "file.tsx", "-"]);
  assert.equal(a.flags.name, "demo");
  assert.equal(a.flags.type, "react");
  assert.equal(a.flags.open, true);
});

test("parseArgs: a flag followed by another flag (or nothing) is boolean true", () => {
  const a = parseArgs(["--quiet", "--json"]);
  assert.equal(a.flags.quiet, true);
  assert.equal(a.flags.json, true);
  const b = parseArgs(["--watch", "-"]);
  assert.equal(b.flags.watch, true);
  assert.deepEqual(b._, ["-"]);
});

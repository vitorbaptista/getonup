#!/usr/bin/env node
/**
 * Republish the getonup demo: deploy every landing design to your server. The homepage is the
 * live index (server/public/index.html, backed by GET /api/index), so the demos simply appear
 * there automatically — there's no gallery to build and no homepage to overwrite.
 *
 * Re-runnable: each run first deletes the previous run's demo deploys (those titled "getonup — …")
 * so they don't accumulate, then publishes fresh. Deploy IDs are assigned by the server per run,
 * so the /s/<id> URLs change each time — the stable entry point is the homepage (`/`).
 *
 *   GETONUP_URL=http://localhost:8787 GETONUP_TOKEN=… node scripts/publish-demo.mjs
 *   (or: npm run demo, after `npm run dev` is up)
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.GETONUP_URL || "http://localhost:8787").replace(/\/+$/, "");
const TOKEN = process.env.GETONUP_TOKEN || "";
const TITLE_PREFIX = "getonup — ";

// [key, display name, one-line description] — one entry per landings/<key>.html. The description
// is sent to the server and shown on the live index (the same field the CLI auto-derives).
const SYSTEMS = [
  ["linear", "Linear", "Strict dark canvas, lavender accent, surface-lift hierarchy."],
  ["vercel", "Vercel", "Extreme minimal, high-contrast ink, geometric Geist energy."],
  ["stripe", "Stripe", "Premium SaaS, indigo, an angled multi-color gradient hero."],
  ["supabase", "Supabase", "Dark developer vibe, emerald green, monospace accents."],
  ["raycast", "Raycast", "Sleek near-black, spotlight / command-palette aesthetic."],
  ["github", "GitHub", "Functional dev-native, dimmed dark, arctic-blue links."],
  ["cursor", "Cursor", "AI-coding dark, Cursor-orange accent, code-forward."],
  ["notion", "Notion", "Light, document-y, friendly purple minimalism."],
  ["figma", "Figma", "Playful design-tool, black with pastel color blocks."],
  ["huggingface", "Hugging Face", "Friendly AI/ML, dark hero, warm yellow accent."],
];
const ORIGINALS = [
  ["midnight", "Midnight 🌌", "The house style — violet→cyan glow, glassy, a little magical."],
  ["scanini", "Scanini ◼︎", "Cream paper, big Boldonse serif, red, stickers, marquee."],
  ["shellshare", "Shellshare ▕", "Minimal hacker-docs — white, monospace, terminal blocks."],
  ["posthog", "PostHog 🟠", "Bold and playful — cream sticker-cards, coral accent."],
  ["claude", "Claude ☕️", "Warm editorial — serif display, terracotta italics, calm."],
  ["funkadelic", "Funkadelic 🕺", "Maximalist 70s funk — drenched oxblood, sunbursts, GET ON UP marquees."],
  ["groovyhacker", "Groovy Hacker ▚", "Funk × terminal — warm CRT amber/magenta phosphor, scanlines, ASCII waves."],
  ["pixelfunk", "Pixel Funk 👾", "16-bit funk game (ToeJam & Earl spirit) — pixel alien mascot, HUD, dithered palette."],
  ["pixelhog", "Pixel Hog 🦔", "PostHog sticker style with pixel charm — pixel hedgehog, pixel icons, no game framing."],
  ["shipit", "Ship It 🚀", "PostHog × 16-bit spaceship — your artifact blasts off to a live URL (ship it = deploy)."],
];

async function apiReq(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function deployHtml(file, title, description) {
  const html = await readFile(join(ROOT, file), "utf8");
  const { id } = await apiReq("POST", "/api/deploy", {
    title,
    description,
    type: "html",
    files: [{ path: "index.html", content: html, encoding: "utf8" }],
  });
  return id;
}

async function cleanupPrevious() {
  let stale = [];
  try {
    const { deploys } = await apiReq("GET", "/api/list");
    stale = (deploys || []).filter((d) => String(d?.title || "").startsWith(TITLE_PREFIX)).map((d) => d.id);
  } catch {
    return; // first run / list unavailable — nothing to clean
  }
  for (const id of stale) {
    try {
      await apiReq("DELETE", `/api/deploy/${id}`);
    } catch {
      /* best effort */
    }
  }
  if (stale.length) process.stdout.write(`cleaned ${stale.length} previous demo deploy(s)\n`);
}

async function main() {
  if (!TOKEN) throw new Error("set GETONUP_TOKEN (and GETONUP_URL) — the demo deploys to your getonup server");

  process.stdout.write(`Publishing demo to ${BASE} …\n`);
  await cleanupPrevious();

  const all = [...SYSTEMS, ...ORIGINALS];
  for (const [key, name, desc] of all) {
    const id = await deployHtml(`landings/${key}.html`, `${TITLE_PREFIX}${name}`, desc);
    process.stdout.write(`  ${name.padEnd(18)} → /s/${id}\n`);
  }

  process.stdout.write(`\n✓ ${all.length} demos published · homepage (live index): ${BASE}/\n`);
}

main().catch((e) => {
  process.stderr.write(`publish-demo failed: ${e.message}\n`);
  process.exit(1);
});

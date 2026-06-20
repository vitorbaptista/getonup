#!/usr/bin/env node
/**
 * Rebuild the getonup demo: deploy every landing design + a gallery that links to them, and set
 * the gallery as the server homepage.
 *
 * Re-runnable: each run first deletes the previous run's demo deploys (those titled "getonup — …")
 * so they don't accumulate, then publishes fresh. Deploy IDs are assigned by the server per run,
 * so the /s/<id> URLs change each time — the stable entry point is the homepage (`/`).
 *
 *   GETONUP_URL=http://localhost:8787 GETONUP_TOKEN=… node scripts/publish-demo.mjs
 *   (or: npm run demo, after `npm run dev` is up)
 */
import { readFile, writeFile, readdir, mkdir, copyFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.GETONUP_URL || "http://localhost:8787").replace(/\/+$/, "");
const TOKEN = process.env.GETONUP_TOKEN || "";
const TITLE_PREFIX = "getonup — ";

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

const text = new Set(["html", "css", "js", "json", "svg", "txt", "map"]);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function apiReq(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function deployHtml(file, title) {
  const html = await readFile(join(ROOT, file), "utf8");
  const { id } = await apiReq("POST", "/api/deploy", { title, type: "html", files: [{ path: "index.html", content: html, encoding: "utf8" }] });
  return id;
}

async function deployFolder(dir, title) {
  const files = [];
  const abs = join(ROOT, dir);
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue; // skip .DS_Store, swap files, etc.
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const rel = full.slice(abs.length + 1).split("\\").join("/");
        const isText = text.has(extname(rel).slice(1).toLowerCase());
        const buf = await readFile(full);
        files.push({ path: rel, content: isText ? buf.toString("utf8") : buf.toString("base64"), encoding: isText ? "utf8" : "base64" });
      }
    }
  }
  await walk(abs);
  const { id } = await apiReq("POST", "/api/deploy", { title, type: "static", files });
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

const card = ([key, name, desc], id) =>
  `        <a class="card" href="/s/${id}"><div class="thumb"><img src="./thumbs/${key}.png" alt="${esc(name)}" loading="lazy"/></div><div class="meta"><h3>${esc(name)}</h3><p>${esc(desc)}</p><span class="view">View live →</span></div></a>`;

function gallery(sysCards, origCards) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>getonup — landing designs</title>
    <meta name="description" content="Landing-page directions for getonup — built in real shadcn.io DESIGN.md systems plus house originals — each deployed through getonup itself." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <style>
      :root { --bg:#0b0d10; --panel:rgba(255,255,255,.025); --ink:#e7e9ee; --muted:#9aa0ab; --line:#232830; --violet:#7c5cff; --cyan:#22d3ee; }
      * { box-sizing: border-box; }
      body { margin:0; background:var(--bg); color:var(--ink); line-height:1.55; font-family:"Plus Jakarta Sans",system-ui,sans-serif; -webkit-font-smoothing:antialiased;
        background-image: radial-gradient(900px 480px at 85% -8%, rgba(124,92,255,.16), transparent 60%), radial-gradient(760px 420px at -5% 4%, rgba(34,211,238,.10), transparent 55%); min-height:100vh; }
      .wrap { max-width:1200px; margin:0 auto; padding:64px 24px 96px; }
      .mono { font-family:"JetBrains Mono",ui-monospace,monospace; }
      .badge { display:inline-flex; align-items:center; gap:8px; padding:6px 13px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--muted); font-size:13px; }
      .badge .dot { width:7px; height:7px; border-radius:50%; background:var(--cyan); box-shadow:0 0 10px var(--cyan); }
      h1 { font-size:clamp(30px,5vw,52px); letter-spacing:-.03em; margin:20px 0 12px; font-weight:800; }
      h1 .grad { background:linear-gradient(100deg,var(--violet),#b39bff 45%,var(--cyan)); -webkit-background-clip:text; background-clip:text; color:transparent; }
      .lede { color:var(--muted); max-width:70ch; font-size:clamp(15px,2vw,18px); }
      .lede code { background:#1a1e24; border:1px solid var(--line); border-radius:6px; padding:1px 6px; font-size:.9em; color:#cfd3da; }
      .sec-label { margin:54px 0 18px; display:flex; align-items:baseline; gap:12px; }
      .sec-label h2 { font-size:15px; font-weight:700; letter-spacing:.02em; margin:0; }
      .sec-label span { color:var(--muted); font-size:13px; }
      .sec-label .rule { flex:1; height:1px; background:var(--line); }
      .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:20px; }
      .card { display:flex; flex-direction:column; text-decoration:none; color:inherit; border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--panel); transition:transform .18s ease,border-color .2s ease,box-shadow .25s ease; }
      .card:hover { transform:translateY(-4px); border-color:rgba(124,92,255,.5); box-shadow:0 24px 60px -28px rgba(124,92,255,.5); }
      .thumb { height:210px; overflow:hidden; border-bottom:1px solid var(--line); background:#0e1116; }
      .thumb img { width:100%; display:block; object-fit:cover; object-position:top; }
      .meta { padding:15px 17px 17px; }
      .meta h3 { margin:0 0 5px; font-size:16px; font-weight:700; }
      .meta p { margin:0 0 11px; color:var(--muted); font-size:13.5px; }
      .view { color:var(--cyan); font-size:13.5px; font-weight:600; }
      footer { margin-top:60px; color:var(--muted); font-size:13px; border-top:1px solid var(--line); padding-top:22px; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <span class="badge"><span class="dot"></span> deployed through getonup itself</span>
      <h1>Pick a look for <span class="grad">getonup</span>.</h1>
      <p class="lede">Landing-page directions, each a complete self-contained page deployed with <code>getonup deploy</code>. Ten are built in real <a href="https://www.shadcn.io/design" style="color:var(--cyan);text-decoration:none">shadcn.io DESIGN.md</a> systems; ten are originals. Click any to see it live.</p>
      <div class="sec-label"><h2>Design systems</h2><span>shadcn.io DESIGN.md</span><span class="rule"></span></div>
      <div class="grid">
${sysCards}
      </div>
      <div class="sec-label"><h2>Originals</h2><span>house concepts</span><span class="rule"></span></div>
      <div class="grid">
${origCards}
      </div>
      <footer>getonup · MIT · self-hosted · scale-to-zero — pages live in <span class="mono">landings/</span>, regenerate with <span class="mono">npm run demo</span>.</footer>
    </main>
  </body>
</html>
`;
}

async function main() {
  if (!TOKEN) throw new Error("set GETONUP_TOKEN (and GETONUP_URL) — the demo deploys to your getonup server");

  // Fail loudly if any thumbnail is missing rather than publishing a gallery with broken tiles.
  const missing = [];
  for (const [key] of [...SYSTEMS, ...ORIGINALS]) {
    try {
      await stat(join(ROOT, "gallery/thumbs", `${key}.png`));
    } catch {
      missing.push(`${key}.png`);
    }
  }
  if (missing.length) throw new Error(`missing gallery/thumbs: ${missing.join(", ")}`);

  process.stdout.write(`Publishing demo to ${BASE} …\n`);
  await cleanupPrevious();

  const ids = {};
  for (const d of [...SYSTEMS, ...ORIGINALS]) {
    ids[d[0]] = await deployHtml(`landings/${d[0]}.html`, `${TITLE_PREFIX}${d[1]}`);
    process.stdout.write(`  ${d[1].padEnd(16)} → /s/${ids[d[0]]}\n`);
  }

  const html = gallery(
    SYSTEMS.map((d) => card(d, ids[d[0]])).join("\n"),
    ORIGINALS.map((d) => card(d, ids[d[0]])).join("\n"),
  );
  await writeFile(join(ROOT, "gallery/index.html"), html, "utf8");

  // Deploy the gallery folder BEFORE writing server/public/ — `wrangler dev` watches the assets
  // dir, so writing it mid-run reloads the worker and 503s any in-flight deploy.
  const galleryId = await deployFolder("gallery", `${TITLE_PREFIX}Gallery`);

  // Set the homepage = the gallery, mirroring thumbs exactly (clear first so removed designs
  // don't leave stale PNGs behind). This write may reload a running `wrangler dev`.
  await writeFile(join(ROOT, "server/public/index.html"), html, "utf8");
  await rm(join(ROOT, "server/public/thumbs"), { recursive: true, force: true });
  await mkdir(join(ROOT, "server/public/thumbs"), { recursive: true });
  for (const f of await readdir(join(ROOT, "gallery/thumbs"))) {
    await copyFile(join(ROOT, "gallery/thumbs", f), join(ROOT, "server/public/thumbs", f));
  }

  process.stdout.write(`\n✓ Gallery (homepage): ${BASE}/  ·  ${BASE}/s/${galleryId}\n`);
}

main().catch((e) => {
  process.stderr.write(`publish-demo failed: ${e.message}\n`);
  process.exit(1);
});

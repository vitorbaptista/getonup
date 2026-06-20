/**
 * getonup auto-wrap engine (runs in the CLI).
 *
 * Turns a single artifact file into a self-contained, runnable HTML document:
 *   - full HTML      -> served as-is
 *   - HTML fragment  -> wrapped in a minimal styled shell
 *   - React/JSX/TSX  -> React 18 + @babel/standalone + esm.sh import maps + Tailwind
 *   - Vue SFC        -> Vue 3 + vue3-sfc-loader
 *   - plain JS        -> module shell with an esm.sh import map
 *
 * The server never sees this logic — it just stores and serves the resulting bytes.
 */

import { parse } from "@babel/parser";
import { marked } from "marked";

export type ArtifactType = "html" | "react" | "vue" | "js" | "markdown" | "static";

export interface WrapOptions {
  title?: string;
  tailwind?: boolean; // include Tailwind Play CDN for wrapped pages (default true)
}

const REACT_VERSION = "18";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function looksReact(c: string): boolean {
  return (
    /from\s+['"]react['"]/.test(c) ||
    /\bexport\s+default\s+(function|class|\(|[A-Za-z_$])/.test(c) ||
    /<[A-Za-z][^>]*\/>/.test(c) ||
    /return\s*\(\s*</.test(c) ||
    /\b(useState|useEffect|useRef|useMemo|createRoot|ReactDOM)\b/.test(c)
  );
}

function looksMarkdown(c: string): boolean {
  return /^#{1,6}\s+\S/m.test(c) || /^```/m.test(c);
}

export function detectType(filename: string, content: string): ArtifactType {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "vue") return "vue";
  if (ext === "jsx" || ext === "tsx") return "react";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "js" || ext === "mjs" || ext === "ts") {
    return looksReact(content) ? "react" : "js";
  }
  // Unknown / no extension / stdin: sniff the content.
  const c = content;
  if (/<template[\s>]/.test(c) || /<script\s+setup/.test(c)) return "vue";
  if (/<!doctype\s+html/i.test(c) || /<html[\s>]/i.test(c)) return "html";
  if (looksReact(c)) return "react";
  if (/<[a-z][\s\S]*?>[\s\S]*<\/[a-z]+>/i.test(c)) return "html"; // looks like HTML markup
  // Conservative markdown sniff (ATX heading or fenced code block) so piped markdown
  // (`cat doc.md | getonup serve -`) doesn't fall through to the JS branch and break.
  if (looksMarkdown(c)) return "markdown";
  return "js";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Safe to embed inside <script type="text/babel"> / <script type="module"> */
function escapeScriptText(code: string): string {
  return code.replace(/<\/script>/gi, "<\\/script>");
}

/** Safe to embed as a JS string literal inside a classic <script> (escapes < to <). */
function jsStringLiteral(s: string): string {
  return JSON.stringify(s).replace(/</g, "\\u003c");
}

function isFullHtml(c: string): boolean {
  return /<!doctype\s+html/i.test(c) || /<html[\s>]/i.test(c);
}

function esmUrl(spec: string): string {
  if (spec === "react") return `https://esm.sh/react@${REACT_VERSION}`;
  if (spec === "react-dom") return `https://esm.sh/react-dom@${REACT_VERSION}`;
  if (spec.startsWith("react-dom/")) return `https://esm.sh/react-dom@${REACT_VERSION}/${spec.slice("react-dom/".length)}`;
  if (spec.startsWith("react/")) return `https://esm.sh/react@${REACT_VERSION}/${spec.slice("react/".length)}`;
  // Other packages: pin the React peer so we never load two copies of React.
  return `https://esm.sh/${spec}?external=react,react-dom`;
}

// Heuristic: regex-scan import/export specifiers. May also catch matches inside strings or
// comments — harmless (an unused import-map entry), so we keep it simple rather than parse.
function scanBareSpecifiers(code: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /import\s+[\s\S]*?\s+from\s*['"]([^'"]+)['"]/g, // import X from "pkg"
    /import\s*['"]([^'"]+)['"]/g, // import "pkg"
    /from\s*['"]([^'"]+)['"]/g, // export ... from "pkg"
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const s = m[1];
      if (s && !s.startsWith(".") && !s.startsWith("/") && !s.startsWith("http")) specs.add(s);
    }
  }
  return [...specs];
}

function buildImportMap(code: string): string {
  const map: Record<string, string> = {
    react: esmUrl("react"),
    "react-dom": esmUrl("react-dom"),
    "react-dom/client": esmUrl("react-dom/client"),
    "react/jsx-runtime": esmUrl("react/jsx-runtime"),
    "react/jsx-dev-runtime": esmUrl("react/jsx-dev-runtime"),
  };
  for (const spec of scanBareSpecifiers(code)) {
    if (!map[spec]) map[spec] = esmUrl(spec);
  }
  return JSON.stringify({ imports: map }, null, 2);
}

// Shared bits ----------------------------------------------------------------

const BASE_STYLE = `*{box-sizing:border-box}html,body{margin:0}body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}#root,#app{min-height:100vh}`;

const OVERLAY_STYLE = `#__getonup_err{position:fixed;inset:auto 0 0 0;max-height:50vh;overflow:auto;margin:0;padding:16px 20px;background:#1b0f12;color:#ffb4b4;border-top:2px solid #ff5d5d;font:500 13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:2147483647}#__getonup_err b{color:#ff8d8d}`;

const OVERLAY_SCRIPT =
  `(function(){function show(msg){var el=document.getElementById('__getonup_err');` +
  `if(!el){el=document.createElement('pre');el.id='__getonup_err';document.body.appendChild(el);}` +
  `el.innerHTML='<b>Runtime error</b>\\n'+String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;');}` +
  `window.__getonupError=show;` +
  `window.addEventListener('error',function(e){show((e.error&&e.error.stack)||e.message||e);});` +
  `window.addEventListener('unhandledrejection',function(e){show((e.reason&&e.reason.stack)||e.reason||e);});})();`;

function tailwindTag(opts: WrapOptions): string {
  return opts.tailwind === false ? "" : `<script src="https://cdn.tailwindcss.com"></script>`;
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

/** Prepare a React/JSX/TSX artifact for in-browser Babel: capture the real top-level default
 *  export into a global we can mount, and inject `import React` when the source doesn't already
 *  import it. Both decisions use a parser (typescript+jsx) — never text scanning — so
 *  `export default` / `import React` text inside strings, comments, templates or JSX is ignored.
 *  Handles `export default <expr|decl>` (parenthesized included) and the local aggregate
 *  `export { X as default }` (siblings preserved); leaves re-exports (`… from "x"`) untouched. */
function transformReact(code: string): string {
  let body: any[] | null = null;
  try {
    body = (parse(code, { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: true }) as any).program.body;
  } catch {
    body = null;
  }
  if (!body) {
    // Unparseable: leave the source for the in-browser Babel to report; best-effort React inject.
    const has = /(^|[\n;])\s*import\s+(\*\s+as\s+)?React[\s,]/.test(code);
    return (has ? "" : `import React from "react";\n`) + code;
  }

  let importsReact = false;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const node of body) {
    if (node.type === "ImportDeclaration" && node.source.value === "react" && node.importKind !== "type") {
      // A type-only import (`import type * as React`) is erased by Babel — it does NOT provide a
      // runtime React, so it must not suppress the injected import for classic-runtime JSX.
      if (node.specifiers.some((s: any) => (s.type === "ImportDefaultSpecifier" || s.type === "ImportNamespaceSpecifier") && s.importKind !== "type")) importsReact = true;
    } else if (node.type === "ExportDefaultDeclaration") {
      // Replace the whole statement and slice the declaration by its own (balanced) span, so a
      // parenthesized expression like `export default (() => <i/>)` leaves no stray `)`.
      const d = node.declaration;
      edits.push({ start: node.start, end: node.end, text: `window.__getonup_default = ${code.slice(d.start, d.end)};` });
    } else if (node.type === "ExportNamedDeclaration" && !node.source) {
      const def = node.specifiers.find((s: any) => s.type === "ExportSpecifier" && s.exported.name === "default");
      if (!def) continue;
      const rest = node.specifiers
        .filter((s: any) => s !== def && s.type === "ExportSpecifier")
        .map((s: any) => (s.local.name === s.exported.name ? s.local.name : `${s.local.name} as ${s.exported.name}`));
      edits.push({ start: node.start, end: node.end, text: `window.__getonup_default = ${def.local.name};` + (rest.length ? ` export { ${rest.join(", ")} };` : "") });
    }
  }
  edits.sort((a, b) => b.start - a.start); // apply right-to-left so offsets stay valid
  for (const e of edits) code = code.slice(0, e.start) + e.text + code.slice(e.end);
  return (importsReact ? "" : `import React from "react";\n`) + code;
}

function wrapReact(code: string, opts: WrapOptions): string {
  const title = opts.title || "getonup artifact";
  const importMap = buildImportMap(code);
  const userModule = escapeScriptText(transformReact(code));
  const mount =
    `\nimport { createRoot } from "react-dom/client";\n` +
    `const __el = document.getElementById("root");\n` +
    `const __C = window.__getonup_default;\n` +
    `if (typeof __C === "undefined") { __el.innerHTML = '<pre id="__getonup_err"><b>No default export</b>\\nExport your component: export default function App() { ... }</pre>'; }\n` +
    `else { try { createRoot(__el).render(React.createElement(__C)); } catch (e) { window.__getonupError(e); } }\n`;

  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    tailwindTag(opts),
    `<script type="importmap">${importMap}</script>`,
    `<style>${BASE_STYLE}${OVERLAY_STYLE}</style>`,
    "</head><body>",
    '<div id="root"></div>',
    `<script>${OVERLAY_SCRIPT}</script>`,
    `<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>`,
    `<script type="text/babel" data-type="module" data-presets="react,typescript">`,
    userModule,
    mount,
    "</script>",
    "</body></html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Vue (single-file component)
// ---------------------------------------------------------------------------

function wrapVue(code: string, opts: WrapOptions): string {
  const title = opts.title || "getonup artifact";
  const src = jsStringLiteral(code);
  const loader =
    `const { loadModule } = window['vue3-sfc-loader'];\n` +
    `const options = { moduleCache: { vue: Vue }, getFile: () => ${src}, addStyle: (t) => { const s=document.createElement('style'); s.textContent=t; document.head.appendChild(s); }, log: (...a)=>console.log(...a) };\n` +
    `try { const app = Vue.createApp(Vue.defineAsyncComponent(() => loadModule('component.vue', options))); app.config.errorHandler = (e)=>window.__getonupError(e); app.mount('#app'); }\n` +
    `catch (e) { window.__getonupError(e); }`;

  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    tailwindTag(opts),
    `<style>${BASE_STYLE}${OVERLAY_STYLE}</style>`,
    "</head><body>",
    '<div id="app"></div>',
    `<script>${OVERLAY_SCRIPT}</script>`,
    `<script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js"></script>`,
    `<script src="https://cdn.jsdelivr.net/npm/vue3-sfc-loader@0.9/dist/vue3-sfc-loader.js"></script>`,
    `<script>${loader}</script>`,
    "</body></html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Plain JS
// ---------------------------------------------------------------------------

function wrapJs(code: string, opts: WrapOptions): string {
  const title = opts.title || "getonup artifact";
  const specs = scanBareSpecifiers(code);
  const importMap = specs.length ? `<script type="importmap">${buildImportMap(code)}</script>` : "";
  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    tailwindTag(opts),
    importMap,
    `<style>${BASE_STYLE}${OVERLAY_STYLE}</style>`,
    "</head><body>",
    '<div id="app"></div>',
    `<script>${OVERLAY_SCRIPT}</script>`,
    // Transpile via Babel (typescript preset) so plain `.ts` runs in the browser; valid `.js`
    // passes through unchanged. Bare imports still resolve through the import map above.
    `<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>`,
    `<script type="text/babel" data-type="module" data-presets="typescript">`,
    escapeScriptText(code),
    "</script>",
    "</body></html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const PROSE_STYLE =
  `body{background:#fff;color:#1f2328}` +
  `.prose{max-width:46rem;margin:0 auto;padding:3rem 1.25rem 5rem;line-height:1.65;font-size:16px}` +
  `.prose h1,.prose h2,.prose h3,.prose h4{line-height:1.25;font-weight:600;margin:2em 0 .6em}` +
  `.prose h1{font-size:2rem;margin-top:0}.prose h2{font-size:1.5rem;border-bottom:1px solid #e1e4e8;padding-bottom:.3em}` +
  `.prose h3{font-size:1.25rem}.prose p{margin:0 0 1em}` +
  `.prose a{color:#0969da;text-decoration:none}.prose a:hover{text-decoration:underline}` +
  `.prose code{background:#eff1f3;border-radius:6px;padding:.2em .4em;font-size:.875em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}` +
  `.prose pre{background:#f6f8fa;border-radius:8px;padding:1rem;overflow:auto;line-height:1.45}` +
  `.prose pre code{background:none;padding:0;font-size:.875em}` +
  `.prose blockquote{margin:0 0 1em;padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}` +
  `.prose ul,.prose ol{margin:0 0 1em;padding-left:2em}.prose li{margin:.25em 0}` +
  `.prose table{border-collapse:collapse;margin:0 0 1em;display:block;overflow:auto}` +
  `.prose th,.prose td{border:1px solid #d1d9e0;padding:.5em .9em}.prose th{background:#f6f8fa}` +
  `.prose img{max-width:100%}.prose hr{border:0;border-top:1px solid #e1e4e8;margin:2em 0}` +
  `@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}` +
  `.prose h2{border-bottom-color:#30363d}.prose a{color:#4493f8}.prose code{background:#262c36}` +
  `.prose pre{background:#161b22}.prose blockquote{color:#9198a1;border-left-color:#3d444d}` +
  `.prose th,.prose td{border-color:#3d444d}.prose th{background:#161b22}.prose hr{border-top-color:#30363d}}`;

/** Strip a leading YAML frontmatter fence (`---\n…\n---`) — common in agent/memory files,
 *  which marked would otherwise render as a stray <hr> plus loose text. */
function stripFrontmatter(c: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(c);
  return m ? c.slice(m[0].length) : c;
}

function firstHeading(c: string): string | undefined {
  const m = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(c);
  return m ? m[1].trim() : undefined;
}

function wrapMarkdown(code: string, opts: WrapOptions): string {
  const src = stripFrontmatter(code);
  const title = firstHeading(src) || opts.title || "getonup artifact";
  const html = marked.parse(src, { gfm: true, async: false }) as string;
  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${BASE_STYLE}${PROSE_STYLE}</style>`,
    "</head><body>",
    `<main class="prose">`,
    html,
    "</main>",
    "</body></html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function wrapHtml(code: string, opts: WrapOptions): string {
  if (isFullHtml(code)) return code; // serve as-is
  const title = opts.title || "getonup artifact";
  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    tailwindTag(opts),
    `<style>${BASE_STYLE}</style>`,
    "</head><body>",
    code,
    "</body></html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/** Wrap a single artifact's source into a full HTML document. */
export function wrapToHtml(code: string, type: ArtifactType, opts: WrapOptions = {}): string {
  switch (type) {
    case "react":
      return wrapReact(code, opts);
    case "vue":
      return wrapVue(code, opts);
    case "js":
      return wrapJs(code, opts);
    case "markdown":
      return wrapMarkdown(code, opts);
    case "html":
      return wrapHtml(code, opts);
    default:
      return wrapHtml(code, opts);
  }
}

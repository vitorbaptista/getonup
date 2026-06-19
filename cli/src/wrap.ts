/**
 * Conjure auto-wrap engine (runs in the CLI).
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

export type ArtifactType = "html" | "react" | "vue" | "js" | "static";

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

export function detectType(filename: string, content: string): ArtifactType {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "vue") return "vue";
  if (ext === "jsx" || ext === "tsx") return "react";
  if (ext === "js" || ext === "mjs" || ext === "ts") {
    return looksReact(content) ? "react" : "js";
  }
  // Unknown / no extension / stdin: sniff the content.
  const c = content;
  if (/<template[\s>]/.test(c) || /<script\s+setup/.test(c)) return "vue";
  if (/<!doctype\s+html/i.test(c) || /<html[\s>]/i.test(c)) return "html";
  if (looksReact(c)) return "react";
  if (/<[a-z][\s\S]*?>[\s\S]*<\/[a-z]+>/i.test(c)) return "html"; // looks like HTML markup
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

const OVERLAY_STYLE = `#__conjure_err{position:fixed;inset:auto 0 0 0;max-height:50vh;overflow:auto;margin:0;padding:16px 20px;background:#1b0f12;color:#ffb4b4;border-top:2px solid #ff5d5d;font:500 13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;z-index:2147483647}#__conjure_err b{color:#ff8d8d}`;

const OVERLAY_SCRIPT =
  `(function(){function show(msg){var el=document.getElementById('__conjure_err');` +
  `if(!el){el=document.createElement('pre');el.id='__conjure_err';document.body.appendChild(el);}` +
  `el.innerHTML='<b>Runtime error</b>\\n'+String(msg).replace(/&/g,'&amp;').replace(/</g,'&lt;');}` +
  `window.__conjureError=show;` +
  `window.addEventListener('error',function(e){show((e.error&&e.error.stack)||e.message||e);});` +
  `window.addEventListener('unhandledrejection',function(e){show((e.reason&&e.reason.stack)||e.reason||e);});})();`;

function tailwindTag(opts: WrapOptions): string {
  return opts.tailwind === false ? "" : `<script src="https://cdn.tailwindcss.com"></script>`;
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

function transformReact(code: string): string {
  let out = code;
  const hasReactDefaultImport = /import\s+React(\s|,)/.test(out);
  // Capture the default export into a global we can mount — both `export default X` and the local
  // aggregate `export { X as default }`. Anchored to a statement boundary (start of source, or
  // after a newline / `;` / `}`) so it also catches same-line statements like
  // `import React from "react"; export default App` while NOT matching "export default" text inside
  // a string/JSX. Re-exports (`... from "x"`) are left untouched; sibling named exports are kept.
  out = out.replace(/(^|[\n;}])([ \t]*)export\s+default\s+/, "$1$2window.__conjure_default = ");
  out = out.replace(/(^|[\n;}])([ \t]*)export\s*\{([^}]*)\}\s*(from\s*['"][^'"]+['"])?\s*;?/g, (full, b, ws, inner, fromClause) => {
    if (fromClause) return full; // re-export: leave as-is
    const names = String(inner).split(",").map((s) => s.trim()).filter(Boolean);
    const def = names.find((n) => /\sas\s+default$/.test(n));
    if (!def) return full;
    const local = def.replace(/\s+as\s+default$/, "").trim();
    const rest = names.filter((n) => n !== def);
    return `${b}${ws}window.__conjure_default = ${local};` + (rest.length ? ` export { ${rest.join(", ")} };` : "");
  });
  const prelude = hasReactDefaultImport ? "" : `import React from "react";\n`;
  return prelude + out;
}

function wrapReact(code: string, opts: WrapOptions): string {
  const title = opts.title || "Conjure artifact";
  const importMap = buildImportMap(code);
  const userModule = escapeScriptText(transformReact(code));
  const mount =
    `\nimport { createRoot } from "react-dom/client";\n` +
    `const __el = document.getElementById("root");\n` +
    `const __C = window.__conjure_default;\n` +
    `if (typeof __C === "undefined") { __el.innerHTML = '<pre id="__conjure_err"><b>No default export</b>\\nExport your component: export default function App() { ... }</pre>'; }\n` +
    `else { try { createRoot(__el).render(React.createElement(__C)); } catch (e) { window.__conjureError(e); } }\n`;

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
  const title = opts.title || "Conjure artifact";
  const src = jsStringLiteral(code);
  const loader =
    `const { loadModule } = window['vue3-sfc-loader'];\n` +
    `const options = { moduleCache: { vue: Vue }, getFile: () => ${src}, addStyle: (t) => { const s=document.createElement('style'); s.textContent=t; document.head.appendChild(s); }, log: (...a)=>console.log(...a) };\n` +
    `try { const app = Vue.createApp(Vue.defineAsyncComponent(() => loadModule('component.vue', options))); app.config.errorHandler = (e)=>window.__conjureError(e); app.mount('#app'); }\n` +
    `catch (e) { window.__conjureError(e); }`;

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
  const title = opts.title || "Conjure artifact";
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
// HTML
// ---------------------------------------------------------------------------

function wrapHtml(code: string, opts: WrapOptions): string {
  if (isFullHtml(code)) return code; // serve as-is
  const title = opts.title || "Conjure artifact";
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
    case "html":
      return wrapHtml(code, opts);
    default:
      return wrapHtml(code, opts);
  }
}

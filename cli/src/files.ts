import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep, extname } from "node:path";
import type { DeployFile } from "./api.js";

// Extensions safe to send as utf8 in the deploy payload; everything else goes base64.
const TEXT_EXTS = new Set([
  "html", "htm", "css", "js", "mjs", "cjs", "json", "map", "svg", "txt", "md",
  "xml", "csv", "ts", "tsx", "jsx", "vue", "webmanifest", "yml", "yaml",
]);

/** Encode one file for the deploy payload: text types as utf8, everything else base64. */
export function fileToDeploy(relPath: string, buf: Buffer): DeployFile {
  const ext = extname(relPath).slice(1).toLowerCase();
  if (TEXT_EXTS.has(ext)) {
    return { path: relPath, content: buf.toString("utf8"), encoding: "utf8" };
  }
  return { path: relPath, content: buf.toString("base64"), encoding: "base64" };
}

const isHtmlPath = (p: string): boolean => {
  const e = extname(p).slice(1).toLowerCase();
  return e === "html" || e === "htm";
};

/** Normalize a user-supplied --index-file value to a forward-slash, folder-relative path. Leading
 *  `./` and `/` are stripped; internal separators are kept (subdirectories are allowed) and `..`
 *  is left intact so an escaping path simply fails the in-folder membership check below. */
function normIndex(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
}

/**
 * Decide which file in a folder becomes the served `index.html`.
 *
 * Order: an explicit `--index-file <file>` is authoritative (it names the homepage, overriding any
 * existing index.html); otherwise a root `index.html`; otherwise the sole root-level `.html`/`.htm`
 * file. `--index-file` may point anywhere inside the folder (including a subdirectory) and must
 * resolve to a file that the folder actually contains — anything else (a path that escapes via
 * `..`, an absolute path, or a non-existent file) fails. Auto-promotion of a sole HTML file stays
 * root-level only, since copying a subdirectory page to the root would break its relative links.
 *
 * Returns the chosen source path (forward-slash, folder-relative); the caller copies that file's
 * bytes into a root `index.html` (see {@link promoteIndex}). Returns null when the folder has no
 * root-level HTML at all — the caller keeps its existing "needs index.html" behavior. Throws on an
 * ambiguous folder (multiple root HTML, no `--index-file`) or a bad/out-of-folder `--index-file`.
 */
export function resolveIndex(paths: string[], indexFile?: string): string | null {
  const want = indexFile ? normIndex(indexFile) : "";

  if (want) {
    if (!isHtmlPath(want)) throw new Error(`--index-file must name an .html or .htm file: ${indexFile}`);
    // Membership in the walked file set is the containment check: walkDir only ever yields clean
    // descendant paths, so a `..`/absolute value can never match — it fails here.
    if (!paths.includes(want)) {
      const html = paths.filter(isHtmlPath);
      const avail = html.length ? ` (HTML files in the folder: ${[...html].sort().join(", ")})` : "";
      throw new Error(`--index-file is not inside the folder: ${indexFile}${avail}`);
    }
    return want;
  }

  if (paths.includes("index.html")) return "index.html";

  const rootHtml = paths.filter((p) => !p.includes("/") && isHtmlPath(p));
  if (rootHtml.length === 1) return rootHtml[0];
  if (rootHtml.length > 1) {
    throw new Error(
      `multiple HTML files at the folder root — pass --index-file <file> to pick the homepage (found: ${[...rootHtml].sort().join(", ")})`,
    );
  }
  return null;
}

/** Copy the chosen entry's bytes into a root `index.html` (the original file is kept). No-op when
 *  `entry` is already "index.html". Overwrites an existing index.html in place rather than adding a
 *  duplicate path (defensive — resolveIndex never returns a non-index entry when one exists). */
export function promoteIndex(files: DeployFile[], entry: string): void {
  if (entry === "index.html") return;
  const src = files.find((f) => f.path === entry);
  if (!src) throw new Error(`internal: index source not found: ${entry}`);
  const existing = files.find((f) => f.path === "index.html");
  if (existing) {
    existing.content = src.content;
    existing.encoding = src.encoding;
  } else {
    files.push({ path: "index.html", content: src.content, encoding: src.encoding });
  }
}

/** Recursively collect a directory's files into `out`, skipping .git / node_modules / .DS_Store. */
export async function walkDir(dir: string, baseDir: string, out: DeployFile[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".DS_Store") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkDir(full, baseDir, out);
    else if (entry.isFile()) {
      const rel = relative(baseDir, full).split(sep).join("/");
      out.push(fileToDeploy(rel, await readFile(full)));
    }
  }
}

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

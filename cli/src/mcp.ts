/**
 * `getonup mcp` — run getonup as an MCP server over stdio.
 *
 * Lets any MCP-aware agent (Claude Code, Cursor, …) publish artifacts as tools, without
 * shelling out to the CLI. Hand-rolled minimal JSON-RPC 2.0 (newline-delimited) so the CLI
 * stays dependency-free. Tools: deploy_artifact, list_deploys, remove_deploy.
 *
 * Configure in an agent (env carries the server + token):
 *   { "mcpServers": { "getonup": { "command": "getonup", "args": ["mcp"],
 *       "env": { "GETONUP_URL": "https://…", "GETONUP_TOKEN": "…" } } } }
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep, extname, basename } from "node:path";
import { loadConfig } from "./config.js";
import * as api from "./api.js";
import { detectType, wrapToHtml, type ArtifactType } from "./wrap.js";
import { describeHtml } from "./describe.js";

const VERSION = "0.1.0";
const TEXT_EXTS = new Set([
  "html", "htm", "css", "js", "mjs", "cjs", "json", "map", "svg", "txt", "md",
  "xml", "csv", "ts", "tsx", "jsx", "vue", "webmanifest", "yml", "yaml",
]);

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

function send(msg: RpcMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function toolResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

// --- artifact collection (content | file | dir) ----------------------------

async function walkDir(dir: string, base: string, out: api.DeployFile[]): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === ".DS_Store") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkDir(full, base, out);
    else if (e.isFile()) {
      const rel = relative(base, full).split(sep).join("/");
      const buf = await readFile(full);
      const isText = TEXT_EXTS.has(extname(rel).slice(1).toLowerCase());
      out.push({ path: rel, content: isText ? buf.toString("utf8") : buf.toString("base64"), encoding: isText ? "utf8" : "base64" });
    }
  }
}

interface CollectArgs {
  content?: string;
  path?: string;
  type?: string;
  name?: string;
  no_wrap?: boolean;
}

async function collect(a: CollectArgs): Promise<{ files: api.DeployFile[]; type: string; title: string | null }> {
  const noWrap = a.no_wrap === true;
  if (a.path) {
    const s = await stat(a.path);
    if (s.isDirectory()) {
      const files: api.DeployFile[] = [];
      await walkDir(a.path, a.path, files);
      if (!files.some((f) => f.path === "index.html")) throw new Error("a folder must contain index.html at its root");
      return { files, type: "static", title: a.name || basename(a.path) };
    }
    const content = await readFile(a.path, "utf8");
    const type = (a.type as ArtifactType) || detectType(a.path, content);
    const title = a.name || basename(a.path).replace(/\.[^.]+$/, "");
    const html = noWrap ? content : wrapToHtml(content, type, { title });
    return { files: [{ path: "index.html", content: html, encoding: "utf8" }], type, title };
  }
  if (a.content != null) {
    const type = (a.type as ArtifactType) || detectType(a.name || "artifact", a.content);
    const html = noWrap ? a.content : wrapToHtml(a.content, type, { title: a.name || undefined });
    return { files: [{ path: "index.html", content: html, encoding: "utf8" }], type, title: a.name || null };
  }
  throw new Error("provide either `content` (the artifact source) or `path` (a file/dir on disk)");
}

// --- tools ------------------------------------------------------------------

const TOOLS = [
  {
    name: "deploy_artifact",
    description:
      "Publish a web artifact to a live, shareable URL on the configured getonup server. Pass `content` (the artifact source — HTML, a React/Vue/JS component) OR `path` (a file or built folder on disk). Single components are auto-wrapped (React 18/Babel/Tailwind, Vue 3). Returns the live URL.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Artifact source code (HTML / .jsx/.tsx / .vue / .js). Use this OR path." },
        path: { type: "string", description: "Path to a file or a built static folder (must contain index.html). Use this OR content." },
        type: { type: "string", enum: ["html", "react", "vue", "js", "static"], description: "Override auto-detection." },
        name: { type: "string", description: "A human title for the deploy." },
        no_wrap: { type: "boolean", description: "Host the source verbatim instead of auto-wrapping." },
      },
    },
  },
  {
    name: "list_deploys",
    description: "List artifacts published to the configured getonup server.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "remove_deploy",
    description: "Delete a published artifact by its id.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The deploy id (from its URL /s/<id>)." } }, required: ["id"] },
  },
];

async function callTool(name: string, args: any): Promise<{ content: { type: string; text: string }[]; isError: boolean }> {
  // All tools need a configured server.
  const { url, token } = await loadConfig();
  if (!url) {
    return toolResult(
      "getonup is not configured. Set GETONUP_URL (and GETONUP_TOKEN) in this MCP server's env, or run `getonup login` first.",
      true,
    );
  }

  if (name === "deploy_artifact") {
    const { files, type, title } = await collect(args || {});
    const entry = files.find((f) => f.path === "index.html");
    const description = entry && entry.encoding === "utf8" ? describeHtml(entry.content, title) : undefined;
    const r = await api.deploy(url, token, { title, type, files, description });
    return toolResult(`Deployed. Live URL: ${r.url}\nid: ${r.id} · files: ${r.files.length} · ${r.bytes} bytes`);
  }
  if (name === "list_deploys") {
    const { deploys } = await api.list(url, token);
    if (!deploys.length) return toolResult("No deploys yet.");
    return toolResult(
      deploys.map((d: any) => `${d.id}  ${d.type || "static"}  ${d.title || ""}  →  ${url.replace(/\/+$/, "")}/s/${d.id}`).join("\n"),
    );
  }
  if (name === "remove_deploy") {
    if (!args?.id) return toolResult("missing `id`", true);
    const r = await api.remove(url, token, String(args.id));
    return toolResult(`Removed ${args.id} (${r.files} file(s)).`);
  }
  return toolResult(`unknown tool: ${name}`, true);
}

// --- JSON-RPC stdio loop ----------------------------------------------------

/** Produce the JSON-RPC response for one request (null = notification, no reply). Testable. */
export async function respond(msg: RpcMessage): Promise<RpcMessage | null> {
  const { id, method, params } = msg;
  if (!method) return null; // a response/echo; ignore
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "getonup", version: VERSION },
      },
    };
  }
  if (method.startsWith("notifications/")) return null; // no reply to notifications
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    try {
      return { jsonrpc: "2.0", id, result: await callTool(params?.name, params?.arguments || {}) };
    } catch (e) {
      return { jsonrpc: "2.0", id, result: toolResult(`Error: ${(e as Error).message}`, true) };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
}

export async function runMcp(): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buf = "";
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // ignore non-JSON lines
      }
      respond(msg).then((r) => {
        if (r) send(r);
      });
    }
  });
  // Keep the process alive until stdin closes.
  await new Promise<void>((resolve) => process.stdin.on("end", resolve));
}

export interface DeployFile {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  contentType?: string;
}

export interface DeployBody {
  id?: string;
  title?: string | null;
  /** Auto-generated one-line summary (see cli/src/describe.ts); omitted when none was derived. */
  description?: string | null;
  type?: string;
  files: DeployFile[];
}

export interface DeployResult {
  id: string;
  url: string;
  files: string[];
  bytes: number;
}

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

/** Cloudflare Access service-token credentials, sent so a non-interactive client (CLI/agent/CI)
 *  gets past an Access-protected origin at the edge. See docs/SELF-HOSTING.md. */
export interface Access {
  clientId: string;
  clientSecret: string;
}

function base(url: string): string {
  return url.replace(/\/+$/, "");
}

function isCloudflareAccessHtml(text: string, responseUrl: string): boolean {
  const lower = `${responseUrl}\n${text.slice(0, 5000)}`.toLowerCase();
  return lower.includes("/cdn-cgi/access/") || lower.includes("cloudflare access") || lower.includes("cf-access");
}

function nonJsonError(url: string, path: string, res: Response, text: string): string {
  if (isCloudflareAccessHtml(text, res.url)) {
    return `Cloudflare Access blocked ${base(url)}${path}. Set GETONUP_ACCESS_CLIENT_ID and GETONUP_ACCESS_CLIENT_SECRET, or run \`getonup login --access-client-id <id> --access-client-secret <secret>\`.`;
  }

  const trimmed = text.trimStart();
  if (!trimmed || trimmed.startsWith("<")) return `HTTP ${res.status}`;
  return text.slice(0, 300);
}

async function call(
  url: string,
  token: string | undefined,
  path: string,
  init: RequestInit,
  access?: Access,
): Promise<any> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (access) {
    headers["cf-access-client-id"] = access.clientId;
    headers["cf-access-client-secret"] = access.clientSecret;
  }

  let res: Response;
  try {
    res = await fetch(base(url) + path, { ...init, headers });
  } catch (e) {
    const err: ApiError = new Error(`could not reach ${base(url)} (${(e as Error).message})`);
    throw err;
  }

  const text = await res.text();
  let data: any;
  let parsedJson = false;
  try {
    data = text ? JSON.parse(text) : {};
    parsedJson = true;
  } catch {
    // Non-JSON body (e.g. an HTML error page) — keep the message short, don't dump the page.
    data = { error: nonJsonError(url, path, res, text) };
  }
  if (res.ok && !parsedJson) {
    const err: ApiError = new Error(data.error);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (!res.ok) {
    const err: ApiError = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function deploy(url: string, token: string | undefined, body: DeployBody, access?: Access): Promise<DeployResult> {
  return call(url, token, "/api/deploy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, access);
}

export function list(url: string, token: string | undefined, access?: Access): Promise<{ deploys: any[] }> {
  return call(url, token, "/api/list", { method: "GET" }, access);
}

export function remove(url: string, token: string | undefined, id: string, access?: Access): Promise<any> {
  return call(url, token, `/api/deploy/${encodeURIComponent(id)}`, { method: "DELETE" }, access);
}

export function health(url: string, access?: Access): Promise<any> {
  return call(url, undefined, "/api/health", { method: "GET" }, access);
}

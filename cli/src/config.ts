import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import type { Access } from "./api.js";

export interface Config {
  url?: string;
  token?: string;
  // Optional Cloudflare Access service-token, for instances put behind Access (Zero Trust).
  accessClientId?: string;
  accessClientSecret?: string;
}

function configDir(): string {
  if (process.env.GETONUP_CONFIG_DIR) return process.env.GETONUP_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "getonup");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

/** File config, with GETONUP_URL / GETONUP_TOKEN env vars taking precedence. */
export async function loadConfig(): Promise<Config> {
  let fileCfg: Config = {};
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fileCfg = parsed as Config;
  } catch {
    /* no config file yet, or malformed — fall back to env/empty */
  }
  return {
    url: process.env.GETONUP_URL || fileCfg.url,
    token: process.env.GETONUP_TOKEN || fileCfg.token,
    accessClientId: process.env.GETONUP_ACCESS_CLIENT_ID || fileCfg.accessClientId,
    accessClientSecret: process.env.GETONUP_ACCESS_CLIENT_SECRET || fileCfg.accessClientSecret,
  };
}

/** Turn config into a Cloudflare Access service-token, or undefined if not configured.
 *  Both halves are required — a lone id or secret is a misconfiguration, so fail loudly. */
export function resolveAccess(cfg: Config): Access | undefined {
  const { accessClientId: clientId, accessClientSecret: clientSecret } = cfg;
  if (clientId && clientSecret) return { clientId, clientSecret };
  if (clientId || clientSecret) {
    throw new Error(
      "Cloudflare Access needs both GETONUP_ACCESS_CLIENT_ID and GETONUP_ACCESS_CLIENT_SECRET — only one is set.",
    );
  }
  return undefined;
}

export async function saveConfig(cfg: Config): Promise<string> {
  await mkdir(configDir(), { recursive: true });
  const p = configPath();
  await writeFile(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  try {
    await chmod(p, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
  return p;
}

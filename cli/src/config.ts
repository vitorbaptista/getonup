import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import type { Access } from "./api.js";

/** One server's credentials. */
export interface Profile {
  url?: string;
  token?: string;
  // Optional Cloudflare Access service-token, for instances put behind Access (Zero Trust).
  accessClientId?: string;
  accessClientSecret?: string;
}

// A resolved, ready-to-use config is just one profile. Kept as `Config` so callers that
// destructure `{ url, token, … }` stay unchanged through the move to multiple profiles.
export type Config = Profile;

/** The on-disk shape: a set of named profiles plus the name of the default one. */
export interface ConfigFile {
  default?: string;
  profiles: Record<string, Profile>;
}

const PROFILE_KEYS = ["url", "token", "accessClientId", "accessClientSecret"] as const;

function configDir(): string {
  if (process.env.GETONUP_CONFIG_DIR) return process.env.GETONUP_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "getonup");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

/** Read the on-disk config, normalising a legacy flat `{ url, token, … }` file into the
 *  profile shape (as a single profile named "default"). A missing/malformed/empty file
 *  yields an empty profile set. The flat→profiles migration is in-memory; it's persisted
 *  the next time a profile is written. */
export async function readConfigFile(): Promise<ConfigFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    return { profiles: {} }; // no config file yet, or malformed
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { profiles: {} };
  const obj = parsed as Record<string, unknown>;
  if (obj.profiles && typeof obj.profiles === "object" && !Array.isArray(obj.profiles)) {
    // Drop any corrupt (non-object) profile entry rather than crash later — `profiles` is the
    // command you'd run to diagnose a hand-broken config, so it must survive one.
    const profiles: Record<string, Profile> = {};
    for (const [k, v] of Object.entries(obj.profiles as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) profiles[k] = v as Profile;
    }
    return {
      // An empty-string default is "unset", not a profile named "".
      default: typeof obj.default === "string" && obj.default ? obj.default : undefined,
      profiles,
    };
  }
  // Legacy flat config → a single "default" profile.
  const flat: Profile = {};
  for (const k of PROFILE_KEYS) if (typeof obj[k] === "string") flat[k] = obj[k] as string;
  if (Object.keys(flat).length) return { default: "default", profiles: { default: flat } };
  return { profiles: {} };
}

async function writeConfigFile(file: ConfigFile): Promise<string> {
  await mkdir(configDir(), { recursive: true });
  const p = configPath();
  await writeFile(p, JSON.stringify(file, null, 2) + "\n", "utf8");
  try {
    await chmod(p, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
  return p;
}

/** Which profile name is active. Precedence: an explicit selector (CLI `--profile`) or
 *  `GETONUP_PROFILE` → the config's `default`. An explicit selector that names a profile
 *  that doesn't exist is an error, so a typo can't silently target a different server. A
 *  dangling `default` (pointing at a deleted profile) degrades to "no active profile" so
 *  recovery commands like `whoami`/`profiles` still work. */
function resolveName(file: ConfigFile, selector?: string): string | undefined {
  const explicit = (selector ?? process.env.GETONUP_PROFILE) || undefined;
  if (explicit) {
    if (file.profiles[explicit]) return explicit;
    const names = Object.keys(file.profiles);
    throw new Error(`unknown profile: "${explicit}". Configured: ${names.length ? names.join(", ") : "(none)"}`);
  }
  if (file.default && file.profiles[file.default]) return file.default;
  return undefined;
}

/** The active profile's name, or undefined when none resolves (env-only / unset). */
export async function activeProfileName(selector?: string): Promise<string | undefined> {
  return resolveName(await readConfigFile(), selector);
}

/** GETONUP_* env vars overlay the profile, per field, taking precedence (handy for CI and
 *  agents) — exactly as before profiles existed. */
function overlayEnv(p: Profile): Config {
  return {
    url: process.env.GETONUP_URL || p.url,
    token: process.env.GETONUP_TOKEN || p.token,
    accessClientId: process.env.GETONUP_ACCESS_CLIENT_ID || p.accessClientId,
    accessClientSecret: process.env.GETONUP_ACCESS_CLIENT_SECRET || p.accessClientSecret,
  };
}

/** The resolved config for the active profile, with GETONUP_* env vars overlaid.
 *  `selector` is the CLI `--profile` value (if any). */
export async function loadConfig(selector?: string): Promise<Config> {
  const file = await readConfigFile();
  const name = resolveName(file, selector);
  return overlayEnv(name ? file.profiles[name] : {});
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

/** Create or replace a named profile. The first profile ever saved becomes the default;
 *  pass `{ makeDefault: true }` to re-point the default at this one. Returns the file path. */
export async function saveProfile(
  name: string,
  profile: Profile,
  opts: { makeDefault?: boolean } = {},
): Promise<string> {
  const file = await readConfigFile();
  file.profiles[name] = profile;
  if (opts.makeDefault || !file.default) file.default = name;
  return writeConfigFile(file);
}

/** All configured profiles and which one is the default. */
export async function listProfiles(): Promise<{ profiles: Record<string, Profile>; default?: string }> {
  const { profiles, default: def } = await readConfigFile();
  return { profiles, default: def };
}

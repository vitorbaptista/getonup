import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import type { Access } from "./api.js";

/** One server's CLI configuration. The deployment `user` is not here — it's global,
 *  shared by every profile (see `ConfigFile`). */
export interface Profile {
  url?: string;
  token?: string;
  // Optional Cloudflare Access service-token, for instances put behind Access (Zero Trust).
  accessClientId?: string;
  accessClientSecret?: string;
}

/** A resolved, ready-to-use config: one profile plus the global user. */
export type Config = Profile & { user?: string };

/** The on-disk shape: a set of named profiles, the name of the default one, and the
 *  self-reported deployment user, which is a property of the person, not of a server. */
export interface ConfigFile {
  default?: string;
  user?: string;
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

/** What a value actually is, for an error message: "null", "an array", "a number", … */
function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  const t = typeof v;
  return t === "object" ? "an object" : `a ${t}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const ROOT_KEYS = ["default", "user", "profiles", ...PROFILE_KEYS] as const;

/** Every command reads the config, `login` included (saveProfile reads before it writes), so a
 *  broken file locks the CLI out entirely — every config error has to say how to get back in. */
const RECOVERY = "fix the file, or delete it and run `getonup login` again.";

/** Check the parsed JSON against the shape we expect, collecting every problem so a
 *  hand-edited file reports all its mistakes at once rather than one per run. */
function validate(parsed: unknown): string[] {
  const problems: string[] = [];
  if (!isPlainObject(parsed)) return [`expected an object, got ${describe(parsed)}`];

  const strings = (obj: Record<string, unknown>, keys: readonly string[], prefix: string) => {
    for (const k of keys) {
      if (obj[k] !== undefined && typeof obj[k] !== "string") {
        problems.push(`${prefix}${k}: expected a string, got ${describe(obj[k])}`);
      }
    }
  };

  // Type-check every key we understand wherever it appears — checking only the ones the
  // chosen branch happens to read lets a typo'd value through in the other shape.
  strings(parsed, ["default", "user", ...PROFILE_KEYS], "");

  // A file with nothing we can read from — no `profiles`, no legacy keys — but with keys we
  // don't recognise is almost certainly a misspelling (e.g. "profile"). Left alone it reads as
  // "nothing configured", quietly losing every profile in it. Unknown keys are fine otherwise,
  // so a config written by a newer CLI still works here.
  const usable = parsed.profiles !== undefined || PROFILE_KEYS.some((k) => parsed[k] !== undefined);
  const unknown = Object.keys(parsed).filter((k) => !(ROOT_KEYS as readonly string[]).includes(k));
  if (!usable && unknown.length) {
    problems.push(`nothing configured, and these keys aren't recognised: ${unknown.join(", ")} — did you mean "profiles"?`);
  }

  if (parsed.profiles !== undefined) {
    // Both shapes at once is ambiguous about which credentials win, so don't guess.
    const stray = PROFILE_KEYS.filter((k) => parsed[k] !== undefined);
    if (stray.length) {
      problems.push(`${stray.join(", ")}: legacy top-level key(s) alongside "profiles" — move them into a profile`);
    }
    if (!isPlainObject(parsed.profiles)) {
      problems.push(`profiles: expected an object, got ${describe(parsed.profiles)}`);
    } else {
      for (const [name, profile] of Object.entries(parsed.profiles)) {
        if (!isPlainObject(profile)) {
          problems.push(`profiles.${name}: expected an object, got ${describe(profile)}`);
        } else {
          strings(profile, PROFILE_KEYS, `profiles.${name}.`);
        }
      }
    }
  }
  return problems;
}

/** Read the on-disk config, normalising a legacy flat `{ url, token, user, … }` file into the
 *  profile shape (as a single profile named "default"). A missing file yields an empty profile
 *  set — getonup works fine with no config at all, driven purely by GETONUP_* env vars. Anything
 *  else that doesn't match the expected shape is an error: silently ignoring it would deploy to
 *  the wrong server, or to none, with no hint why. The flat→profiles migration is in-memory;
 *  it's persisted the next time a profile is written. */
export async function readConfigFile(): Promise<ConfigFile> {
  const path = configPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} }; // no config file yet
    throw new Error(`cannot read config at ${path}: ${(e as Error).message}`);
  }

  if (!raw.trim()) return { profiles: {} }; // an empty file reads as "nothing configured"

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid config at ${path}: not valid JSON (${(e as Error).message})\n${RECOVERY}`);
  }

  const problems = validate(parsed);
  if (problems.length) {
    throw new Error(`invalid config at ${path}:\n  ${problems.join("\n  ")}\n${RECOVERY}`);
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.profiles !== undefined) {
    return {
      // An empty-string default is "unset", not a profile named "".
      default: (obj.default as string | undefined) || undefined,
      user: (obj.user as string | undefined) || undefined,
      profiles: obj.profiles as Record<string, Profile>,
    };
  }
  // Legacy flat config → a single "default" profile.
  const flat: Profile = {};
  for (const k of PROFILE_KEYS) if (obj[k] !== undefined) flat[k] = obj[k] as string;
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
  // hasOwn, not a truthiness check: names like "constructor" or "toString" find something on
  // Object.prototype, which would make a typo resolve to an empty profile instead of erroring.
  const exists = (name: string) => Object.hasOwn(file.profiles, name);
  const explicit = (selector ?? process.env.GETONUP_PROFILE) || undefined;
  if (explicit) {
    if (exists(explicit)) return explicit;
    const names = Object.keys(file.profiles);
    throw new Error(`unknown profile: "${explicit}". Configured: ${names.length ? names.join(", ") : "(none)"}`);
  }
  if (file.default && exists(file.default)) return file.default;
  return undefined;
}

/** The active profile's name, or undefined when none resolves (env-only / unset). */
export async function activeProfileName(selector?: string): Promise<string | undefined> {
  return resolveName(await readConfigFile(), selector);
}

/** GETONUP_* env vars overlay the profile, per field, taking precedence (handy for CI and
 *  agents) — exactly as before profiles existed. */
function overlayEnv(p: Profile, user?: string): Config {
  return {
    url: process.env.GETONUP_URL || p.url,
    token: process.env.GETONUP_TOKEN || p.token,
    user: process.env.GETONUP_USER || user,
    accessClientId: process.env.GETONUP_ACCESS_CLIENT_ID || p.accessClientId,
    accessClientSecret: process.env.GETONUP_ACCESS_CLIENT_SECRET || p.accessClientSecret,
  };
}

/** The resolved config for the active profile, with GETONUP_* env vars overlaid.
 *  `selector` is the CLI `--profile` value (if any). */
export async function loadConfig(selector?: string): Promise<Config> {
  const file = await readConfigFile();
  const name = resolveName(file, selector);
  return overlayEnv(name ? file.profiles[name] : {}, file.user);
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
 *  pass `{ makeDefault: true }` to re-point the default at this one. `opts.user` sets the
 *  global deployment user, shared by every profile. Returns the file path. */
export async function saveProfile(
  name: string,
  profile: Profile,
  opts: { makeDefault?: boolean; user?: string } = {},
): Promise<string> {
  const file = await readConfigFile();
  // Plain assignment of "__proto__" hits Object.prototype's setter and stores nothing, so
  // login would report success having saved no profile. It's the only such name — every other
  // Object.prototype member is a data property that assignment shadows normally.
  if (name === "__proto__") throw new Error(`"__proto__" is not a usable profile name — pick another.`);
  file.profiles[name] = profile;
  if (opts.makeDefault || !file.default) file.default = name;
  if (opts.user) file.user = opts.user;
  return writeConfigFile(file);
}

/** All configured profiles, which one is the default, and the global deployment user. */
export async function listProfiles(): Promise<{
  profiles: Record<string, Profile>;
  default?: string;
  user?: string;
}> {
  const { profiles, default: def, user } = await readConfigFile();
  return { profiles, default: def, user };
}

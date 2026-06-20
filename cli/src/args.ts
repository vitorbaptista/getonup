export interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

/** Parse a subcommand-stripped argv into positionals (`_`) and flags.
 *  Supports `--k=v`, `--k v`, and bare `--k` (boolean true when followed by another flag or
 *  nothing). A lone `-` is a positional (stdin). */
export function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const eq = key.indexOf("=");
      if (eq >= 0) flags[key.slice(0, eq)] = key.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) flags[key] = argv[++i];
      else flags[key] = true;
    } else if (a === "-") {
      _.push("-");
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

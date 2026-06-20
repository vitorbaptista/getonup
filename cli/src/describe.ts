/**
 * Auto-derive a one-line description for a deploy from its entry HTML, at deploy time.
 *
 * Priority: `<meta name="description">` → `<title>` (only when it says something beyond the deploy
 * title). Returns `undefined` when nothing meaningful is found — the index page then synthesizes a
 * "<type> · <size>" fallback at render time, so deploys without a description still read well.
 *
 * This runs on the final index.html we're about to upload. Source code (React/Vue/JS) and our own
 * wrapper shell carry no real `<meta>`/`<title>` (a wrapped page's title is just the deploy title),
 * so they correctly yield `undefined` here.
 */

/** Read an attribute's value from a single tag string — quoted or bare, attribute-order-insensitive. */
function attr(tag: string, name: string): string | undefined {
  // Anchor on a real attribute boundary (start, whitespace, or a closing quote) so `data-name` /
  // `data-content` aren't misread as `name` / `content` — a bare `\b` also matches after a hyphen.
  const m = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

/** `content` of the first `<meta name="<key>">` (case-insensitive name match). */
function metaByName(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = attr(tag, "name");
    if (name && name.toLowerCase() === key) {
      const content = attr(tag, "content");
      if (content) return content;
    }
  }
  return undefined;
}

function titleText(html: string): string | undefined {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1] : undefined;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Stay within the valid Unicode range — String.fromCodePoint throws (RangeError) above 0x10FFFF.
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Collapse whitespace, decode entities, trim, cap to the server's 200-char meta limit. */
function clean(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ").trim().slice(0, 200);
}

export function describeHtml(html: string, deployTitle?: string | null): string | undefined {
  if (!html) return undefined;

  // Deriving a description is strictly best-effort — a malformed artifact must never block a deploy,
  // so any unexpected throw here degrades to "no description" rather than failing the upload.
  try {
    const meta = metaByName(html, "description");
    if (meta) {
      const c = clean(meta);
      if (c) return c;
    }

    const title = titleText(html);
    if (title) {
      const c = clean(title);
      // Skip a <title> that just echoes the deploy title or our wrapper's default — it adds nothing.
      const dt = clean(deployTitle || "").toLowerCase();
      if (c && c.toLowerCase() !== dt && c.toLowerCase() !== "getonup artifact") return c;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

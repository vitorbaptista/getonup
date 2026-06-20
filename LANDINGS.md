# getonup — landing page designs

Twenty landing-page directions for getonup, each a complete self-contained HTML file in
[`landings/`](./landings). **Ten** are built in real
[shadcn.io DESIGN.md](https://www.shadcn.io/design) systems (each agent fetched the system's
exact tokens — colors, typography, components — and applied them); **ten** are house originals.
Every page was **published with `getonup deploy`**, so this is also a live demo of the product.

The homepage (`/`) is the **live index** — an auto-generated list of everything published to the
instance (see [`docs/specs/2026-06-20-live-index-page.md`](./docs/specs/2026-06-20-live-index-page.md)),
so these demos show up there automatically. The original hand-built gallery is kept as a design
reference in [`docs/mockups/`](./docs/mockups).

![The preserved landing-gallery mockup](docs/gallery.png)

```bash
npm run dev         # http://localhost:8787 → serves the live index homepage
npm run demo        # (re)deploy all 20 landings; they appear on the live index automatically
```

## Design systems (shadcn.io DESIGN.md)

| Design | Source |
|---|---|
| Linear | `landings/linear.html` |
| Vercel | `landings/vercel.html` |
| Stripe | `landings/stripe.html` |
| Supabase | `landings/supabase.html` |
| Raycast | `landings/raycast.html` |
| GitHub | `landings/github.html` |
| Cursor | `landings/cursor.html` |
| Notion | `landings/notion.html` |
| Figma | `landings/figma.html` |
| Hugging Face | `landings/huggingface.html` |

## Originals

| Design | Source |
|---|---|
| Midnight (house style) | `landings/midnight.html` |
| Scanini | `landings/scanini.html` |
| Shellshare | `landings/shellshare.html` |
| PostHog | `landings/posthog.html` |
| Claude | `landings/claude.html` |
| Funkadelic 🕺 | `landings/funkadelic.html` |
| Groovy Hacker ▚ | `landings/groovyhacker.html` |
| Pixel Funk 👾 | `landings/pixelfunk.html` |
| Pixel Hog 🦔 | `landings/pixelhog.html` |
| Ship It 🚀 | `landings/shipit.html` |

Run `npm run demo` to publish all twenty to your server, then open the homepage (`/`) — the live
index lists them, newest first. Deploy IDs are assigned per-server at publish time, so they aren't
listed here. Per-design screenshots are in [`docs/landings/`](./docs/landings).

**Make one design the homepage** (instead of the live index):

```bash
cp landings/<key>.html server/public/index.html
# restore the live index homepage:
git checkout server/public/index.html
```

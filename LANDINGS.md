# getonup — landing page designs

Eighteen landing-page directions for getonup, each a complete self-contained HTML file in
[`landings/`](./landings). **Ten** are built in real
[shadcn.io DESIGN.md](https://www.shadcn.io/design) systems (each agent fetched the system's
exact tokens — colors, typography, components — and applied them); **eight** are house originals.
Every page — and the gallery itself, a multi-file deploy — was **published with
`getonup deploy`**, so this is also a live demo of the product.

The **gallery** is the homepage: a single page linking to all eighteen.

![Gallery](docs/gallery.png)

```bash
npm run dev         # http://localhost:8787 → serves the committed gallery
npm run demo        # (re)deploy all 18 + the gallery to your server and set the homepage
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

Run `npm run demo` to publish all eighteen + the gallery to your server, then open the homepage
(`/`) to browse them live. Deploy IDs are assigned per-server at publish time, so they aren't
listed here. Per-design screenshots are in [`docs/landings/`](./docs/landings).

**Make one design the homepage** (instead of the gallery):

```bash
cp landings/<key>.html server/public/index.html
# restore the gallery as homepage:
cp gallery/index.html server/public/index.html && cp gallery/thumbs/*.png server/public/thumbs/
```

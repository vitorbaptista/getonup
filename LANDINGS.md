# Conjure — landing page designs

Fifteen landing-page directions for Conjure, each a complete self-contained HTML file in
[`landings/`](./landings). **Ten** are built in real
[shadcn.io DESIGN.md](https://www.shadcn.io/design) systems (each agent fetched the system's
exact tokens — colors, typography, components — and applied them); **five** are house originals.
Every page — and the gallery itself, a multi-file deploy — was **published with
`conjure deploy`**, so this is also a live demo of the product.

The **gallery** is the homepage: a single page linking to all fifteen.

![Gallery](docs/gallery.png)

```bash
npm run dev        # http://localhost:8787  → the gallery, links to all fifteen
```

## Design systems (shadcn.io DESIGN.md)

| Design | Source | Live (local) |
|---|---|---|
| Linear | `landings/linear.html` | /s/dwsgfkfp |
| Vercel | `landings/vercel.html` | /s/s7xz56cf |
| Stripe | `landings/stripe.html` | /s/n9i3egyy |
| Supabase | `landings/supabase.html` | /s/74bhb7xg |
| Raycast | `landings/raycast.html` | /s/8v7q8u4c |
| GitHub | `landings/github.html` | /s/qa56h65n |
| Cursor | `landings/cursor.html` | /s/ba3p7yka |
| Notion | `landings/notion.html` | /s/b2bpvhxj |
| Figma | `landings/figma.html` | /s/wi8ex9pa |
| Hugging Face | `landings/huggingface.html` | /s/64n3a459 |

## Originals

| Design | Source | Live (local) |
|---|---|---|
| Midnight (house style) | `landings/midnight.html` | /s/32c7whv2 |
| Scanini (`scanini.app`) | `landings/scanini.html` | /s/tunyekjr |
| Shellshare (`shellshare.net`) | `landings/shellshare.html` | /s/y3ynsckc |
| PostHog | `landings/posthog.html` | /s/4dtxiaem |
| Claude | `landings/claude.html` | /s/gurjmsk7 |

Gallery: homepage `/` · also `/s/qrid9qrt`. Individual screenshots in
[`docs/landings/`](./docs/landings).

> IDs are local deploys (persisted in `.wrangler`). Cleared local state or a real Cloudflare
> deploy gives new IDs — redeploy and the gallery links update.

**Make one design the homepage** (instead of the gallery):

```bash
cp landings/<key>.html server/public/index.html
# restore the gallery as homepage:
cp gallery/index.html server/public/index.html && cp gallery/thumbs/*.png server/public/thumbs/
```

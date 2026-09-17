---
name: orbit-visual-identity
description: Orbit's habitat-interior visual identity: base/structural/amber-accent/cool-secondary/text/success-error palette, depth-over-flatness and matte-material rules, no cyberpunk tropes — plus applying it as CSS custom properties after checking for an existing theme file. Load before any color, theme, or visual-styling work.
---

# orbit-visual-identity

## UI style target

Orbit's visual identity target: a quiet, high-tech habitat interior — not a sci-fi HUD, not a flat SaaS dashboard. Think structural calm over glow-heavy cyberpunk.

**Reference mood** (from provided concept image — a dome habitat interior with Earth visible through curved glass, warm accent lighting, dark structural materials, natural plant elements):

- **Base/background**: near-black, warm-neutral dark (charcoal, not blue-black) — e.g. `#14120f`–`#1c1a17` range. Avoid pure `#000`.
- **Structural surfaces** (panels, terminal chrome, borders): dark warm greys, brushed-metal feel — e.g. `#2a2722`–`#3a352e`. Subtle gradients over flat fills to suggest curved/molded surfaces.
- **Accent / active state**: warm amber-gold glow — e.g. `#d9a35c`–`#f0b969` — used sparingly for active terminal borders, focus rings, running-process indicators, key icons. This is the "interior lighting" accent, not a saturated brand color.
- **Secondary accent**: cool blue-white for "outside/data" elements (e.g. Earth-through-glass) — e.g. `#7fa8c9`–`#a9c4de` — use for informational/status text, links, or a secondary highlight, kept rare so amber stays dominant.
- **Text**: warm off-white (`#e8e3d8`-ish) for primary text on dark, muted warm grey (`#9a9488`-ish) for secondary/dim text. Never pure white on pure black.
- **Success/error**: don't default to saturated green/red — desaturate to fit the warm-dark palette (muted sage for success, muted rust/clay for error) unless a strong alert genuinely needs to cut through.
- **Depth over flatness**: subtle inner shadows, soft glows around active/lit elements, faint gradients — the reference image reads as dimensional, not flat-color UI. Avoid hard drop-shadows or neon glow; keep it soft and warm.
- **Materials feel**: matte structural surfaces with occasional warm light bleed, not glossy/glassy sci-fi chrome. No scan-lines, no neon grid overlays, no cyberpunk tropes.

Apply this palette as CSS custom properties (or the project's existing theming mechanism) rather than hardcoding hex values inline — check for an existing theme/variables file before creating one.

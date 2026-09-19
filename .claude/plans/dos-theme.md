# Plan: dos-theme (issue #79)

Branch: `feature/dos-theme`. Phase 1 only: a switchable CSS-token theme + light DOM chrome. Stop and let the user judge before going deeper (pixelated graph, real glyph borders, keyboard menus).

## Goal
Add "DOS / Norton Commander" as a fourth selectable theme (blue bg, VGA 16 colors, monospace VGA font, hard edges, box borders, top menu bar, bottom F-key bar). Existing themes (esp. `orbit-default`, the habitat-interior identity) render identically when DOS is not selected. DOS is an additional theme, not a replacement.

## Key finding: a theme system already exists
`src/renderer/themes/{index,orbit-default,lunar,neptune-silver,falcon}.js`: each theme = `{id, name, tokens: {--css-var: value}, terminal: xtermITheme}`. `applyTheme()` sets tokens on `:root`; `renderer.js` `onSelectTheme` applies it, pushes `terminal` to xterm (`setTerminalTheme`), calls `backdrop.refreshTheme()` (graph recolors from tokens via `readToken`), and persists with `window.orbit.setSetting('theme', id)` (default in `src/main/settings-store.js`). Settings panel lists `SELECTABLE_THEME_IDS`. So switch + persistence need no new wiring; DOS is a new theme file plus the gaps below.

## Approach
1. **Theme file**: `src/renderer/themes/dos-nc.js` (id `dos-nc`, name "DOS / Norton Commander"), registered in `THEMES` and `SELECTABLE_THEME_IDS`. Same token keys as other themes, plus new structural tokens (below).
2. **Gap 1, non-color tokens.** Themes only carry colors today; DOS needs font, radius, glow. Add to `:root` in `styles.css`, with defaults equal to today's literals: `--font-ui` (current sans stack), `--radius-lg: 8px`, `--radius-md: 6px`, `--radius-sm: 4px` (replace the `border-radius` literals at lines ~101, 264, 420, 443, 569, 603, 658; the 50% circles stay), `--glow-active` (line ~289, `.tile.active`), `--glow-dot` (line ~359). `html,body` font-family becomes `var(--font-ui)`. DOS sets font = VGA, radii = 0, glows = none/hard. Defaults keep other themes identical.
3. **Gap 2, stale tokens on switch.** `applyTheme` only sets, never clears, so DOS-only tokens would leak into the next theme. Make it remember the keys it last applied and `removeProperty` any not in the new theme (falls back to `:root` defaults). Also set `document.documentElement.dataset.theme = theme.id` so DOS-only structural CSS can scope to `[data-theme="dos-nc"]`.
4. **DOS-only CSS**: new `src/renderer/dos-theme.css` (imported in `renderer.js` after `styles.css`), everything under `[data-theme="dos-nc"]`: box borders, nav restyle, menu/F-key bars, scrollbars, reverse-video hover/selected, tile/settings restyle. Other themes never match it, so zero regression.

### Palette (starting values; implementer may tune)
VGA: black `#000000`, blue `#0000AA`, green `#00AA00`, cyan `#00AAAA`, red `#AA0000`, magenta `#AA00AA`, brown `#AA5500`, gray `#AAAAAA`; bright: dark gray `#555555`, `#5555FF`, `#55FF55`, `#55FFFF`, `#FF5555`, `#FF55FF`, `#FFFF55`, white `#FFFFFF`.
Tokens: `--bg-base` / `--panel-surface` `#0000AA`; `--bg-sunken` `#000000`; `--bg-raised` `#0000AA` (hover is reverse video, bg `#00AAAA` + text `#000000`, in dos-theme.css); `--panel-header` `#00AAAA` with black text (NC title bar); `--border-subtle` `#00AAAA`; `--border-strong` `#55FFFF`; `--text-primary` `#55FFFF`; `--text-secondary` `#00AAAA`; `--text-muted` `#AAAAAA`; `--accent` / `--accent-strong` `#FFFF55`; `--accent-dim` `#AA5500`; `--accent-secondary` `#55FF55`; `--focus-ring` `#FFFFFF`; `--danger` `#FF5555`. Include matching `*-rgb` twins (required for the opacity sliders; see comment in orbit-default.js).

### Font
Bundle a woff2 in `src/renderer/fonts/`, declared with `@font-face` in `dos-theme.css` (Vite bundles it; CSP `default-src 'self'` already permits it, no CSP change). Recommended: **Px437 IBM VGA 8x16** from "The Ultimate Oldschool PC Font Pack" (int10h.org), CC BY-SA 4.0: needs attribution (add `fonts/LICENSE.txt` and a credit line); re-verify the licence text at implementation. Fallback if licence is a concern: `VT323` (SIL OFL, via `@fontsource/vt323`), less authentic and a new npm dependency (flag per code-discipline). Use `font-size: 16px; line-height: 16px` so one cell = 8x16 and paddings are multiples of 8/16 (fixed-grid look). CSS fallback `Consolas, monospace`.

### Box-drawing borders
Structure uses CSS, not glyph characters: single = `1px solid var(--border-subtle)`, double = `3px double var(--border-strong)` (renders as two 1px lines), `border-radius: 0`, no gradients or blur. Glyphs are reserved for text-level decoration that cannot break on resize: tile header title as `╡ label ╞` via `::before/::after`, F-key bar separators, scrollbar arrows/thumb (`▲ ▼ ▒ █`), close button `[■]`. Rejected: full glyph frames (`┌───┐` runs need JS rebuilds on every resize and fight the split-layout engine and xterm resize).
Mapping: active `.tile` = double border, inactive = single; hard offset shadow (`4px 4px 0 #000`, the NC dialog shadow) on `.tile`.

### NC chrome
Two new nodes in `index.html`, siblings of `#app`: `#dos-menubar` (top) and `#dos-fkeybar` (bottom), `display:none` by default and `display:flex` under `[data-theme="dos-nc"]`. `position: fixed`, height 16px (one text row), `z-index: 2`, `pointer-events: auto`; under DOS `#app` gets `padding-top/bottom: 16px` (already `height:100%` + border-box). Rendered by a small new `src/renderer/dos-chrome.js` (`renderDosChrome(...)`), called from `showView` in `renderer.js` next to `renderNavBar`.
- Menu bar (cyan bg, black text, active item reverse video): "Console" and "Settings" only (real actions via `onNavigate`), "Orbit" title right-aligned. No dead menus.
- F-key bar: `1Help 2Menu ... 10Quit` NC style (number gray-on-black, label black-on-cyan). Wire only keys with an existing action (view switch, new terminal tile via the console-panel API, close focused tile); unwired keys render dimmed and inert. Always clickable. Keyboard F-keys are handled only when focus is NOT inside a terminal (terminal apps use F-keys) and only while the DOS theme is active.
- Existing left `#nav-bar`: keep, restyle under DOS (square, single border, reverse-video active, hide emoji icons). Not removed, to avoid touching nav logic.

### Graph view
`graph-view.js` colors already come from tokens (`--accent` file, `--accent-secondary` function, `--text-secondary` method, `--text-muted` external, `--border-strong` links, pulse `--accent-strong`) and the canvas is transparent over the body background. DOS tokens therefore give a blue field with yellow/green/cyan/gray nodes with no graph code change; `refreshTheme()` already handles live switching. Phase-2 candidates (only after judging phase 1): low `nodeResolution`, `image-rendering: pixelated` with reduced pixel ratio, square sprites instead of spheres.

### Terminal panes
- `terminal` ITheme = VGA palette above; background **black `#000000`**, foreground `#AAAAAA`, block cursor. Black rather than blue: ANSI blue (`#0000AA`) text from Claude Code/CLI tools would be invisible on a blue bg.
- `terminal-view.js` hardcodes `fontSize: 13` and the default family. Add an optional `terminalFont` (`{fontFamily, fontSize}`) on the theme object; `setTerminalTheme(terminal, font)` in `console-panel.js` forwards it to each session's `setTheme`, which sets `term.options.fontFamily/fontSize`, awaits `document.fonts.load()` for the VGA face, then calls `fitAndSyncPty()` (cell size changed, pty must be resized). New sessions use the current font. Themes without `terminalFont` must reset to 13px/default on switch back.
- `cursorStyle: 'block'`. xterm's `customGlyphs` (default) renders box drawing crisply.
- Scrollbar/viewport: existing xterm CSS overrides in `styles.css` (~line 500) stay; the DOS scrollbar in `dos-theme.css` needs a higher-specificity selector because xterm.css loads after `styles.css`.

## Files
- new `src/renderer/themes/dos-nc.js`: tokens + terminal + terminalFont
- edit `src/renderer/themes/index.js`: register; `applyTheme` clears stale tokens and sets `data-theme`
- edit `src/renderer/styles.css`: structural tokens with today's values; swap literals for vars
- new `src/renderer/dos-theme.css`: all DOS-scoped CSS + `@font-face`
- new `src/renderer/fonts/*.woff2` + `LICENSE.txt`
- new `src/renderer/dos-chrome.js`; edit `index.html` (two nodes), `renderer.js` (import css, render chrome)
- edit `src/renderer/console-panel.js`, `terminal-view.js`: font forwarding + refit
- `settings-panel.js`: no change expected (swatch reads tokens); check the swatch looks right.

## Flow
Select DOS in Settings -> `onSelectTheme` -> `applyTheme` (tokens + `data-theme`) -> `setTerminalTheme` (colors + font, refit) -> `backdrop.refreshTheme()` -> persisted `theme: 'dos-nc'` -> next launch `main()` applies it before first render.

## Risks / blast radius (review should check)
- Regression of habitat/other themes via the `styles.css` var swap: defaults must equal the old literals exactly. Compare computed styles of `.tile`, `.nav-item`, `.theme-row` under `orbit-default` before/after.
- `applyTheme` clearing: verify DOS -> orbit-default fully restores font, radii, glows, and xterm font.
- Fixed 16px bars vs split-layout engine and edge-affordance zones (`--edge-zone-size`): tiles must not overflow under the bars; Alt-drag graph interaction must still work.
- xterm refit after font swap: wrong cols/rows to the pty garbles TUIs. Test with a live Claude session.
- F-key handlers must not steal keys from terminals.
- Opacity sliders still apply under DOS (rgba over blue); default 1 gives the solid NC look.
- CC BY-SA attribution obligation for the font.

## Verify
Switch to DOS across Console and Settings; restart persists; switch back to each other theme with nothing stale; terminal font/colors/resize; graph recolors live; menu and F-bar clicks change views.

## Open questions
1. Font: Px437 IBM VGA (CC BY-SA 4.0, attribution) vs VT323 (OFL, new npm dep, less authentic)?
2. Terminal background black (recommended, keeps ANSI blue readable) vs blue (more NC-like)?
3. Which F-keys are live (proposal: F1 Console, F2 Settings, F5 new terminal tile, F8 close focused tile), or only view switching?
4. Keep the left nav-bar under DOS, or hide it since the top menu bar duplicates Console/Settings?

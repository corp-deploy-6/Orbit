# Backlog

## Rename CLI Panel Tiles to name of selected folder

When a tile's working directory is picked via the folder dialog, default the tile's
label to that folder's name (e.g. `basename(cwd)`) instead of a generic default.
User can still rename manually afterward — this only changes the initial label.

Status: Done.

## Add Orbit Default theme + theme selection in Settings

As a user, I want the app styled with a cohesive "Orbit Default" theme (warm dark sci-fi palette: charcoal base, amber/gold accents, cream text, muted green secondary accent) applied throughout tile grid, terminals, dialogs, and nav — so the app has a deliberate, polished look instead of ad-hoc hardcoded colors.

As a user, I want a Settings view (via the existing unwired Settings nav item) where I can see the current theme, with "Orbit Default" as the only selectable option for now — selection persists across restarts and applies instantly without reload.

**Acceptance criteria:**
- All existing UI surfaces (tile grid, tile header/hover/active/focus states, terminal chrome/colors, settings panel itself) use the Orbit Default palette — no leftover hardcoded hex outside the theme file.
- Terminal (xterm) colors match the surrounding UI chrome exactly — no visible seam/mismatch.
- Settings nav item opens a panel listing themes; selecting "Orbit Default" persists to disk (survives app restart) and applies live, no reload needed.
- Switching to Settings and back to Tiles doesn't tear down or restart any running terminal sessions.
- Theme is data-driven (token object), not hardcoded inline, so a second theme later doesn't require rewriting `styles.css`.

Status: Not started.

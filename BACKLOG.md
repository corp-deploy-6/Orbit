# Backlog

## Bugs

### Settings view clears main terminal panel content

**Expected:** Clicking "Settings" in the left nav opens the Settings panel without affecting the main (middle) terminal panel — terminals and their running terminals should still be present when switching back to Terminals.

**Actual:** Clicking "Settings" clears all content from the main panel. Only the Settings panel (Theme selector) is visible; the terminal grid area goes blank.

**Notes:** This appears to violate the existing acceptance criterion under "Add Orbit Default theme + theme selection in Settings" — "Switching to Settings and back to Terminals doesn't tear down or restart any running terminal sessions." Needs investigation into whether the Terminals view is being unmounted (and terminals killed) rather than just hidden when navigating to Settings.

Status: Open.

### Settings panel stays visible after switching back to Terminals

**Expected:** Clicking "Terminals" in the left nav shows only the terminal grid in the middle panel — the Settings panel (Theme selector) should be hidden/closed.

**Actual:** After clicking Settings then Terminals, the middle panel shows the terminal grid correctly, but the Settings panel (Theme section) remains visible on the right side instead of disappearing.

**Notes:** Related to the "Settings view clears main terminal panel content" bug above — likely same root cause (Settings panel rendered alongside/overlapping Terminals view instead of the two being mutually exclusive views that swap cleanly).

Status: Open.

### Fix: #terminal-panel / #settings-panel ignore the `hidden` attribute

**Root cause (found by Alpha):** `src/renderer/renderer.js`'s `showView()` correctly toggles `terminalPanelEl.hidden` / `settingsPanelEl.hidden`, and `main()` never unmounts or re-creates the terminal panel — so terminals are never torn down. The bug is purely CSS: `src/renderer/styles.css` sets `#terminal-panel { display: flex; }` (line 79-84) and `#settings-panel { display: flex; }` (line 86-91) unconditionally. Since `display: flex` is set directly on the ID selector, it overrides the UA-stylesheet `[hidden] { display: none }` rule (same origin, `[hidden]` attribute selector loses on specificity/order to the `#id` selector), so both panels stay laid out side-by-side regardless of the `hidden` attribute. This explains both open bugs above: Settings visually overlapping/crowding out Terminals, and Settings staying visible after navigating back to Terminals.

**Fix for Delta:**
1. In `src/renderer/styles.css`, add an explicit override so the `hidden` attribute wins, e.g.:
   ```css
   #terminal-panel[hidden],
   #settings-panel[hidden] {
     display: none;
   }
   ```
   (Place after the existing `#terminal-panel`/`#settings-panel` rules, or raise specificity — either works since both panels currently use the same `display: flex` declaration.)
2. Manually verify: start app, open Settings (Terminals hides, Settings shows), switch back to Terminals (Settings hides, Terminals shows with prior terminal state intact, terminal grid not blank).
3. Do not touch `renderer.js` view-switching logic — it's already correct; only the CSS visibility rule is broken.

Status: Fixed.

## Rename CLI Panel Terminals to name of selected folder

When a terminal's working directory is picked via the folder dialog, default the terminal's
label to that folder's name (e.g. `basename(cwd)`) instead of a generic default.
User can still rename manually afterward — this only changes the initial label.

Status: Done.

## Add Orbit Default theme + theme selection in Settings

As a user, I want the app styled with a cohesive "Orbit Default" theme (warm dark sci-fi palette: charcoal base, amber/gold accents, cream text, muted green secondary accent) applied throughout terminal grid, terminals, dialogs, and nav — so the app has a deliberate, polished look instead of ad-hoc hardcoded colors.

As a user, I want a Settings view (via the existing unwired Settings nav item) where I can see the current theme, with "Orbit Default" as the only selectable option for now — selection persists across restarts and applies instantly without reload.

**Acceptance criteria:**
- All existing UI surfaces (terminal grid, terminal header/hover/active/focus states, terminal chrome/colors, settings panel itself) use the Orbit Default palette — no leftover hardcoded hex outside the theme file.
- Terminal (xterm) colors match the surrounding UI chrome exactly — no visible seam/mismatch.
- Settings nav item opens a panel listing themes; selecting "Orbit Default" persists to disk (survives app restart) and applies live, no reload needed.
- Switching to Settings and back to Terminals doesn't tear down or restart any running terminal sessions.
- Theme is data-driven (token object), not hardcoded inline, so a second theme later doesn't require rewriting `styles.css`.

Status: Done.

Note: Lunar theme is now selectable in Settings alongside Orbit Default (re-enabled, see PR reversing #18).

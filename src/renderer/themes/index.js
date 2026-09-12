import { orbitDefault } from './orbit-default.js';
import { lunar } from './lunar.js';

export const THEMES = { 'orbit-default': orbitDefault, lunar };

// Only these themes are surfaced as selectable options in Settings.
// Lunar stays in THEMES so lookups (e.g. a stale settings.json) still work.
export const SELECTABLE_THEME_IDS = ['orbit-default'];

export function applyTheme(theme) {
  for (const [k, v] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(k, v);
  }
}

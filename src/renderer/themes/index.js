import { orbitDefault } from './orbit-default.js';
import { lunar } from './lunar.js';

export const THEMES = { 'orbit-default': orbitDefault, lunar };

// Only these themes are surfaced as selectable options in Settings.
export const SELECTABLE_THEME_IDS = ['orbit-default', 'lunar'];

export function applyTheme(theme) {
  for (const [k, v] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(k, v);
  }
}

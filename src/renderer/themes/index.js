import { orbitDefault } from './orbit-default.js';

export const THEMES = { 'orbit-default': orbitDefault };

export function applyTheme(theme) {
  for (const [k, v] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(k, v);
  }
}

import { dosNc } from './dos-nc.js';

export const THEMES = { 'dos-nc': dosNc };
export const DEFAULT_THEME_ID = 'dos-nc';

export function applyTheme(theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.tokens)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = theme.id;
}

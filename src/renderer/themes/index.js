import { orbitDefault } from './orbit-default.js';
import { lunar } from './lunar.js';
import { neptuneSilver } from './neptune-silver.js';
import { falcon } from './falcon.js';
import { dosNc } from './dos-nc.js';

export const THEMES = { 'orbit-default': orbitDefault, lunar, 'neptune-silver': neptuneSilver, falcon, 'dos-nc': dosNc };

// Only these themes are surfaced as selectable options in Settings.
export const SELECTABLE_THEME_IDS = ['orbit-default', 'lunar', 'neptune-silver', 'falcon', 'dos-nc'];

let appliedKeys = [];

export function applyTheme(theme) {
  const root = document.documentElement;
  for (const k of appliedKeys) {
    if (!(k in theme.tokens)) root.style.removeProperty(k);
  }
  for (const [k, v] of Object.entries(theme.tokens)) {
    root.style.setProperty(k, v);
  }
  appliedKeys = Object.keys(theme.tokens);
  root.dataset.theme = theme.id;
}

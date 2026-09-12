// Settings view: lists available themes as radio rows. Selecting a theme
// calls back to the caller, which persists + applies it.

import { THEMES } from './themes/index.js';

// Tokens shown as swatch segments, in order, for a quick palette preview.
const SWATCH_TOKENS = [
  '--bg-base',
  '--panel-surface',
  '--accent',
  '--accent-secondary',
  '--text-primary',
];

function renderSwatch(theme) {
  const swatch = document.createElement('div');
  swatch.className = 'theme-swatch';
  const tokens = theme.tokens || {};
  for (const token of SWATCH_TOKENS) {
    const color = tokens[token];
    if (!color) continue;
    const segment = document.createElement('span');
    segment.className = 'theme-swatch-segment';
    segment.style.background = color;
    swatch.appendChild(segment);
  }
  return swatch;
}

export function renderSettingsPanel(container, { currentThemeId, onSelectTheme }) {
  container.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'settings-panel-inner';

  const heading = document.createElement('h2');
  heading.className = 'settings-heading';
  heading.textContent = 'Theme';
  panel.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'theme-list';

  for (const theme of Object.values(THEMES)) {
    const row = document.createElement('label');
    row.className = 'theme-row';
    row.classList.toggle('selected', theme.id === currentThemeId);

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme';
    radio.value = theme.id;
    radio.checked = theme.id === currentThemeId;
    radio.addEventListener('change', () => onSelectTheme?.(theme.id));

    const name = document.createElement('span');
    name.textContent = theme.name;

    row.appendChild(radio);
    row.appendChild(name);
    row.appendChild(renderSwatch(theme));
    list.appendChild(row);
  }

  panel.appendChild(list);
  container.appendChild(panel);
}

// Settings view: lists available themes as radio rows, plus the graph
// backdrop's per-panel opacity sliders and a manual reload button. Selecting
// a theme / dragging a slider / clicking reload calls back to the caller,
// which persists + applies it live.

import { THEMES, SELECTABLE_THEME_IDS } from './themes/index.js';

// Tokens shown as swatch segments, in order, for a quick palette preview.
const SWATCH_TOKENS = [
  '--bg-base',
  '--panel-surface',
  '--accent',
  '--accent-secondary',
  '--text-primary',
];

// key -> label shown next to each opacity slider. Order matches the panels
// left-to-right in the app layout (nav, console), with the terminal chat
// surface (inside each console tile) last.
const OPACITY_ROWS = [
  { key: 'nav', label: 'Nav Bar' },
  { key: 'console', label: 'Console' },
  { key: 'terminal', label: 'Terminal' },
];

// Split isn't implemented yet (PR2) — its option is shown but disabled
// rather than hidden, so the setting's existence and intent are visible.
const CONSOLE_LAYOUT_OPTIONS = [
  { id: 'grid', label: 'Grid' },
  { id: 'split', label: 'Split (coming soon)', disabled: true },
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

export function renderSettingsPanel(
  container,
  {
    currentThemeId,
    onSelectTheme,
    opacity,
    onOpacityChange,
    onReloadGraph,
    consoleLayoutMode,
    onSelectConsoleLayoutMode,
  }
) {
  container.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'settings-panel-inner';

  const layoutHeading = document.createElement('h2');
  layoutHeading.className = 'settings-heading';
  layoutHeading.textContent = 'Console Layout';
  panel.appendChild(layoutHeading);

  const layoutList = document.createElement('div');
  layoutList.className = 'theme-list';

  for (const option of CONSOLE_LAYOUT_OPTIONS) {
    const row = document.createElement('label');
    row.className = 'theme-row';
    row.classList.toggle('selected', option.id === consoleLayoutMode);
    if (option.disabled) row.classList.add('disabled');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'console-layout';
    radio.value = option.id;
    radio.checked = option.id === consoleLayoutMode;
    radio.disabled = !!option.disabled;
    if (option.disabled) row.title = 'Split layout is coming in a later release';
    radio.addEventListener('change', () => onSelectConsoleLayoutMode?.(option.id));

    const name = document.createElement('span');
    name.textContent = option.label;

    row.appendChild(radio);
    row.appendChild(name);
    layoutList.appendChild(row);
  }

  panel.appendChild(layoutList);

  const heading = document.createElement('h2');
  heading.className = 'settings-heading';
  heading.textContent = 'Theme';
  panel.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'theme-list';

  for (const theme of SELECTABLE_THEME_IDS.map((id) => THEMES[id])) {
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

  const graphHeading = document.createElement('h2');
  graphHeading.className = 'settings-heading';
  graphHeading.textContent = 'Graph Backdrop';
  panel.appendChild(graphHeading);

  const opacityList = document.createElement('div');
  opacityList.className = 'opacity-list';

  for (const { key, label } of OPACITY_ROWS) {
    const row = document.createElement('div');
    row.className = 'opacity-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'opacity-row-label';
    labelEl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = String(opacity?.[key] ?? 1);

    const valueEl = document.createElement('span');
    valueEl.className = 'opacity-row-value';
    valueEl.textContent = `${Math.round((opacity?.[key] ?? 1) * 100)}%`;

    slider.addEventListener('input', () => {
      const value = Number(slider.value);
      valueEl.textContent = `${Math.round(value * 100)}%`;
      onOpacityChange?.(key, value);
    });

    row.appendChild(labelEl);
    row.appendChild(slider);
    row.appendChild(valueEl);
    opacityList.appendChild(row);
  }

  panel.appendChild(opacityList);

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'reload-graph-btn';
  reloadBtn.textContent = 'Reload Graph';
  reloadBtn.addEventListener('click', () => onReloadGraph?.());
  panel.appendChild(reloadBtn);

  const hint = document.createElement('p');
  hint.className = 'settings-hint';
  hint.textContent = 'Hold Alt to pan, zoom and click the graph anywhere in the window.';
  panel.appendChild(hint);

  container.appendChild(panel);
}

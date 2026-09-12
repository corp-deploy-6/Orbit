// Settings view: lists available themes as radio rows. Selecting a theme
// calls back to the caller, which persists + applies it.

import { THEMES } from './themes/index.js';

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
    list.appendChild(row);
  }

  panel.appendChild(list);
  container.appendChild(panel);
}

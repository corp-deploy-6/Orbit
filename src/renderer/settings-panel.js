// Settings view: console layout, plus the graph backdrop's per-panel opacity
// sliders and a manual reload button. Changing a layout / dragging a slider /
// clicking reload calls back to the caller, which persists + applies it live.

// key -> label shown next to each opacity slider. Order matches the panels
// left-to-right in the app layout (nav, console), with the terminal chat
// surface (inside each console tile) last.
const OPACITY_ROWS = [
  { key: 'nav', label: 'Nav Bar' },
  { key: 'console', label: 'Console' },
  { key: 'terminal', label: 'Terminal' },
];

const CONSOLE_LAYOUT_OPTIONS = [
  { id: 'grid', label: 'Grid' },
  { id: 'split', label: 'Split' },
];

export function renderSettingsPanel(
  container,
  {
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

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'console-layout';
    radio.value = option.id;
    radio.checked = option.id === consoleLayoutMode;
    radio.addEventListener('change', () => onSelectConsoleLayoutMode?.(option.id));

    const name = document.createElement('span');
    name.textContent = option.label;

    row.appendChild(radio);
    row.appendChild(name);
    layoutList.appendChild(row);
  }

  panel.appendChild(layoutList);

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

  const credit = document.createElement('p');
  credit.className = 'settings-hint';
  credit.textContent = 'Font: Px437 IBM VGA by VileR (int10h.org), CC BY-SA 4.0.';
  panel.appendChild(credit);

  container.appendChild(panel);
}

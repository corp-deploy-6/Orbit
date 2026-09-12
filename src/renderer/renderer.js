import './styles.css';
import { renderNavBar } from './nav-bar.js';
import { renderTerminalPanel, setTerminalTheme } from './terminal-panel.js';
import { renderSettingsPanel } from './settings-panel.js';
import { THEMES, applyTheme } from './themes/index.js';

async function main() {
  const settings = await window.orbit.getSettings();
  let currentThemeId = settings?.theme || 'orbit-default';
  if (!THEMES[currentThemeId]) currentThemeId = 'orbit-default';

  applyTheme(THEMES[currentThemeId]);

  const navBarEl = document.getElementById('nav-bar');
  const terminalPanelEl = document.getElementById('terminal-panel');
  const settingsPanelEl = document.getElementById('settings-panel');

  renderTerminalPanel(terminalPanelEl);
  setTerminalTheme(THEMES[currentThemeId].terminal);

  async function onSelectTheme(id) {
    currentThemeId = id;
    await window.orbit.setSetting('theme', id);
    applyTheme(THEMES[id]);
    setTerminalTheme(THEMES[id].terminal);
    renderSettingsPanel(settingsPanelEl, { currentThemeId, onSelectTheme });
  }

  function showView(view) {
    terminalPanelEl.hidden = view !== 'terminals';
    settingsPanelEl.hidden = view !== 'settings';
    renderNavBar(navBarEl, { onNavigate: showView, active: view });
    if (view === 'settings') {
      renderSettingsPanel(settingsPanelEl, { currentThemeId, onSelectTheme });
    }
  }

  showView('terminals');
}

main();

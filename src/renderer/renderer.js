import './styles.css';
import { renderNavBar } from './nav-bar.js';
import {
  renderConsolePanel,
  setTerminalTheme,
  forceRedrawConsole,
  restoreSessions,
  refreshGraphTheme,
  pauseGraphTiles,
  resumeGraphTiles,
} from './console-panel.js';
import { renderSettingsPanel } from './settings-panel.js';
import { THEMES, applyTheme } from './themes/index.js';

async function main() {
  const settings = await window.orbit.getSettings();
  let currentThemeId = settings?.theme || 'orbit-default';
  if (!THEMES[currentThemeId]) currentThemeId = 'orbit-default';

  applyTheme(THEMES[currentThemeId]);

  const navBarEl = document.getElementById('nav-bar');
  const consolePanelEl = document.getElementById('console-panel');
  const settingsPanelEl = document.getElementById('settings-panel');

  renderConsolePanel(consolePanelEl);
  setTerminalTheme(THEMES[currentThemeId].terminal);
  restoreSessions();

  async function onSelectTheme(id) {
    currentThemeId = id;
    applyTheme(THEMES[id]);
    setTerminalTheme(THEMES[id].terminal);
    renderSettingsPanel(settingsPanelEl, { currentThemeId, onSelectTheme });
    refreshGraphTheme();
    await window.orbit.setSetting('theme', id);
  }

  function showView(view) {
    consolePanelEl.hidden = view !== 'console';
    settingsPanelEl.hidden = view !== 'settings';
    renderNavBar(navBarEl, { onNavigate: showView, active: view });
    if (view === 'settings') {
      renderSettingsPanel(settingsPanelEl, { currentThemeId, onSelectTheme });
      pauseGraphTiles();
    } else if (view === 'console') {
      forceRedrawConsole();
      resumeGraphTiles();
    }
  }

  showView('console');
}

main();

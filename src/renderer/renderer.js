import './styles.css';
import { renderNavBar } from './nav-bar.js';
import { renderTerminalPanel, setTerminalTheme, forceRedrawTerminals, restoreSessions } from './terminal-panel.js';
import { renderSettingsPanel } from './settings-panel.js';
import { renderGraphPanel, refreshGraphTheme, pauseGraph, resumeGraph } from './graph-panel.js';
import { THEMES, applyTheme } from './themes/index.js';

async function main() {
  const settings = await window.orbit.getSettings();
  let currentThemeId = settings?.theme || 'orbit-default';
  if (!THEMES[currentThemeId]) currentThemeId = 'orbit-default';

  applyTheme(THEMES[currentThemeId]);

  const navBarEl = document.getElementById('nav-bar');
  const terminalPanelEl = document.getElementById('terminal-panel');
  const settingsPanelEl = document.getElementById('settings-panel');
  const graphPanelEl = document.getElementById('graph-panel');

  renderTerminalPanel(terminalPanelEl);
  setTerminalTheme(THEMES[currentThemeId].terminal);
  restoreSessions();

  let graphPanelLoaded = false;

  async function onSelectTheme(id) {
    currentThemeId = id;
    applyTheme(THEMES[id]);
    setTerminalTheme(THEMES[id].terminal);
    renderSettingsPanel(settingsPanelEl, { currentThemeId, onSelectTheme });
    refreshGraphTheme();
    await window.orbit.setSetting('theme', id);
  }

  function showView(view) {
    terminalPanelEl.hidden = view !== 'terminals';
    graphPanelEl.hidden = view !== 'graph';
    settingsPanelEl.hidden = view !== 'settings';
    renderNavBar(navBarEl, { onNavigate: showView, active: view });
    if (view === 'settings') {
      renderSettingsPanel(settingsPanelEl, { currentThemeId, onSelectTheme });
    } else if (view === 'terminals') {
      forceRedrawTerminals();
    } else if (view === 'graph') {
      if (!graphPanelLoaded) {
        graphPanelLoaded = true;
        renderGraphPanel(graphPanelEl);
      } else {
        resumeGraph();
      }
    }
    if (view !== 'graph' && graphPanelLoaded) {
      pauseGraph();
    }
  }

  showView('terminals');
}

main();

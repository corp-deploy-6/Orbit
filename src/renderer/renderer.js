import './styles.css';
import './dos-theme.css';
import { renderDosChrome, handleDosFKey } from './dos-chrome.js';
import {
  renderConsolePanel,
  setTerminalTheme,
  setTerminalOpacity,
  forceRedrawConsole,
  restoreSessions,
  setConsoleLayoutMode,
  addTerminal,
  closeActiveTile,
} from './console-panel.js';
import { renderSettingsPanel } from './settings-panel.js';
import { renderHelpPanel } from './help-panel.js';
import { createGraphView } from './graph-view.js';
import { THEMES, DEFAULT_THEME_ID, applyTheme } from './themes/index.js';

// Maps the opacity keys used in settings/UI to their CSS variable and
// persisted settings key.
const OPACITY_CONFIG = {
  console: { cssVar: '--console-opacity', settingsKey: 'consoleOpacity' },
  terminal: { cssVar: '--terminal-opacity', settingsKey: 'terminalOpacity' },
};

async function main() {
  const settings = await window.orbit.getSettings();
  const theme = THEMES[DEFAULT_THEME_ID];

  let consoleLayoutMode = settings?.consoleLayoutMode === 'split' ? 'split' : 'grid';

  applyTheme(theme);

  const opacity = {
    console: settings?.consoleOpacity ?? 1,
    terminal: settings?.terminalOpacity ?? 1,
  };
  for (const key of Object.keys(OPACITY_CONFIG)) {
    document.documentElement.style.setProperty(OPACITY_CONFIG[key].cssVar, opacity[key]);
  }

  const consolePanelEl = document.getElementById('console-panel');
  const settingsPanelEl = document.getElementById('settings-panel');
  const helpPanelEl = document.getElementById('help-panel');
  const dosFKeyBarEl = document.getElementById('dos-fkeybar');
  const graphBackdropEl = document.getElementById('graph-backdrop');

  // Single graph backdrop instance for the app's lifetime — never recreated
  // by console/settings view switches or tile add/remove churn (#48).
  const backdrop = createGraphView();
  backdrop.attach(graphBackdropEl);

  renderConsolePanel(consolePanelEl, { layoutMode: consoleLayoutMode });
  setTerminalOpacity(opacity.terminal);
  setTerminalTheme(theme.terminal, theme.terminalFont);
  restoreSessions();

  window.orbit.onToolActivity((paths) => backdrop.pulse(paths));

  async function onOpacityChange(key, value) {
    opacity[key] = value;
    document.documentElement.style.setProperty(OPACITY_CONFIG[key].cssVar, value);
    // xterm paints its own background on canvas, so the CSS var alone can't
    // reach it — push the alpha into every live terminal's theme too.
    if (key === 'terminal') setTerminalOpacity(value);
    await window.orbit.setSetting(OPACITY_CONFIG[key].settingsKey, value);
  }

  async function onSelectConsoleLayoutMode(mode) {
    consoleLayoutMode = mode;
    setConsoleLayoutMode(mode);
    renderSettingsPanel(settingsPanelEl, {
      opacity,
      onOpacityChange,
      onReloadGraph: () => backdrop.reload(),
      consoleLayoutMode,
      onSelectConsoleLayoutMode,
    });
    await window.orbit.setSetting('consoleLayoutMode', mode);
  }

  let currentView = 'console';

  function onDosAction(action) {
    if (action === 'newTerminal') {
      showView('console');
      addTerminal();
    } else if (action === 'closeTile' && currentView === 'console') {
      closeActiveTile();
    }
  }

  window.addEventListener('keydown', (e) => handleDosFKey(e, { onNavigate: showView, onAction: onDosAction }));

  // Backdrop stays live across console/settings view switches — it's a
  // full-window backdrop now, not tied to either view.
  function showView(view) {
    consolePanelEl.hidden = view !== 'console';
    settingsPanelEl.hidden = view !== 'settings';
    helpPanelEl.hidden = view !== 'help';
    currentView = view;
    renderDosChrome(dosFKeyBarEl, { onNavigate: showView, onAction: onDosAction, currentView });
    if (view === 'settings') {
      renderSettingsPanel(settingsPanelEl, {
        opacity,
        onOpacityChange,
        onReloadGraph: () => backdrop.reload(),
        consoleLayoutMode,
        onSelectConsoleLayoutMode,
      });
    } else if (view === 'help') {
      renderHelpPanel(helpPanelEl);
    } else if (view === 'console') {
      forceRedrawConsole();
    }
  }

  // Pause the backdrop's render loop when the window is hidden/minimized
  // (document.visibilitychange) or unfocused (window blur), and resume only
  // once it's both visible and focused again. Tracking the two conditions
  // separately and gating on the combined "should play" value (rather than
  // pausing/resuming on every individual event) means a quick blur->focus
  // that never actually loses visibility collapses to at most one pause and
  // one resume call, never more.
  let isHidden = document.hidden;
  let isFocused = document.hasFocus();
  let playing = null;

  function syncPlayback() {
    const shouldPlay = !isHidden && isFocused;
    if (shouldPlay === playing) return;
    playing = shouldPlay;
    if (shouldPlay) backdrop.resume();
    else backdrop.pause();
  }

  document.addEventListener('visibilitychange', () => {
    isHidden = document.hidden;
    syncPlayback();
  });
  window.addEventListener('blur', () => {
    isFocused = false;
    document.body.classList.remove('graph-interact');
    syncPlayback();
  });
  window.addEventListener('focus', () => {
    isFocused = true;
    syncPlayback();
  });
  syncPlayback();

  // Scroll containers swallow pointer input, so holding Alt routes every
  // pointer event to the backdrop for pan/zoom/click. Capture phase so a
  // focused terminal can't swallow the key first.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') document.body.classList.add('graph-interact');
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') document.body.classList.remove('graph-interact');
  }, true);

  showView('console');
}

main();

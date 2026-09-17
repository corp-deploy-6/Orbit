// Per-terminal xterm + pty session. Two-phase: create the pty first (so a terminal
// can show a "starting" spinner while spawn is in flight), then attach the
// xterm instance into a DOM container once the caller flips to 'running'.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// Same URL pattern @xterm/addon-web-links matches internally. Reused here so we
// can wrap detected links in bold SGR codes as they're written — xterm renders
// glyphs on canvas (no per-character DOM nodes), so there's no CSS class to
// target for "always bold" link text; injecting the bold escape codes into the
// stream is the only way to make the addon's own click targets render bold.
const URL_REGEX_SOURCE = String.raw`(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>\`]*[^\s"':,.!?{}|\\^~\[\]\`()<>]`;
const urlRegex = new RegExp(URL_REGEX_SOURCE);
const urlRegexGlobal = new RegExp(URL_REGEX_SOURCE, 'g');

// OSC (e.g. hyperlink) and CSI escape sequences, so URL text already inside
// one (like a CLI's own OSC-8 hyperlinks) is left untouched rather than
// having bold codes spliced into the middle of it, which corrupts the
// sequence and desyncs the terminal parser's cursor tracking.
const ESCAPE_SEQ = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;?]*[a-zA-Z])/g;

function boldenLinks(chunk) {
  let result = '';
  let lastIndex = 0;
  let match;
  ESCAPE_SEQ.lastIndex = 0;
  while ((match = ESCAPE_SEQ.exec(chunk)) !== null) {
    result += chunk.slice(lastIndex, match.index).replace(urlRegexGlobal, (m) => `\x1b[1m${m}\x1b[22m`);
    result += match[0];
    lastIndex = ESCAPE_SEQ.lastIndex;
  }
  result += chunk.slice(lastIndex).replace(urlRegexGlobal, (m) => `\x1b[1m${m}\x1b[22m`);
  return result;
}

function handleLinkClick(event, uri) {
  event.preventDefault();
  window.orbit.confirmOpenLink(uri);
}

// xterm paints its background onto its own canvas, so the panel's CSS
// opacity var can't reach it. Instead the background colour itself carries
// the alpha, which xterm only honours with allowTransparency on.
function themeWithAlpha(theme, alpha) {
  if (!theme) return theme;
  const bg = theme.background;
  if (alpha >= 1 || typeof bg !== 'string') return theme;
  const hex = bg.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return theme;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return { ...theme, background: `rgba(${r}, ${g}, ${b}, ${alpha})` };
}

export function createTerminalSession({ id, cwd, theme, opacity = 1, claudeSessionId }) {
  let currentTheme = theme;
  let currentOpacity = opacity;

  const term = new Terminal({
    convertEol: true,
    fontSize: 13,
    cursorBlink: true,
    allowTransparency: true,
    theme: themeWithAlpha(theme, opacity),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon(handleLinkClick, { urlRegex }));

  let ptyCols = 80;
  let ptyRows = 24;
  const ready = window.orbit.createTerminal(id, cwd, ptyCols, ptyRows, claudeSessionId);

  let disposed = false;
  let inputDisposable = null;
  let dataUnsubscribe = null;
  let exitUnsubscribe = null;
  let resizeObserver = null;

  // Refit xterm to its container and tell the pty only when the grid size
  // actually changed — every pty resize makes the running program repaint.
  function fitAndSyncPty() {
    fitAddon.fit();
    if (term.cols === ptyCols && term.rows === ptyRows) return;
    ptyCols = term.cols;
    ptyRows = term.rows;
    window.orbit.resizeTerminal(id, ptyCols, ptyRows);
  }

  function freeze(message) {
    inputDisposable?.dispose();
    inputDisposable = null;
    term.write(`\r\n\x1b[90m${message}\x1b[0m\r\n`);
  }

  return {
    ready,

    attach(container, { onExit, hint } = {}) {
      if (disposed) return;

      term.open(container);
      fitAndSyncPty();

      if (hint) {
        term.write(`\x1b[90m${hint}\x1b[0m\r\n`);
      }

      inputDisposable = term.onData((data) => {
        window.orbit.writeToTerminal(id, data);
      });

      dataUnsubscribe = window.orbit.onTerminalData(id, (chunk) => {
        term.write(boldenLinks(chunk));
      });

      exitUnsubscribe = window.orbit.onTerminalExit(id, () => {
        freeze('session ended');
        onExit?.();
      });

      resizeObserver = new ResizeObserver(() => {
        if (disposed) return;
        try {
          fitAndSyncPty();
        } catch {
          // container can be transiently zero-sized during layout churn
        }
      });
      resizeObserver.observe(container);

      term.focus();
    },

    setTheme(nextTheme) {
      currentTheme = nextTheme;
      term.options.theme = themeWithAlpha(currentTheme, currentOpacity);
      term.refresh(0, term.rows - 1);
    },

    setOpacity(nextOpacity) {
      currentOpacity = nextOpacity;
      term.options.theme = themeWithAlpha(currentTheme, currentOpacity);
      term.refresh(0, term.rows - 1);
    },

    forceRedraw() {
      if (disposed) return;
      fitAndSyncPty();
      term.refresh(0, term.rows - 1);
    },

    focus() {
      term.focus();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      dataUnsubscribe?.();
      exitUnsubscribe?.();
      inputDisposable?.dispose();
      term.dispose();
      window.orbit.killTerminal(id);
    },
  };
}

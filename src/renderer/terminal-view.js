// Per-terminal xterm + pty session. Two-phase: create the pty first (so a terminal
// can show a "starting" spinner while spawn is in flight), then attach the
// xterm instance into a DOM container once the caller flips to 'running'.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export function createTerminalSession({ id, cwd, theme }) {
  const term = new Terminal({
    convertEol: true,
    fontSize: 13,
    cursorBlink: true,
    theme,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const ready = window.orbit.createTerminal(id, cwd, 80, 24);

  let disposed = false;
  let inputDisposable = null;
  let dataUnsubscribe = null;
  let exitUnsubscribe = null;
  let resizeObserver = null;

  function freeze(message) {
    inputDisposable?.dispose();
    inputDisposable = null;
    term.write(`\r\n\x1b[90m${message}\x1b[0m\r\n`);
  }

  return {
    ready,

    attach(container, { onExit } = {}) {
      if (disposed) return;

      term.open(container);
      fitAddon.fit();
      window.orbit.resizeTerminal(id, term.cols, term.rows);

      inputDisposable = term.onData((data) => {
        window.orbit.writeToTerminal(id, data);
      });

      dataUnsubscribe = window.orbit.onTerminalData(id, (chunk) => {
        term.write(chunk);
      });

      exitUnsubscribe = window.orbit.onTerminalExit(id, () => {
        freeze('session ended');
        onExit?.();
      });

      resizeObserver = new ResizeObserver(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
          window.orbit.resizeTerminal(id, term.cols, term.rows);
        } catch {
          // container can be transiently zero-sized during layout churn
        }
      });
      resizeObserver.observe(container);

      term.focus();
    },

    setTheme(nextTheme) {
      term.options.theme = nextTheme;
      term.refresh(0, term.rows - 1);
    },

    forceRedraw() {
      fitAddon.fit();
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

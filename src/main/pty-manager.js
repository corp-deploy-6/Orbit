// Owns live pty sessions. One node-pty process per terminal, keyed by sessionId.

import { ipcMain } from 'electron';
import pty from 'node-pty';
import { execSync } from 'node:child_process';

const sessions = new Map(); // sessionId -> IPty

// On Windows, node-pty's conpty backend hands the executable name straight to
// CreateProcess, which (unlike cmd.exe) does not append .exe/.cmd itself —
// 'claude' alone fails with "File not found" even though it's on PATH. Resolve
// the real path once and cache it. Other platforms spawn 'claude' via execvp,
// which already does a proper PATH search.
let resolvedClaudeCmd = null;

function resolveClaudeCommand() {
  if (process.platform !== 'win32') return 'claude';
  if (resolvedClaudeCmd) return resolvedClaudeCmd;
  try {
    const out = execSync('where claude', { encoding: 'utf8' });
    const first = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    resolvedClaudeCmd = first || 'claude.exe';
  } catch {
    resolvedClaudeCmd = 'claude.exe';
  }
  return resolvedClaudeCmd;
}

export function registerPtyHandlers() {
  ipcMain.handle('pty:create', (event, { sessionId, cwd, cols, rows }) => {
    const stale = sessions.get(sessionId);
    if (stale) {
      stale.kill();
      sessions.delete(sessionId);
    }

    let proc;
    try {
      proc = pty.spawn(resolveClaudeCommand(), [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd,
        env: process.env,
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    sessions.set(sessionId, proc);
    const sender = event.sender;

    proc.onData((chunk) => {
      if (sessions.get(sessionId) === proc && !sender.isDestroyed()) {
        sender.send('pty:data', { sessionId, chunk });
      }
    });

    // A replaced or killed pty exits asynchronously; by then its sessionId may
    // belong to a newer pty, which must not be dropped or reported as ended.
    proc.onExit(({ exitCode, signal }) => {
      if (sessions.get(sessionId) !== proc) return;
      sessions.delete(sessionId);
      if (!sender.isDestroyed()) {
        sender.send('pty:exit', { sessionId, exitCode, signal });
      }
    });

    return { ok: true };
  });

  ipcMain.on('pty:write', (event, { sessionId, data }) => {
    const proc = sessions.get(sessionId);
    proc?.write(data);
  });

  ipcMain.on('pty:resize', (event, { sessionId, cols, rows }) => {
    const proc = sessions.get(sessionId);
    if (proc && cols > 0 && rows > 0) {
      try {
        proc.resize(cols, rows);
      } catch {
        // ignore resize races against a just-exited pty
      }
    }
  });

  ipcMain.on('pty:kill', (event, { sessionId }) => {
    const proc = sessions.get(sessionId);
    if (proc) {
      proc.kill();
      sessions.delete(sessionId);
    }
  });
}

export function killAllSessions() {
  for (const proc of sessions.values()) {
    proc.kill();
  }
  sessions.clear();
}

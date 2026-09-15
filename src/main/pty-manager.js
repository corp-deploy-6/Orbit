// Owns live pty sessions. One node-pty process per terminal, keyed by sessionId.

import { ipcMain } from 'electron';
import pty from 'node-pty';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startToolWatch, stopToolWatch, stopAllToolWatches } from './tool-activity-manager.js';

// Tool-activity tracking is a cosmetic add-on (graph node pulses); a failure
// there must never take down a spawn or a kill.
function safely(fn) {
  try {
    fn();
  } catch {
    // degrade to "no pulses"
  }
}

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

// Claude stores transcripts under ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl,
// where the cwd is encoded by replacing every non-alphanumeric character with '-'.
// Undocumented, verified against real paths on this machine.
function encodeProjectDir(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function transcriptExists(cwd, claudeSessionId) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd));
  const transcriptPath = path.join(projectDir, `${claudeSessionId}.jsonl`);
  try {
    return fs.existsSync(transcriptPath);
  } catch {
    // Fail closed: an unresumable id that's still wrongly trusted persists
    // forever and silently retries every restart. Starting fresh is recoverable.
    return false;
  }
}

// Decide fresh-vs-resume and build the pty spawn args + reported claudeSessionId.
function resolveSpawnPlan(cwd, claudeSessionId) {
  if (!claudeSessionId) {
    const id = crypto.randomUUID();
    return { args: ['--session-id', id], claudeSessionId: id, resumed: false };
  }
  if (transcriptExists(cwd, claudeSessionId)) {
    return { args: ['--resume', claudeSessionId], claudeSessionId, resumed: true };
  }
  const id = crypto.randomUUID();
  return { args: ['--session-id', id], claudeSessionId: id, resumed: false };
}

export function registerPtyHandlers() {
  ipcMain.handle('pty:create', (event, { sessionId, cwd, cols, rows, claudeSessionId }) => {
    const stale = sessions.get(sessionId);
    if (stale) {
      stale.kill();
      sessions.delete(sessionId);
      safely(() => stopToolWatch(sessionId));
    }

    if (!cwd || !fs.existsSync(cwd)) {
      return { ok: false, code: 'CWD_MISSING', error: `Directory not found: ${cwd}` };
    }
    try {
      if (!fs.statSync(cwd).isDirectory()) {
        return { ok: false, code: 'CWD_MISSING', error: `Not a directory: ${cwd}` };
      }
    } catch (err) {
      return { ok: false, code: 'CWD_ERROR', error: err.message };
    }

    const plan = resolveSpawnPlan(cwd, claudeSessionId);

    let proc;
    try {
      proc = pty.spawn(resolveClaudeCommand(), plan.args, {
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

    safely(() => startToolWatch({ sessionId, cwd, claudeSessionId: plan.claudeSessionId, sender }));

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
      safely(() => stopToolWatch(sessionId));
      if (!sender.isDestroyed()) {
        sender.send('pty:exit', { sessionId, exitCode, signal });
      }
    });

    return { ok: true, claudeSessionId: plan.claudeSessionId, resumed: plan.resumed };
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
      safely(() => stopToolWatch(sessionId));
    }
  });
}

export function killAllSessions() {
  for (const proc of sessions.values()) {
    proc.kill();
  }
  sessions.clear();
  safely(() => stopAllToolWatches());
}

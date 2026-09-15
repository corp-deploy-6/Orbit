// Persisted terminal session context (JSON file in userData). Cached in memory
// after first read; sync fs calls since this is small and infrequent. Stores an
// opaque array of {cwd, label, claudeSessionId} — live process state and
// scrollback are not restorable, so we don't try.

import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SESSIONS = { sessions: [] };

let cache = null;

function sessionsPath() {
  return path.join(app.getPath('userData'), 'sessions.json');
}

function load() {
  if (cache) return cache;

  try {
    const raw = fs.readFileSync(sessionsPath(), 'utf-8');
    cache = { ...DEFAULT_SESSIONS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULT_SESSIONS };
  }
  return cache;
}

function save() {
  try {
    fs.writeFileSync(sessionsPath(), JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save sessions.json', err);
  }
}

export function getSessions() {
  return load().sessions;
}

export function setSessions(sessions) {
  load();
  cache.sessions = sessions;
  save();
  return cache.sessions;
}

export function registerSessionHandlers() {
  ipcMain.handle('sessions:get', () => getSessions());
  ipcMain.handle('sessions:save', (event, sessions) => setSessions(sessions));
}

// Persisted app settings (JSON file in userData). Cached in memory after
// first read; sync fs calls since this is small and infrequent.

import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SETTINGS = {
  theme: 'orbit-default',
  navOpacity: 1,
  consoleOpacity: 1,
  fileTreeOpacity: 1,
  terminalOpacity: 1,
};

let cache = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (cache) return cache;

  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    cache = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

// Write-then-rename so a crash mid-write can't leave a truncated file behind
// (which load() would silently replace with defaults).
function save() {
  const target = settingsPath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

export function getSettings() {
  return load();
}

export function setSetting(key, value) {
  load();
  cache[key] = value;
  save();
  return cache;
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (event, { key, value }) => setSetting(key, value));
}

// Persisted app settings (JSON file in userData). Cached in memory after
// first read; sync fs calls since this is small and infrequent.

import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SETTINGS = { theme: 'orbit-default' };

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

function save() {
  fs.writeFileSync(settingsPath(), JSON.stringify(cache, null, 2), 'utf-8');
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

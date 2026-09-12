// Live file-tree support: directory listings plus fs.watch-based change
// notifications for the renderer's file-tree panel. One watcher per watched
// directory, keyed by absolute path.

import { ipcMain } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const DEBOUNCE_MS = 200;

async function readDirEntries(dirPath) {
  const dirents = await fsp.readdir(dirPath, { withFileTypes: true });
  const entries = dirents.map((d) => ({
    name: d.name,
    path: `${dirPath.replace(/[\\/]+$/, '')}/${d.name}`,
    isDir: d.isDirectory(),
  }));
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export function registerFsTreeHandlers() {
  const watchers = new Map(); // dirPath -> fs.FSWatcher
  const debounceTimers = new Map(); // dirPath -> Timeout

  function stopWatching(dirPath) {
    const watcher = watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      watchers.delete(dirPath);
    }
    const timer = debounceTimers.get(dirPath);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(dirPath);
    }
  }

  ipcMain.handle('fsTree:readDir', async (event, { dirPath }) => {
    try {
      const entries = await readDirEntries(dirPath);
      return { ok: true, entries };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fsTree:watch', (event, { dirPath }) => {
    if (watchers.has(dirPath)) return { ok: true };

    const sender = event.sender;
    try {
      const watcher = fs.watch(dirPath);
      watchers.set(dirPath, watcher);

      watcher.on('change', () => {
        const existing = debounceTimers.get(dirPath);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          debounceTimers.delete(dirPath);
          if (!sender.isDestroyed()) {
            sender.send('fsTree:changed', { dirPath });
          }
        }, DEBOUNCE_MS);
        debounceTimers.set(dirPath, timer);
      });

      watcher.on('error', () => {
        stopWatching(dirPath);
        if (!sender.isDestroyed()) {
          sender.send('fsTree:invalid', { dirPath });
        }
      });

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('fsTree:unwatch', (event, { dirPath }) => {
    stopWatching(dirPath);
  });

  ipcMain.on('fsTree:unwatchAll', () => {
    for (const dirPath of [...watchers.keys()]) stopWatching(dirPath);
  });
}

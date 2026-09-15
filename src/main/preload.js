import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('orbit', {
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),

  createTerminal: (sessionId, cwd, cols, rows, claudeSessionId) =>
    ipcRenderer.invoke('pty:create', { sessionId, cwd, cols, rows, claudeSessionId }),

  writeToTerminal: (sessionId, data) => ipcRenderer.send('pty:write', { sessionId, data }),

  resizeTerminal: (sessionId, cols, rows) => ipcRenderer.send('pty:resize', { sessionId, cols, rows }),

  killTerminal: (sessionId) => ipcRenderer.send('pty:kill', { sessionId }),

  onTerminalData: (sessionId, callback) => {
    const listener = (event, payload) => {
      if (payload.sessionId === sessionId) callback(payload.chunk);
    };
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },

  onTerminalExit: (sessionId, callback) => {
    const listener = (event, payload) => {
      if (payload.sessionId === sessionId) callback(payload);
    };
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),

  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),

  readDir: (dirPath) => ipcRenderer.invoke('fsTree:readDir', { dirPath }),

  watchDir: (dirPath) => ipcRenderer.invoke('fsTree:watch', { dirPath }),

  unwatchDir: (dirPath) => ipcRenderer.send('fsTree:unwatch', { dirPath }),

  unwatchAllDirs: () => ipcRenderer.send('fsTree:unwatchAll'),

  onDirChanged: (callback) => {
    const listener = (event, payload) => callback(payload.dirPath);
    ipcRenderer.on('fsTree:changed', listener);
    return () => ipcRenderer.removeListener('fsTree:changed', listener);
  },

  onDirInvalid: (callback) => {
    const listener = (event, payload) => callback(payload.dirPath);
    ipcRenderer.on('fsTree:invalid', listener);
    return () => ipcRenderer.removeListener('fsTree:invalid', listener);
  },

  getSessions: () => ipcRenderer.invoke('sessions:get'),

  saveSessions: (sessions) => ipcRenderer.invoke('sessions:save', sessions),

  getUsage: (sessionId, cwd) => ipcRenderer.invoke('usage:get', { sessionId, cwd }),

  resetUsage: (sessionId, cwd) => ipcRenderer.invoke('usage:reset', { sessionId, cwd }),

  confirmOpenLink: (url) => ipcRenderer.invoke('shell:confirmOpenLink', url),
});

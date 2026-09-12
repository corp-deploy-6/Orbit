import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('orbit', {
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),

  createTile: (sessionId, cwd, cols, rows) =>
    ipcRenderer.invoke('pty:create', { sessionId, cwd, cols, rows }),

  writeToTile: (sessionId, data) => ipcRenderer.send('pty:write', { sessionId, data }),

  resizeTile: (sessionId, cols, rows) => ipcRenderer.send('pty:resize', { sessionId, cols, rows }),

  killTile: (sessionId) => ipcRenderer.send('pty:kill', { sessionId }),

  onTileData: (sessionId, callback) => {
    const listener = (event, payload) => {
      if (payload.sessionId === sessionId) callback(payload.chunk);
    };
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },

  onTileExit: (sessionId, callback) => {
    const listener = (event, payload) => {
      if (payload.sessionId === sessionId) callback(payload);
    };
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),

  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
});

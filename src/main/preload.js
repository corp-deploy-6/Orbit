import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('orbit', {
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),

  createTerminal: (sessionId, cwd, cols, rows) =>
    ipcRenderer.invoke('pty:create', { sessionId, cwd, cols, rows }),

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
});

import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerPtyHandlers, killAllSessions } from './pty-manager.js';
import { registerDialogHandlers } from './dialog-manager.js';
import { registerSettingsHandlers } from './settings-store.js';
import { registerSessionHandlers } from './session-store.js';
import { registerUsageHandlers } from './usage-tracker.js';
import { registerShellHandlers } from './shell-manager.js';
import { registerGraftGraphHandlers } from './graft-graph-manager.js';
import { stopAllToolWatches } from './tool-activity-manager.js';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const { webContents } = mainWindow;

  // ptys and tool watches only serve the loaded page; drop them on reload
  // (e.g. a Vite full reload in dev) or renderer crash so they don't pile up.
  // The renderer starts from empty state after either event and can't reattach
  // to a pty it no longer knows the id of, so leaving old ptys running just
  // orphans them (worse, restored sessions then spawn a second claude in the
  // same folder).
  webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) {
      killAllSessions();
      stopAllToolWatches();
    }
  });
  webContents.on('render-process-gone', () => {
    killAllSessions();
    stopAllToolWatches();
  });

  // The app never opens pages; block popups and navigation away from the app
  // (e.g. a file dropped onto the window would replace the whole UI).
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event) => {
    if (event.url !== webContents.getURL()) event.preventDefault();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (process.env.ORBIT_DEVTOOLS === '1') {
    webContents.openDevTools();
  }
};

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerPtyHandlers();
  registerDialogHandlers();
  registerSettingsHandlers();
  registerSessionHandlers();
  registerUsageHandlers();
  registerShellHandlers();
  registerGraftGraphHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killAllSessions();
  stopAllToolWatches();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

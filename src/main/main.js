import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerPtyHandlers, killAllSessions } from './pty-manager.js';
import { registerDialogHandlers } from './dialog-manager.js';
import { registerSettingsHandlers } from './settings-store.js';
import { registerFsTreeHandlers, unwatchAllDirs } from './fs-tree-manager.js';
import { registerSessionHandlers } from './session-store.js';

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

  // fs watchers and ptys only serve the loaded page; drop them on reload (e.g.
  // a Vite full reload in dev) or renderer crash so they don't pile up. The
  // renderer starts from empty state after either event and can't reattach to
  // a pty it no longer knows the id of, so leaving old ptys running just
  // orphans them (worse, restored sessions then spawn a second claude in the
  // same folder). Kill them alongside the fs watchers.
  webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) {
      unwatchAllDirs();
      killAllSessions();
    }
  });
  webContents.on('render-process-gone', () => {
    unwatchAllDirs();
    killAllSessions();
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
  registerFsTreeHandlers();
  registerSessionHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  killAllSessions();
  unwatchAllDirs();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

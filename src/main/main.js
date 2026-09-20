import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerPtyHandlers, killAllSessions } from './pty-manager.js';
import { registerDialogHandlers } from './dialog-manager.js';
import { registerSettingsHandlers } from './settings-store.js';
import { registerSessionHandlers } from './session-store.js';
import { registerShellHandlers } from './shell-manager.js';
import { registerGraftGraphHandlers } from './graft-graph-manager.js';
import { stopAllToolWatches } from './tool-activity-manager.js';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // TEMPORARY: width pinned to the 936px the full 12-key F-bar needs so its
  // labels never truncate while we eyeball the bar. useContentSize makes 936
  // the renderer's width rather than the outer frame's; minWidth/maxWidth are
  // frame sizes in Electron and would clamp the content narrower, so the size
  // is held with resizable: false instead. Drop these three to go back to a
  // resizable window.
  const mainWindow = new BrowserWindow({
    width: 936,
    height: 700,
    useContentSize: true,
    resizable: false,
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
    // Mirror the renderer console into the main process stdout, so a dev run
    // started from a terminal shows renderer errors without the devtools
    // window in front of you.
    webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[renderer] ${message}  (${sourceId}:${line})`);
    });
  }
};

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerPtyHandlers();
  registerDialogHandlers();
  registerSettingsHandlers();
  registerSessionHandlers();
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

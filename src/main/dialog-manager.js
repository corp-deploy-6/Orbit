// Native folder picker used per-terminal to choose the pty's working directory.

import { ipcMain, dialog } from 'electron';
import os from 'node:os';

export function registerDialogHandlers() {
  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: os.homedir(),
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
}

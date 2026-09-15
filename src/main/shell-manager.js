// Links clicked in a terminal pane never open directly — this confirms with the
// user first, then only opens http(s) URLs (rejecting javascript:, file:, etc.)
// so a malicious/odd pty output can't trigger arbitrary shell.openExternal calls.

import { ipcMain, dialog, shell, BrowserWindow } from 'electron';

export function registerShellHandlers() {
  ipcMain.handle('shell:confirmOpenLink', async (event, url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Yes', 'No'],
      defaultId: 0,
      cancelId: 1,
      message: 'Open URL?',
      detail: url,
    });

    if (response !== 0) {
      return false;
    }

    await shell.openExternal(url);
    return true;
  });
}

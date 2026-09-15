// Reads Orbit's own graft-generated repo graph (graft/.graph/wiring.json) for
// the renderer's Graph panel. Scoped to this repo checkout only — v1 does not
// generalize to other project directories.

import { app, ipcMain } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function registerGraftGraphHandlers() {
  ipcMain.handle('graftGraph:get', async () => {
    const graphPath = path.join(app.getAppPath(), 'graft', '.graph', 'wiring.json');
    try {
      const raw = await fsp.readFile(graphPath, 'utf-8');
      const { nodes, edges } = JSON.parse(raw);
      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        return { ok: false, error: 'wiring.json has unexpected shape' };
      }
      return { ok: true, nodes, edges };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

// Reads Orbit's own graft-generated repo graph (graft/.graph/wiring.json) for
// the renderer's Graph panel. Scoped to this repo checkout only — v1 does not
// generalize to other project directories.

import { app, ipcMain } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';

// The checkout the graph describes. Shared with tool-activity-manager so
// touched-file paths are relativized against exactly the root the graph's node
// paths are relative to. In a packaged build this is the asar path, so nothing
// resolves into it — matching the panel's dev/own-repo-only scope.
export function graphRepoRoot() {
  return app.getAppPath();
}

export function registerGraftGraphHandlers() {
  ipcMain.handle('graftGraph:get', async () => {
    const graphPath = path.join(graphRepoRoot(), 'graft', '.graph', 'wiring.json');
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

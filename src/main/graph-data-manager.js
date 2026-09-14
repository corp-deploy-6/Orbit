// Reads graphify's generated knowledge graph (<cwd>/graphify-out/graph.json)
// for the renderer's graph panel, and resolves node source files to open them
// on disk. One-shot reads (no live watch, unlike fs-tree-manager) — the graph
// panel re-reads on each activation instead.

import { ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const GRAPH_RELATIVE_PATH = ['graphify-out', 'graph.json'];

function graphPath(cwd) {
  return path.join(cwd, ...GRAPH_RELATIVE_PATH);
}

// Resolves a graph-reported source file against cwd, refusing anything that
// escapes cwd (defensive: graph.json is regenerable/untrusted-ish local data).
function resolveWithinCwd(cwd, relPath) {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export function registerGraphDataHandlers() {
  ipcMain.handle('graphData:read', async (event, { cwd }) => {
    try {
      const raw = await fs.readFile(graphPath(cwd), 'utf-8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return { ok: false, error: `Malformed graph.json: ${err.message}` };
      }
      const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      const links = Array.isArray(parsed.links) ? parsed.links : [];
      return { ok: true, nodes, links };
    } catch (err) {
      if (err.code === 'ENOENT') return { ok: false, reason: 'not-found' };
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphData:openSource', async (event, { cwd, sourceFile }) => {
    if (!cwd || !sourceFile) return { ok: false, error: 'Missing cwd or sourceFile' };
    const resolved = resolveWithinCwd(cwd, sourceFile);
    if (!resolved) return { ok: false, error: 'Path escapes project folder' };

    try {
      const err = await shell.openPath(resolved);
      if (err) return { ok: false, error: err };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

// Reads Claude Code's own local session transcripts (JSONL, under
// ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl) to report cumulative
// session cost for a terminal pane. Purely read-only: never touches the pty
// lifecycle, only looks at files Claude Code already writes on disk.

import { ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Transcripts can grow to tens of MB over a long session; only the tail has
// the most recent usage/cost data we care about.
const TAIL_BYTES = 300 * 1024;

// Once a pane's transcript file is confirmed to actually contain usage data,
// stick with it for the life of that pane (a pane keeps running the same
// `claude` process, so it keeps writing the same file). Avoids flapping
// between candidate files when a cwd has several session transcripts.
//
// Keyed by `${cwd}::${sessionId}` rather than bare sessionId: sessionId is
// the renderer's own local auto-incrementing pane id, which resets to
// 1, 2, 3... on every renderer reload/restore, so a bare id can otherwise
// collide with a stale claim from a previous (now-dead) session — even one
// in a different cwd. Composite keying prevents the cross-cwd collision;
// resetClaim() (called on every real pty spawn) handles the same-cwd,
// reused-id case by dropping any stale claim before it can be reused.
const claimedFiles = new Map(); // `${cwd}::${sessionId}` -> filePath

// When a pane's pty was (re)spawned, so candidate transcript files that
// predate it can be deprioritized in favor of the pane's own file.
const spawnTimes = new Map(); // `${cwd}::${sessionId}` -> timestamp (ms)

function keyFor(sessionId, cwd) {
  return `${cwd}::${sessionId}`;
}

// Claude Code encodes a project's absolute path into its transcript
// directory name by replacing every non-alphanumeric character with '-'.
function projectDirFor(cwd) {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function readTail(filePath) {
  const { size } = fs.statSync(filePath);
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const length = size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString('utf8').split('\n');
    // The tail read may start mid-line; drop the (possibly partial) first line.
    if (start > 0) lines.shift();
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

function extractUsage(filePath) {
  const lines = readTail(filePath);

  let costUSD = null;

  for (let i = lines.length - 1; i >= 0 && costUSD === null; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'cost-state' && typeof entry.totalCostUSD === 'number') {
      costUSD = entry.totalCostUSD;
    }
  }

  if (costUSD === null) return null;
  return { costUSD };
}

// Resolves a pane's usage, locking onto a transcript file only once it's been
// proven to actually hold usage data. Until then, re-resolves candidates on
// every call rather than committing to a mtime-based guess that might be a
// stale file from an earlier session in the same cwd.
function resolveUsage(sessionId, cwd) {
  const key = keyFor(sessionId, cwd);

  const cachedFile = claimedFiles.get(key);
  if (cachedFile) {
    if (fs.existsSync(cachedFile)) return extractUsage(cachedFile);
    claimedFiles.delete(key);
  }

  const dir = projectDirFor(cwd);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const claimedElsewhere = new Set(
    [...claimedFiles.entries()].filter(([k]) => k !== key).map(([, file]) => file)
  );

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const full = path.join(dir, entry.name);
    if (claimedElsewhere.has(full)) continue;
    try {
      candidates.push({ full, mtimeMs: fs.statSync(full).mtimeMs });
    } catch {
      // file could vanish between readdir and stat; skip it
    }
  }
  if (!candidates.length) return null;

  // Prefer files touched since this pane's pty was (re)spawned — the pane's
  // own transcript — over an old file from an earlier session in the same
  // cwd that merely happens to be the most recently modified overall.
  const spawnTime = spawnTimes.get(key) ?? 0;
  const afterSpawn = candidates.filter((c) => c.mtimeMs >= spawnTime);
  const ordered = (afterSpawn.length ? afterSpawn : candidates).sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of ordered) {
    const usage = extractUsage(candidate.full);
    if (usage) {
      claimedFiles.set(key, candidate.full);
      return usage;
    }
  }
  // Nothing found has usable usage data yet — don't lock in a guess; try
  // again fresh on the next poll.
  return null;
}

// Called whenever a pane actually spawns a fresh pty (initial creation or a
// respawn after reload/restore). Drops any stale claim for this pane id so a
// reused renderer-local id can't inherit a previous, unrelated session's
// transcript, and records the spawn time so resolveUsage can prefer files
// written after it.
function resetClaim(sessionId, cwd) {
  const key = keyFor(sessionId, cwd);
  claimedFiles.delete(key);
  spawnTimes.set(key, Date.now());
}

export function registerUsageHandlers() {
  ipcMain.handle('usage:get', (event, { sessionId, cwd }) => {
    if (!sessionId || !cwd) return null;
    try {
      return resolveUsage(String(sessionId), cwd);
    } catch {
      return null;
    }
  });

  ipcMain.handle('usage:reset', (event, { sessionId, cwd }) => {
    if (!sessionId || !cwd) return false;
    try {
      resetClaim(String(sessionId), cwd);
      return true;
    } catch {
      return false;
    }
  });
}

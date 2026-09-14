// Reads Claude Code's own local session transcripts (JSONL, under
// ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl) to report approximate
// token/cost usage for a terminal pane. Purely read-only: never touches the
// pty lifecycle, only looks at files Claude Code already writes on disk.

import { ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Claude models currently top out at a 200k-token context window. Good enough
// as a fixed reference point for a lightweight indicator.
const CONTEXT_WINDOW = 200000;

// Transcripts can grow to tens of MB over a long session; only the tail has
// the most recent usage/cost data we care about.
const TAIL_BYTES = 300 * 1024;

// Once a pane's Orbit sessionId is matched to a transcript file, stick with
// it for the life of that pane (a pane keeps running the same `claude`
// process, so it keeps writing the same file). Avoids flapping between
// candidate files when a cwd has several session transcripts.
const claimedFiles = new Map(); // sessionId -> filePath

// Claude Code encodes a project's absolute path into its transcript
// directory name by replacing every non-alphanumeric character with '-'.
function projectDirFor(cwd) {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function pickTranscriptFile(sessionId, cwd) {
  const cached = claimedFiles.get(sessionId);
  if (cached && fs.existsSync(cached)) return cached;
  if (cached) claimedFiles.delete(sessionId);

  const dir = projectDirFor(cwd);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const claimedElsewhere = new Set(
    [...claimedFiles.entries()].filter(([id]) => id !== sessionId).map(([, file]) => file)
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

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const best = candidates[0].full;
  claimedFiles.set(sessionId, best);
  return best;
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

  let contextTokens = null;
  let costUSD = null;

  for (let i = lines.length - 1; i >= 0 && (contextTokens === null || costUSD === null); i--) {
    const line = lines[i].trim();
    if (!line) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (contextTokens === null && entry.type === 'assistant' && entry.message?.usage) {
      const u = entry.message.usage;
      const total =
        (u.input_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.output_tokens || 0);
      if (total > 0) contextTokens = total;
    }

    if (costUSD === null && entry.type === 'cost-state' && typeof entry.totalCostUSD === 'number') {
      costUSD = entry.totalCostUSD;
    }
  }

  if (contextTokens === null) return null;
  return { contextTokens, contextWindow: CONTEXT_WINDOW, costUSD };
}

export function registerUsageHandlers() {
  ipcMain.handle('usage:get', (event, { sessionId, cwd }) => {
    if (!sessionId || !cwd) return null;
    try {
      const file = pickTranscriptFile(String(sessionId), cwd);
      if (!file) return null;
      return extractUsage(file);
    } catch {
      return null;
    }
  });
}

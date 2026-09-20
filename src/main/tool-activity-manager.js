// Tails a live pane's Claude Code transcript and reports which repo files the
// session just touched, so the renderer can pulse the matching graph nodes.
//
// Polls rather than fs.watch: a fresh session's transcript doesn't exist yet
// when the pty spawns, and polling handles not-yet-created / appended /
// truncated with one code path. Purely read-only — never touches the pty.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { graphRepoRoot } from './graft-graph-manager.js';

const POLL_MS = 750;

const watches = new Map(); // sessionId -> watch state

// Same encoding as pty-manager's encodeProjectDir: every non-alphanumeric
// character in the absolute cwd becomes '-'.
function transcriptPathFor(cwd, claudeSessionId) {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded, `${claudeSessionId}.jsonl`);
}

// Returns the complete lines appended since the last poll. The trailing partial
// line is carried over as raw bytes (not a string) so a multi-byte character
// split across two reads still decodes correctly.
function readNewLines(watch) {
  let size;
  try {
    ({ size } = fs.statSync(watch.transcriptPath));
  } catch {
    return []; // not created yet, or removed
  }

  if (size < watch.offset) {
    watch.offset = 0;
    watch.remainder = Buffer.alloc(0);
  }
  if (size === watch.offset) return [];

  const length = size - watch.offset;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(watch.transcriptPath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, watch.offset);
  } finally {
    fs.closeSync(fd);
  }
  watch.offset = size;

  const text = Buffer.concat([watch.remainder, buffer]);
  const lastBreak = text.lastIndexOf(0x0a);
  if (lastBreak === -1) {
    watch.remainder = text;
    return [];
  }
  watch.remainder = text.subarray(lastBreak + 1);
  return text.subarray(0, lastBreak).toString('utf8').split('\n');
}

function touchedPathsIn(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  const content = entry?.message?.content;
  if (entry.type !== 'assistant' || !Array.isArray(content)) return [];

  const found = [];
  for (const block of content) {
    if (block?.type !== 'tool_use') continue;
    const touched = block.input?.file_path ?? block.input?.notebook_path;
    if (typeof touched === 'string' && touched) found.push(touched);
  }
  return found;
}

// Absolute (or cwd-relative) path -> repo-relative POSIX, matching the `path`
// field on wiring.json nodes. Anything outside the graph's repo is dropped.
function toRepoRelative(touched, cwd, root) {
  const abs = path.resolve(cwd, touched);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function poll(sessionId, watch) {
  if (watch.sender.isDestroyed()) {
    stopToolWatch(sessionId);
    return;
  }

  const lines = readNewLines(watch);
  if (!lines.length) return;

  const root = graphRepoRoot();
  const paths = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    for (const touched of touchedPathsIn(line)) {
      const rel = toRepoRelative(touched, watch.cwd, root);
      if (rel) paths.add(rel);
    }
  }
  if (!paths.size) return;

  watch.sender.send('toolActivity:file', { sessionId, paths: [...paths] });
}

export function startToolWatch({ sessionId, cwd, claudeSessionId, sender }) {
  stopToolWatch(sessionId);
  if (!cwd || !claudeSessionId || !sender) return;

  const transcriptPath = transcriptPathFor(cwd, claudeSessionId);

  // Seed the offset at the current end of file: a resumed session's transcript
  // already holds its whole history, and replaying it would strobe the graph.
  let offset = 0;
  try {
    offset = fs.statSync(transcriptPath).size;
  } catch {
    offset = 0; // not written yet — a fresh session starts empty anyway
  }

  const watch = { transcriptPath, cwd, sender, offset, remainder: Buffer.alloc(0), timer: null };
  watch.timer = setInterval(() => {
    try {
      poll(sessionId, watch);
    } catch {
      // a transient read/parse failure just means no pulses this tick
    }
  }, POLL_MS);

  watches.set(sessionId, watch);
}

export function stopToolWatch(sessionId) {
  const watch = watches.get(sessionId);
  if (!watch) return;
  clearInterval(watch.timer);
  watches.delete(sessionId);
}

export function stopAllToolWatches() {
  for (const watch of watches.values()) clearInterval(watch.timer);
  watches.clear();
}

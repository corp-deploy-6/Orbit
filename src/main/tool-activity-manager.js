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

// graft's own MCP tool names, and the CLI verbs when invoked via Bash/PowerShell.
const GRAFT_MCP_NAME_RE = /^mcp__graft__graft_(find_code|find_all|file_api|repo_map|trace_calls)$/;
const GRAFT_CLI_RE = /\bgraft\s+(ask|grep|callers|skeleton|map)\b/;

// A repo-relative-looking path, forward- or back-slashed, with an optional
// trailing "L12" / "L12-L34" line reference (graft's format) that the char
// class itself excludes by not containing ':'.
const PATH_CANDIDATE_RE = /[\w./\\-]+\.(?:js|mjs|cjs|css|html|json|md)\b/g;

// True for a tool_use whose result is worth mining for file paths that the
// agent surfaced without directly editing (a graft query, or a Grep/Glob).
function isQueryToolUse(block) {
  if (GRAFT_MCP_NAME_RE.test(block.name)) return true;
  if ((block.name === 'Bash' || block.name === 'PowerShell') && GRAFT_CLI_RE.test(block.input?.command || '')) {
    return true;
  }
  return block.name === 'Grep' || block.name === 'Glob';
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((block) => block?.text || '').join('\n');
  return '';
}

// Raw (not yet repo-relativized) steps found in one transcript line, in
// document order. `pendingQueryIds` is the per-session set of tool_use ids
// awaiting their tool_result, mutated in place: an assistant line adds to it,
// the matching user/tool_result line consumes from it. A step from a query
// result carries every path candidate found in that one result as one step,
// since they were surfaced together, not touched in sequence.
function stepsInLine(line, pendingQueryIds) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];

  if (entry.type === 'assistant') {
    const steps = [];
    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      const touched = block.input?.file_path ?? block.input?.notebook_path;
      if (typeof touched === 'string' && touched) {
        steps.push({ kind: 'touch', paths: [touched] });
        continue;
      }
      if (isQueryToolUse(block)) pendingQueryIds.add(block.id);
    }
    return steps;
  }

  if (entry.type === 'user') {
    const steps = [];
    for (const block of content) {
      if (block?.type !== 'tool_result' || !pendingQueryIds.has(block.tool_use_id)) continue;
      pendingQueryIds.delete(block.tool_use_id);
      const paths = resultText(block.content).match(PATH_CANDIDATE_RE) || [];
      if (paths.length) steps.push({ kind: 'query', paths });
    }
    return steps;
  }

  return [];
}

function sameFileList(a, b) {
  return a.length === b.length && a.every((file, i) => file === b[i]);
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
  const steps = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    for (const raw of stepsInLine(line, watch.pendingQueryIds)) {
      const files = [...new Set(raw.paths.map((p) => toRepoRelative(p, watch.cwd, root)).filter(Boolean))];
      if (!files.length) continue;
      const prev = steps[steps.length - 1];
      if (prev && prev.kind === raw.kind && sameFileList(prev.files, files)) continue;
      steps.push({ kind: raw.kind, files });
    }
  }
  if (!steps.length) return;

  watch.sender.send('toolActivity:file', { sessionId, steps });
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

  const watch = {
    transcriptPath,
    cwd,
    sender,
    offset,
    remainder: Buffer.alloc(0),
    timer: null,
    pendingQueryIds: new Set(),
  };
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

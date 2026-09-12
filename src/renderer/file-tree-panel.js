// Live right-side file-tree panel. Mirrors the active terminal's cwd, using
// fs.watch (via main process) to stay in sync as files change on disk.

let treeRootEl = null;
let currentCwd = null;
const expanded = new Set(); // path -> expanded
const childrenCache = new Map(); // path -> entries
const invalidPaths = new Set(); // path -> marked invalid (root or subdir)

function isWithinTree(path) {
  if (!currentCwd) return false;
  if (path === currentCwd) return true;
  return expanded.has(path);
}

function clearState() {
  expanded.clear();
  childrenCache.clear();
  invalidPaths.clear();
}

function dropDescendants(path) {
  const prefix = path.replace(/[\\/]+$/, '') + '/';
  for (const p of [...expanded]) {
    if (p.startsWith(prefix)) {
      expanded.delete(p);
      childrenCache.delete(p);
      invalidPaths.delete(p);
    }
  }
}

async function toggleExpand(path) {
  if (expanded.has(path)) {
    window.orbit.unwatchDir(path);
    expanded.delete(path);
    childrenCache.delete(path);
    dropDescendants(path);
    renderTree();
    return;
  }

  const result = await window.orbit.readDir(path);
  if (!result?.ok) {
    invalidPaths.add(path);
    renderTree();
    return;
  }
  childrenCache.set(path, result.entries);
  expanded.add(path);
  renderTree();

  const watchResult = await window.orbit.watchDir(path);
  if (!watchResult?.ok && expanded.has(path)) {
    invalidPaths.add(path);
    renderTree();
  }
}

function renderRow(entry, depth) {
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${depth * 16 + 8}px`;

  if (entry.isDir) {
    const caret = document.createElement('span');
    caret.className = 'tree-caret';
    caret.textContent = expanded.has(entry.path) ? '▾' : '▸';
    row.appendChild(caret);
    row.classList.add('tree-row-dir');
    row.addEventListener('click', () => toggleExpand(entry.path));
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'tree-caret tree-caret-none';
    row.appendChild(spacer);
  }

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = entry.name;
  row.appendChild(label);

  if (invalidPaths.has(entry.path)) {
    row.classList.add('tree-row-invalid');
    const err = document.createElement('span');
    err.className = 'tree-error-text';
    err.textContent = 'not found';
    row.appendChild(err);
  }

  return row;
}

function renderEntries(container, entries, depth) {
  for (const entry of entries) {
    const row = renderRow(entry, depth);
    container.appendChild(row);

    if (entry.isDir && expanded.has(entry.path)) {
      const children = childrenCache.get(entry.path);
      if (children) {
        renderEntries(container, children, depth + 1);
      }
    }
  }
}

function renderTree() {
  if (!treeRootEl) return;
  treeRootEl.innerHTML = '';

  if (!currentCwd) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty-text';
    empty.textContent = 'No folder selected';
    treeRootEl.appendChild(empty);
    return;
  }

  if (invalidPaths.has(currentCwd)) {
    const err = document.createElement('div');
    err.className = 'tree-error-text tree-root-error';
    err.textContent = 'Directory not found';
    treeRootEl.appendChild(err);
    return;
  }

  const rootEntries = childrenCache.get(currentCwd) || [];
  renderEntries(treeRootEl, rootEntries, 0);
}

async function refreshDir(path) {
  const result = await window.orbit.readDir(path);
  if (!isWithinTree(path)) return; // stale event, tree moved on
  if (!result?.ok) {
    invalidPaths.add(path);
    renderTree();
    return;
  }
  childrenCache.set(path, result.entries);
  renderTree();
}

function handleDirChanged(path) {
  if (!isWithinTree(path)) return;
  refreshDir(path);
}

function handleDirInvalid(path) {
  if (!isWithinTree(path)) return;

  if (path === currentCwd) {
    invalidPaths.add(path);
    renderTree();
    return;
  }

  invalidPaths.add(path);
  expanded.delete(path);
  childrenCache.delete(path);
  dropDescendants(path);
  renderTree();
}

export function setActiveCwd(cwd) {
  window.orbit.unwatchAllDirs();
  clearState();

  if (!cwd) {
    currentCwd = null;
    renderTree();
    return;
  }

  currentCwd = cwd;
  renderTree();

  (async () => {
    const result = await window.orbit.readDir(cwd);
    if (currentCwd !== cwd) return; // switched again before this resolved
    if (!result?.ok) {
      invalidPaths.add(cwd);
      renderTree();
      return;
    }
    childrenCache.set(cwd, result.entries);
    renderTree();

    const watchResult = await window.orbit.watchDir(cwd);
    if (currentCwd !== cwd) return; // switched again before this resolved
    if (!watchResult?.ok) {
      invalidPaths.add(cwd);
      renderTree();
    }
  })();
}

export function renderFileTreePanel(container) {
  container.innerHTML = '';
  container.className = 'file-tree-panel';

  const header = document.createElement('div');
  header.className = 'file-tree-header';
  header.textContent = 'Files';

  treeRootEl = document.createElement('div');
  treeRootEl.className = 'file-tree-root';

  container.appendChild(header);
  container.appendChild(treeRootEl);

  window.orbit.onDirChanged(handleDirChanged);
  window.orbit.onDirInvalid(handleDirInvalid);

  renderTree();
}

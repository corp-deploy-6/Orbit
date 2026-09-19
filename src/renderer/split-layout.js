// Pure split-tree data model: no DOM, no tile lifecycle. A tree of tile ids
// arranged for nested-flex rendering (console-panel.js owns the DOM side).
//
// leaf:  { type: 'leaf', tileId }
// split: { type: 'split', direction: 'row'|'column', children: [node, node], sizes: [a, b] }
//
// Every function here returns a new tree along the path that changed and
// reuses untouched subtrees as-is, so console-panel.js can diff old vs. new
// root by reference to know whether the DOM needs restructuring.

export function createLeaf(tileId) {
  return { type: 'leaf', tileId };
}

function createSplit(direction, children, sizes = [0.5, 0.5]) {
  return { type: 'split', direction, children, sizes };
}

// Inserts newTileId next to targetTileId. `side` is the raw edge-affordance
// side ('top'|'right'|'bottom'|'left'): top/bottom split the target's leaf
// into a column, left/right into a row; top/left place the new leaf first.
export function insertNode(root, targetTileId, side, newTileId) {
  const direction = side === 'left' || side === 'right' ? 'row' : 'column';
  const before = side === 'top' || side === 'left';
  const newLeaf = createLeaf(newTileId);

  function go(node) {
    if (node.type === 'leaf') {
      if (node.tileId !== targetTileId) return node;
      return createSplit(direction, before ? [newLeaf, node] : [node, newLeaf]);
    }
    const [a, b] = node.children;
    const nextA = go(a);
    if (nextA !== a) return { ...node, children: [nextA, b] };
    const nextB = go(b);
    if (nextB !== b) return { ...node, children: [a, nextB] };
    return node;
  }

  if (!root) return newLeaf;
  return go(root);
}

// Removes tileId's leaf. A split left with only one child collapses into
// that child (sibling promotion) rather than leaving a degenerate node.
export function removeNode(root, tileId) {
  function go(node) {
    if (!node) return null;
    if (node.type === 'leaf') return node.tileId === tileId ? null : node;
    const [a, b] = node.children;
    const nextA = go(a);
    const nextB = nextA === a ? go(b) : b;
    if (nextA === a && nextB === b) return node;
    if (nextA === null) return nextB;
    if (nextB === null) return nextA;
    return { ...node, children: [nextA, nextB] };
  }
  return go(root);
}

// Deterministically rebuilds a tree from flat tile-id order: sequential
// right/bottom chain, alternating direction at each level. Used whenever the
// tree is derived rather than incrementally edited (mode switch, restore) —
// see issue #66 decision to never persist tree shape.
export function buildFromOrder(tileIds) {
  if (!tileIds.length) return null;

  function chain(ids, direction) {
    if (ids.length === 1) return createLeaf(ids[0]);
    const nextDirection = direction === 'row' ? 'column' : 'row';
    return createSplit(direction, [createLeaf(ids[0]), chain(ids.slice(1), nextDirection)]);
  }

  return chain(tileIds, 'row');
}

// Left-to-right / top-to-bottom tile id order, inverse of buildFromOrder.
export function flattenOrder(root) {
  if (!root) return [];
  if (root.type === 'leaf') return [root.tileId];
  return [...flattenOrder(root.children[0]), ...flattenOrder(root.children[1])];
}

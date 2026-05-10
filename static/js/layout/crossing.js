/**
 * Sugiyama Phase 3: layer building, dummy-node insertion, crossing minimisation.
 *
 * This module assumes the graph is already a DAG with integer `_rank`
 * properties on every node (set by ranking.js).
 *
 * Step 1 — buildLayers
 *   Group nodes by rank into an array-of-arrays.  Initial intra-layer
 *   order is insertion order (stable across repeated calls).
 *
 * Step 2 — insertDummyNodes
 *   Any edge whose endpoints span more than one rank is replaced by a
 *   chain of unit-length edges passing through new dummy nodes.  Each
 *   dummy node gets `_dummy = true` on the LayoutNode.  Each synthetic
 *   edge gets `_originalEdge = <original edge id>` so the renderer can
 *   route splines back along the chain.  The original edge is removed
 *   from the graph.
 *
 * Step 3 — minimizeCrossings
 *   Iterative median heuristic + transpose sweep:
 *     • Down-sweep (layer 0 → max): sort each layer by median position
 *       of predecessor neighbours in the layer above.
 *     • Up-sweep (layer max → 0): sort each layer by median position
 *       of successor neighbours in the layer below.
 *     • Transpose pass: for each layer, swap adjacent node pairs if
 *       the swap strictly reduces crossing count with both neighbours.
 *   Sweeps repeat for `iterations` rounds (default 4).
 *
 * Crossing count between two adjacent layers is computed with the
 * bilayer-sweep algorithm: O(|E| log |nodes|).
 *
 * Usage (browser + Node.js via vm.runInThisContext):
 *   var declarations hoist to global.
 *
 * Dependencies: layout/graph.js and layout/ranking.js must load first.
 */

// ── Layer building ────────────────────────────────────────────────────────────

/**
 * Group every node in `graph` into layers by its `_rank` property.
 *
 * @param {LayoutGraph} graph
 * @returns {string[][]}  layers[r] = array of node ids at rank r,
 *                        in graph insertion order.
 */
var buildLayers = function buildLayers(graph) {
  let maxRank = 0;
  for (const id of graph.nodeIds) {
    const r = graph.node(id)._rank ?? 0;
    if (r > maxRank) maxRank = r;
  }

  /** @type {string[][]} */
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of graph.nodeIds) {
    layers[graph.node(id)._rank ?? 0].push(id);
  }
  return layers;
};


// ── Dummy node insertion ──────────────────────────────────────────────────────

let _dummySeq = 0;

/**
 * Split every edge that spans more than one rank by inserting dummy nodes.
 *
 * After this call every edge in `graph` connects nodes whose ranks differ
 * by exactly 1.  The `layers` array is mutated in-place: dummy node ids
 * are appended to the appropriate layer sub-arrays.
 *
 * Properties set on dummy nodes / edges:
 *   LayoutNode._dummy        = true
 *   LayoutEdge._originalEdge = id of the edge that was split
 *
 * @param {LayoutGraph} graph   Modified in-place.
 * @param {string[][]}  layers  Modified in-place.
 * @returns {string[]}          Ids of dummy nodes that were created.
 */
var insertDummyNodes = function insertDummyNodes(graph, layers) {
  const dummies = [];

  // Snapshot edge ids — we'll be adding/removing edges while iterating.
  for (const eid of [...graph.edgeIds]) {
    const e    = graph.edge(eid);
    if (!e) continue;                    // already removed (shouldn't happen)
    const srcRank = graph.node(e.source)._rank;
    const tgtRank = graph.node(e.target)._rank;
    const span    = tgtRank - srcRank;

    if (span <= 1) continue;            // already a unit edge (or reversed)

    const origId = eid;
    // Remove the long edge first
    const origSource  = e.source;
    const origTarget  = e.target;
    const origReversed = e.reversed;
    graph.removeEdge(eid);

    // Build chain: origSource → d1 → d2 → … → origTarget
    let prev = origSource;
    for (let r = srcRank + 1; r < tgtRank; r++) {
      const dId = `__dummy_${++_dummySeq}`;
      graph.addNode(dId, 0, 0);
      graph.node(dId)._dummy = true;
      graph.node(dId)._rank  = r;
      layers[r].push(dId);
      dummies.push(dId);

      const segId = `__dseg_${_dummySeq}_a`;
      graph.addEdge(segId, prev, dId);
      graph.edge(segId)._originalEdge = origId;
      graph.edge(segId).reversed       = origReversed;
      prev = dId;
    }

    // Final segment: last dummy (or origSource if span=2) → origTarget
    const lastSegId = `__dseg_${_dummySeq}_b`;
    graph.addEdge(lastSegId, prev, origTarget);
    graph.edge(lastSegId)._originalEdge = origId;
    graph.edge(lastSegId).reversed       = origReversed;
  }

  return dummies;
};


// ── Crossing count ────────────────────────────────────────────────────────────

/**
 * Count edge crossings between two adjacent layers.
 *
 * Uses the bilayer accumulation method: assign each node its position
 * index within its layer, then for every edge between the layers count
 * inversions among (source-pos, target-pos) pairs.
 *
 * O(E log E) where E = number of edges between the two layers.
 *
 * @param {string[]}    upperLayer  Node ids, in current order.
 * @param {string[]}    lowerLayer  Node ids, in current order.
 * @param {LayoutGraph} graph
 * @returns {number}
 */
var countCrossings = function countCrossings(upperLayer, lowerLayer, graph) {
  const lowerPos = new Map();
  lowerLayer.forEach((id, i) => lowerPos.set(id, i));

  // Collect (upperPos, lowerPos) pairs for edges between the two layers
  const upperPos = new Map();
  upperLayer.forEach((id, i) => upperPos.set(id, i));

  const pairs = [];
  for (const id of upperLayer) {
    for (const eid of graph.outEdges(id)) {
      const t = graph.edge(eid).target;
      if (lowerPos.has(t)) {
        pairs.push([upperPos.get(id), lowerPos.get(t)]);
      }
    }
  }

  // Sort by first element (upper position), break ties by second
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Count inversions in the second element using merge-sort logic
  return _countInversions(pairs.map(p => p[1]));
};

/** Count inversions in an integer array via merge sort. */
function _countInversions(arr) {
  if (arr.length < 2) return 0;
  const mid  = arr.length >> 1;
  const left = arr.slice(0, mid);
  const rght = arr.slice(mid);
  let count  = _countInversions(left) + _countInversions(rght);
  let i = 0, j = 0, k = 0;
  while (i < left.length && j < rght.length) {
    if (left[i] <= rght[j]) { arr[k++] = left[i++]; }
    else                    { arr[k++] = rght[j++]; count += left.length - i; }
  }
  while (i < left.length) arr[k++] = left[i++];
  while (j < rght.length) arr[k++] = rght[j++];
  return count;
}


// ── Crossing minimisation ─────────────────────────────────────────────────────

/**
 * Reorder nodes within each layer to reduce the number of edge crossings.
 *
 * Applies an iterative median + transpose sweep.  Modifies `layers`
 * in-place; does not add or remove nodes from the graph.
 *
 * @param {LayoutGraph} graph
 * @param {string[][]}  layers   Modified in-place.
 * @param {number}      [iterations=4]  Number of down+up sweep pairs.
 */
var minimizeCrossings = function minimizeCrossings(graph, layers, iterations = 4) {
  if (layers.length < 2) return;

  for (let iter = 0; iter < iterations; iter++) {
    // ── Down sweep: fix upper layer, sort lower by median of upper ──────────
    for (let r = 1; r < layers.length; r++) {
      _sortByMedian(layers[r], layers[r - 1], graph, 'pred');
    }

    // ── Up sweep: fix lower layer, sort upper by median of lower ────────────
    for (let r = layers.length - 2; r >= 0; r--) {
      _sortByMedian(layers[r], layers[r + 1], graph, 'succ');
    }

    // ── Transpose pass ───────────────────────────────────────────────────────
    _transpose(graph, layers);
  }
};

/**
 * Sort `layer` by the median position of each node's neighbours in
 * `fixedLayer`.
 *
 * @param {string[]}    layer       Layer to reorder (mutated).
 * @param {string[]}    fixedLayer  The already-fixed adjacent layer.
 * @param {LayoutGraph} graph
 * @param {'pred'|'succ'} direction  Which neighbours to look at.
 */
function _sortByMedian(layer, fixedLayer, graph, direction) {
  const fixedPos = new Map();
  fixedLayer.forEach((id, i) => fixedPos.set(id, i));

  const medians = new Map();
  for (const id of layer) {
    const neighbours =
      direction === 'pred'
        ? graph.predecessors(id).filter(n => fixedPos.has(n))
        : graph.successors(id).filter(n => fixedPos.has(n));

    if (neighbours.length === 0) {
      medians.set(id, -1);   // no neighbours: preserve relative position
      continue;
    }
    const positions = neighbours.map(n => fixedPos.get(n)).sort((a, b) => a - b);
    const mid = (positions.length - 1) / 2;
    // Median of odd-length array; average of two middle values for even
    const median = positions.length % 2 === 1
      ? positions[Math.floor(mid)]
      : (positions[Math.floor(mid)] + positions[Math.ceil(mid)]) / 2;
    medians.set(id, median);
  }

  layer.sort((a, b) => {
    const ma = medians.get(a), mb = medians.get(b);
    if (ma === -1 && mb === -1) return 0;
    if (ma === -1) return 1;
    if (mb === -1) return -1;
    return ma - mb;
  });
}

/**
 * Transpose pass: for each layer, try swapping every adjacent pair of
 * nodes and keep the swap if it strictly reduces total crossings with
 * both neighbouring layers.
 *
 * @param {LayoutGraph} graph
 * @param {string[][]}  layers  Modified in-place.
 */
function _transpose(graph, layers) {
  let improved = true;
  while (improved) {
    improved = false;
    for (let r = 0; r < layers.length; r++) {
      const layer = layers[r];
      for (let i = 0; i < layer.length - 1; i++) {
        const before = _adjacentCrossings(graph, layers, r, i);
        // Swap
        [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
        const after = _adjacentCrossings(graph, layers, r, i);
        if (after < before) {
          improved = true;   // keep swap
        } else {
          // Undo swap
          [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
        }
      }
    }
  }
}

/**
 * Total crossings touching layer `r` with its upper and lower neighbours,
 * considering only the two nodes at positions `i` and `i+1` in layer `r`
 * (used to decide whether a swap is beneficial).
 *
 * For simplicity we count crossings across the full adjacent pairs; the
 * overhead is small given the transpose is only applied to compact layers.
 */
function _adjacentCrossings(graph, layers, r, _i) {
  let total = 0;
  if (r > 0)                    total += countCrossings(layers[r - 1], layers[r],     graph);
  if (r < layers.length - 1)   total += countCrossings(layers[r],     layers[r + 1], graph);
  return total;
}

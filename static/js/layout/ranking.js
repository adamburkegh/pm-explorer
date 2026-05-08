/**
 * Sugiyama Phase 1 & 2: cycle removal and layer (rank) assignment.
 *
 * Cycle removal
 * ─────────────
 * A DFS identifies back-edges (edges from a node to an ancestor in the
 * current DFS path) and reverses them via LayoutGraph.reverseEdge().
 * After cycle removal the graph is a DAG.  Reversing the same edge
 * again during rendering restores the original direction so arrowheads
 * point the right way.
 *
 * Layer assignment (longest-path)
 * ────────────────────────────────
 * The longest-path algorithm assigns each node the smallest rank r ≥ 0
 * such that for every edge u→v, rank(u) < rank(v).  Equivalently,
 * a node's rank is one more than the maximum rank of its predecessors
 * (0 for sources).  This is computed by a single topological pass.
 *
 * The result is stored as node._rank (integer ≥ 0) on each LayoutNode.
 *
 * Usage (browser + Node.js via vm.runInThisContext):
 *   var declarations hoist onto the global object so removeCycles and
 *   assignRanks are accessible after loading.
 *
 * Dependencies: layout/graph.js must be loaded first.
 */

// ── Cycle removal ─────────────────────────────────────────────────────────────

/**
 * Remove cycles from `graph` by reversing back-edges found during a DFS.
 *
 * A back-edge is an edge whose target is currently on the DFS stack
 * (i.e. it leads back to an ancestor).  Reversing it breaks the cycle
 * without changing the set of nodes or edge ids; the `reversed` flag on
 * each affected LayoutEdge records the flip so callers can restore the
 * original orientation later.
 *
 * The algorithm visits every node (handles disconnected graphs).  Nodes
 * are visited in insertion order; ties in any ordering scheme are broken
 * consistently by that order.
 *
 * Time complexity: O(V + E).
 *
 * @param {LayoutGraph} graph  Modified in-place.
 * @returns {string[]}         Edge ids that were reversed (may be empty).
 */
var removeCycles = function removeCycles(graph) {
  /** @type {Set<string>} nodes currently on the DFS stack */
  const onStack = new Set();
  /** @type {Set<string>} nodes whose subtree has been fully explored */
  const visited = new Set();
  /** @type {string[]} edge ids that were reversed */
  const reversed = [];

  function dfs(nodeId) {
    visited.add(nodeId);
    onStack.add(nodeId);

    for (const eid of graph.outEdges(nodeId)) {
      const edge = graph.edge(eid);
      const target = edge.target;

      if (onStack.has(target)) {
        // Back-edge → reverse it to break the cycle
        graph.reverseEdge(eid);
        reversed.push(eid);
        // After reversal the edge now points nodeId ← target,
        // so it no longer appears in nodeId's outgoing set.
        // The DFS continues with the remaining (unmodified) out-edges;
        // iterating over a snapshot via outEdges() is safe here because
        // outEdges() returns a new array each call — but we captured the
        // edge ids in the for-of loop header, so we must be careful.
        // The reversed edge is removed from nodeId's out-set by
        // LayoutGraph.reverseEdge, so it won't be visited again from here.
      } else if (!visited.has(target)) {
        dfs(target);
      }
    }

    onStack.delete(nodeId);
  }

  // Snapshot node ids so mutations inside dfs() don't affect iteration.
  for (const id of [...graph.nodeIds]) {
    if (!visited.has(id)) dfs(id);
  }

  return reversed;
};


// ── Layer (rank) assignment ───────────────────────────────────────────────────

/**
 * Assign integer ranks to every node in `graph` (which must be a DAG).
 *
 * Each node receives a `_rank` property (non-negative integer) such that
 * for every edge u→v: rank(u) < rank(v).  Source nodes receive rank 0.
 * Isolated nodes (no edges) also receive rank 0.
 *
 * The longest-path rule is applied: rank(v) = max(rank(u) + 1) over all
 * predecessors u of v.  This is computed via Kahn's topological sort
 * (BFS from sources, decrementing in-degree counts).
 *
 * If the graph contains a cycle this function will still return — nodes
 * unreachable from any source (because they are inside a cycle) are
 * assigned rank 0 as a fallback.  Callers should run removeCycles first.
 *
 * Time complexity: O(V + E).
 *
 * @param {LayoutGraph} graph  Node._rank properties are added in-place.
 * @returns {number}           The maximum rank assigned (number of layers − 1).
 */
var assignRanks = function assignRanks(graph) {
  // Initialise ranks to 0 and compute in-degree for Kahn's algorithm.
  /** @type {Map<string, number>} */
  const inDeg = new Map();

  for (const id of graph.nodeIds) {
    graph.node(id)._rank = 0;
    inDeg.set(id, 0);
  }
  for (const id of graph.nodeIds) {
    for (const eid of graph.outEdges(id)) {
      const t = graph.edge(eid).target;
      inDeg.set(t, inDeg.get(t) + 1);
    }
  }

  // Kahn BFS: start with nodes that have no predecessors.
  const queue = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  let maxRank = 0;

  // Process in FIFO order so nodes at the same depth are handled together.
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const rank = graph.node(id)._rank;
    if (rank > maxRank) maxRank = rank;

    for (const eid of graph.outEdges(id)) {
      const t = graph.edge(eid).target;
      const candidate = rank + 1;
      if (candidate > graph.node(t)._rank) {
        graph.node(t)._rank = candidate;
      }
      const newDeg = inDeg.get(t) - 1;
      inDeg.set(t, newDeg);
      if (newDeg === 0) queue.push(t);
    }
  }

  return maxRank;
};

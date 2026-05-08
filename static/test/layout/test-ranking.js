/**
 * Tests for layout/ranking.js — removeCycles and assignRanks
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a LayoutGraph from a compact edge list.
 *  nodes is an array of node ids; edges is an array of [id, src, tgt]. */
function makeGraph(nodes, edges) {
  const g = new LayoutGraph();
  for (const n of nodes) g.addNode(n);
  for (const [id, s, t] of edges) g.addEdge(id, s, t);
  return g;
}

/** True when the graph is a DAG (no cycles). */
function isDAG(g) {
  const visited = new Set();
  const onStack = new Set();
  let cyclic = false;
  function dfs(id) {
    visited.add(id); onStack.add(id);
    for (const eid of g.outEdges(id)) {
      const t = g.edge(eid).target;
      if (onStack.has(t)) { cyclic = true; return; }
      if (!visited.has(t)) dfs(t);
    }
    onStack.delete(id);
  }
  for (const id of g.nodeIds) if (!visited.has(id)) dfs(id);
  return !cyclic;
}

/** True when rank assignment respects every edge u→v: rank(u) < rank(v). */
function ranksValid(g) {
  for (const eid of g.edgeIds) {
    const e = g.edge(eid);
    if (g.node(e.source)._rank >= g.node(e.target)._rank) return false;
  }
  return true;
}


// ── removeCycles — already-acyclic graphs ─────────────────────────────────────

describe('removeCycles — acyclic graphs unchanged', () => {
  it('empty graph returns no reversed edges', () => {
    const g = new LayoutGraph();
    const rev = removeCycles(g);
    assert.deepEqual(rev, []);
  });

  it('single node returns no reversed edges', () => {
    const g = makeGraph(['a'], []);
    const rev = removeCycles(g);
    assert.deepEqual(rev, []);
  });

  it('simple chain is unchanged', () => {
    const g = makeGraph(['a','b','c'], [['ab','a','b'],['bc','b','c']]);
    const rev = removeCycles(g);
    assert.deepEqual(rev, []);
    assert.equal(g.edge('ab').source, 'a');
    assert.equal(g.edge('bc').source, 'b');
  });

  it('DAG diamond is unchanged', () => {
    const g = makeGraph(['s','l','r','t'],
      [['sl','s','l'],['sr','s','r'],['lt','l','t'],['rt','r','t']]);
    const rev = removeCycles(g);
    assert.deepEqual(rev, []);
    assert.ok(isDAG(g));
  });

  it('tree (branching) is unchanged', () => {
    const g = makeGraph(['r','a','b','c','d'],
      [['ra','r','a'],['rb','r','b'],['ac','a','c'],['ad','a','d']]);
    const rev = removeCycles(g);
    assert.deepEqual(rev, []);
  });
});


// ── removeCycles — cycles ─────────────────────────────────────────────────────

describe('removeCycles — cycle breaking', () => {
  it('simple 2-cycle becomes a DAG', () => {
    const g = makeGraph(['a','b'], [['ab','a','b'],['ba','b','a']]);
    const rev = removeCycles(g);
    assert.equal(rev.length, 1);
    assert.ok(isDAG(g));
  });

  it('reversed edge carries the reversed flag', () => {
    const g = makeGraph(['a','b'], [['ab','a','b'],['ba','b','a']]);
    removeCycles(g);
    // Exactly one of the two edges should be reversed
    const abRev = g.edge('ab').reversed;
    const baRev = g.edge('ba').reversed;
    assert.ok(abRev !== baRev, 'exactly one edge should be reversed');
  });

  it('self-loop is identified and marked reversed', () => {
    // Reversing a self-loop (source === target) cannot remove it from the
    // adjacency sets — the graph is structurally unchanged.  removeCycles
    // guarantees the edge is detected and flagged; assignRanks handles
    // self-loops by treating them as zero-length constraints (rank unchanged).
    const g = makeGraph(['a'], [['aa','a','a']]);
    const rev = removeCycles(g);
    assert.equal(rev.length, 1);
    assert.ok(g.edge('aa').reversed, 'self-loop should be flagged reversed');
  });

  it('3-cycle becomes a DAG', () => {
    const g = makeGraph(['a','b','c'],
      [['ab','a','b'],['bc','b','c'],['ca','c','a']]);
    removeCycles(g);
    assert.ok(isDAG(g));
  });

  it('two disjoint cycles are both broken', () => {
    const g = makeGraph(['a','b','c','d'],
      [['ab','a','b'],['ba','b','a'],['cd','c','d'],['dc','d','c']]);
    removeCycles(g);
    assert.ok(isDAG(g));
  });

  it('graph with back-edge and forward-edge produces valid DAG', () => {
    // a→b→c→a (cycle) plus a→c (forward edge)
    const g = makeGraph(['a','b','c'],
      [['ab','a','b'],['bc','b','c'],['ca','c','a'],['ac','a','c']]);
    removeCycles(g);
    assert.ok(isDAG(g));
  });

  it('edge count is preserved after cycle removal', () => {
    const g = makeGraph(['a','b','c'],
      [['ab','a','b'],['bc','b','c'],['ca','c','a']]);
    const before = g.edgeCount;
    removeCycles(g);
    assert.equal(g.edgeCount, before);
  });

  it('node count is preserved after cycle removal', () => {
    const g = makeGraph(['a','b'], [['ab','a','b'],['ba','b','a']]);
    removeCycles(g);
    assert.equal(g.nodeCount, 2);
  });

  it('disconnected graph with one cyclic and one acyclic component', () => {
    const g = makeGraph(['a','b','c','d'],
      [['ab','a','b'],['ba','b','a'],['cd','c','d']]);
    removeCycles(g);
    assert.ok(isDAG(g));
    assert.equal(g.edge('cd').reversed, false);
  });
});


// ── assignRanks — basic DAGs ──────────────────────────────────────────────────

describe('assignRanks — basic DAGs', () => {
  it('single isolated node gets rank 0', () => {
    const g = makeGraph(['a'], []);
    assignRanks(g);
    assert.equal(g.node('a')._rank, 0);
  });

  it('chain a→b→c: ranks 0, 1, 2', () => {
    const g = makeGraph(['a','b','c'], [['ab','a','b'],['bc','b','c']]);
    const max = assignRanks(g);
    assert.equal(g.node('a')._rank, 0);
    assert.equal(g.node('b')._rank, 1);
    assert.equal(g.node('c')._rank, 2);
    assert.equal(max, 2);
  });

  it('parallel paths: longest path wins', () => {
    // s→a→t (length 2), s→b→c→t (length 3) — t should get rank 3
    const g = makeGraph(['s','a','b','c','t'],
      [['sa','s','a'],['at','a','t'],['sb','s','b'],['bc','b','c'],['ct','c','t']]);
    const max = assignRanks(g);
    assert.equal(g.node('s')._rank, 0);
    assert.equal(g.node('t')._rank, 3);
    assert.equal(max, 3);
  });

  it('diamond: all ranks valid', () => {
    const g = makeGraph(['s','l','r','t'],
      [['sl','s','l'],['sr','s','r'],['lt','l','t'],['rt','r','t']]);
    assignRanks(g);
    assert.ok(ranksValid(g));
    assert.equal(g.node('s')._rank, 0);
    assert.equal(g.node('t')._rank, 2);
  });

  it('tree branching: all ranks valid', () => {
    const g = makeGraph(['r','a','b','c','d'],
      [['ra','r','a'],['rb','r','b'],['ac','a','c'],['ad','a','d']]);
    assignRanks(g);
    assert.ok(ranksValid(g));
    assert.equal(g.node('r')._rank, 0);
    assert.equal(g.node('c')._rank, 2);
    assert.equal(g.node('d')._rank, 2);
  });

  it('multiple sources: each source gets rank 0', () => {
    const g = makeGraph(['a','b','c'],
      [['ac','a','c'],['bc','b','c']]);
    assignRanks(g);
    assert.equal(g.node('a')._rank, 0);
    assert.equal(g.node('b')._rank, 0);
    assert.equal(g.node('c')._rank, 1);
  });

  it('returns maximum rank', () => {
    const g = makeGraph(['a','b','c','d'],
      [['ab','a','b'],['bc','b','c'],['cd','c','d']]);
    const max = assignRanks(g);
    assert.equal(max, 3);
  });

  it('edge constraint: rank(src) < rank(tgt) for all edges', () => {
    // Larger random-looking DAG
    const g = makeGraph(['a','b','c','d','e','f'],
      [['ab','a','b'],['ac','a','c'],['bd','b','d'],['cd','c','d'],
       ['de','d','e'],['ce','c','e'],['ef','e','f']]);
    assignRanks(g);
    assert.ok(ranksValid(g));
  });

  it('disconnected DAG: each component ranked independently from 0', () => {
    const g = makeGraph(['a','b','c','d'],
      [['ab','a','b'],['cd','c','d']]);
    assignRanks(g);
    assert.equal(g.node('a')._rank, 0);
    assert.equal(g.node('b')._rank, 1);
    assert.equal(g.node('c')._rank, 0);
    assert.equal(g.node('d')._rank, 1);
  });
});


// ── removeCycles + assignRanks together ───────────────────────────────────────

describe('removeCycles + assignRanks — combined', () => {
  it('simple cycle: after removal ranks are valid', () => {
    const g = makeGraph(['a','b','c'],
      [['ab','a','b'],['bc','b','c'],['ca','c','a']]);
    removeCycles(g);
    assignRanks(g);
    assert.ok(ranksValid(g));
  });

  it('2-cycle: after removal ranks are 0 and 1', () => {
    const g = makeGraph(['a','b'], [['ab','a','b'],['ba','b','a']]);
    removeCycles(g);
    assignRanks(g);
    assert.ok(ranksValid(g));
    const ranks = [g.node('a')._rank, g.node('b')._rank].sort((x,y)=>x-y);
    assert.deepEqual(ranks, [0, 1]);
  });

  it('process-like graph with back-edge (loop): valid ranks after removal', () => {
    // Models: start → A → B → C → end, plus C → A (loop-back)
    const g = makeGraph(['start','A','B','C','end'],
      [['s_A','start','A'],['AB','A','B'],['BC','B','C'],
       ['C_end','C','end'],['CA','C','A']]);
    removeCycles(g);
    assignRanks(g);
    assert.ok(ranksValid(g));
    assert.equal(g.node('start')._rank, 0);
  });
});

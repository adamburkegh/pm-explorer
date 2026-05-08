/**
 * Tests for layout/crossing.js — buildLayers, insertDummyNodes,
 * countCrossings, minimizeCrossings.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a LayoutGraph, run removeCycles + assignRanks, return graph. */
function rankedGraph(nodes, edges) {
  const g = new LayoutGraph();
  for (const n of nodes) g.addNode(n);
  for (const [id, s, t] of edges) g.addEdge(id, s, t);
  removeCycles(g);
  assignRanks(g);
  return g;
}

/** True when every edge in graph spans exactly one rank. */
function allEdgesUnitSpan(g) {
  for (const eid of g.edgeIds) {
    const e = g.edge(eid);
    const span = Math.abs(g.node(e.target)._rank - g.node(e.source)._rank);
    if (span !== 1) return false;
  }
  return true;
}

/** Total crossings across all adjacent layer pairs. */
function totalCrossings(g, layers) {
  let total = 0;
  for (let r = 0; r < layers.length - 1; r++) {
    total += countCrossings(layers[r], layers[r + 1], g);
  }
  return total;
}


// ── buildLayers ───────────────────────────────────────────────────────────────

describe('buildLayers', () => {
  it('single node produces one layer', () => {
    const g = rankedGraph(['a'], []);
    const layers = buildLayers(g);
    assert.equal(layers.length, 1);
    assert.deepEqual(layers[0], ['a']);
  });

  it('chain a→b→c produces three layers', () => {
    const g = rankedGraph(['a','b','c'], [['ab','a','b'],['bc','b','c']]);
    const layers = buildLayers(g);
    assert.equal(layers.length, 3);
    assert.deepEqual(layers[0], ['a']);
    assert.deepEqual(layers[1], ['b']);
    assert.deepEqual(layers[2], ['c']);
  });

  it('every node appears in exactly one layer', () => {
    const g = rankedGraph(['s','a','b','t'],
      [['sa','s','a'],['sb','s','b'],['at','a','t'],['bt','b','t']]);
    const layers = buildLayers(g);
    const all = layers.flat();
    assert.equal(all.length, g.nodeCount);
    assert.equal(new Set(all).size, g.nodeCount);
  });

  it('node rank matches layer index', () => {
    const g = rankedGraph(['s','a','b','t'],
      [['sa','s','a'],['sb','s','b'],['at','a','t'],['bt','b','t']]);
    const layers = buildLayers(g);
    for (let r = 0; r < layers.length; r++) {
      for (const id of layers[r]) {
        assert.equal(g.node(id)._rank, r, `node ${id} should be at rank ${r}`);
      }
    }
  });

  it('multiple nodes at the same rank all appear in the same layer', () => {
    const g = rankedGraph(['s','a','b','c','t'],
      [['sa','s','a'],['sb','s','b'],['sc','s','c'],
       ['at','a','t'],['bt','b','t'],['ct','c','t']]);
    const layers = buildLayers(g);
    assert.equal(layers[0].length, 1);   // s
    assert.equal(layers[1].length, 3);   // a, b, c
    assert.equal(layers[2].length, 1);   // t
  });

  it('disconnected graph: each component contributes to correct layers', () => {
    const g = rankedGraph(['a','b','c','d'],
      [['ab','a','b'],['cd','c','d']]);
    const layers = buildLayers(g);
    assert.equal(layers.length, 2);
    assert.equal(layers[0].length, 2);
    assert.equal(layers[1].length, 2);
  });
});


// ── insertDummyNodes ──────────────────────────────────────────────────────────

describe('insertDummyNodes', () => {
  it('unit-span edges are not split', () => {
    const g = rankedGraph(['a','b'], [['ab','a','b']]);
    const layers = buildLayers(g);
    const before = g.edgeCount;
    insertDummyNodes(g, layers);
    assert.equal(g.edgeCount, before);
    assert.equal(layers[0].length, 1);
    assert.equal(layers[1].length, 1);
  });

  it('span-2 edge adds one dummy node', () => {
    // a→b (rank 0→2 after we manually set ranks), or use a→b→c→d skip
    // Build a→c where b is on rank 1 but not connected to the skip edge
    const g = new LayoutGraph();
    g.addNode('a'); g.addNode('b'); g.addNode('c');
    g.node('a')._rank = 0;
    g.node('b')._rank = 1;
    g.node('c')._rank = 2;
    g.addEdge('ac', 'a', 'c');   // spans 2 ranks
    const layers = [['a'], ['b'], ['c']];

    const dummies = insertDummyNodes(g, layers);
    assert.equal(dummies.length, 1);
    assert.ok(g.node(dummies[0])._dummy);
    assert.ok(allEdgesUnitSpan(g));
  });

  it('span-3 edge adds two dummy nodes', () => {
    const g = new LayoutGraph();
    ['a','b','c','d'].forEach((id, i) => { g.addNode(id); g.node(id)._rank = i; });
    g.addEdge('ad', 'a', 'd');   // spans 3 ranks
    const layers = [['a'], ['b'], ['c'], ['d']];

    const dummies = insertDummyNodes(g, layers);
    assert.equal(dummies.length, 2);
    assert.ok(allEdgesUnitSpan(g));
  });

  it('original long edge is removed', () => {
    const g = new LayoutGraph();
    g.addNode('a'); g.addNode('b');
    g.node('a')._rank = 0; g.node('b')._rank = 2;
    g.addEdge('ab', 'a', 'b');
    const layers = [['a'], [], ['b']];

    insertDummyNodes(g, layers);
    assert.ok(!g.hasEdge('ab'), 'original edge should be removed');
  });

  it('dummy nodes are inserted into the correct layers', () => {
    const g = new LayoutGraph();
    g.addNode('a'); g.addNode('b');
    g.node('a')._rank = 0; g.node('b')._rank = 3;
    g.addEdge('ab', 'a', 'b');
    const layers = [['a'], [], [], ['b']];

    const dummies = insertDummyNodes(g, layers);
    assert.equal(dummies.length, 2);
    assert.ok(layers[1].includes(dummies[0]) || layers[2].includes(dummies[0]));
    assert.ok(layers[1].includes(dummies[1]) || layers[2].includes(dummies[1]));
    // Each of ranks 1 and 2 should have exactly one dummy
    assert.equal(layers[1].length, 1);
    assert.equal(layers[2].length, 1);
  });

  it('segment edges carry _originalEdge reference', () => {
    const g = new LayoutGraph();
    g.addNode('a'); g.addNode('b');
    g.node('a')._rank = 0; g.node('b')._rank = 2;
    g.addEdge('ab', 'a', 'b');
    const layers = [['a'], [], ['b']];

    insertDummyNodes(g, layers);
    for (const eid of g.edgeIds) {
      assert.equal(g.edge(eid)._originalEdge, 'ab',
        `edge ${eid} should reference original edge 'ab'`);
    }
  });

  it('all edges are unit-span after insertion (longer chain)', () => {
    // Chain a→b→c→d→e with skip edge a→e spanning 4 ranks
    const g = new LayoutGraph();
    ['a','b','c','d','e'].forEach((id, i) => { g.addNode(id); g.node(id)._rank = i; });
    g.addEdge('ae', 'a', 'e');
    const layers = [['a'], ['b'], ['c'], ['d'], ['e']];

    insertDummyNodes(g, layers);
    assert.ok(allEdgesUnitSpan(g));
  });

  it('multiple long edges produce independent dummy chains', () => {
    const g = new LayoutGraph();
    ['a','b','c','d','e','f'].forEach((id, i) => { g.addNode(id); g.node(id)._rank = i; });
    g.addEdge('ac', 'a', 'c');  // span 2
    g.addEdge('df', 'd', 'f');  // span 2
    const layers = [['a'],['b'],['c'],['d'],['e'],['f']];

    const dummies = insertDummyNodes(g, layers);
    assert.equal(dummies.length, 2);
    assert.ok(allEdgesUnitSpan(g));
  });
});


// ── countCrossings ────────────────────────────────────────────────────────────

describe('countCrossings', () => {
  it('no edges → 0 crossings', () => {
    const g = new LayoutGraph();
    g.addNode('a'); g.addNode('b');
    assert.equal(countCrossings(['a'], ['b'], g), 0);
  });

  it('parallel edges, same order → 0 crossings', () => {
    const g = new LayoutGraph();
    ['a','b','c','d'].forEach(id => g.addNode(id));
    g.addEdge('ac','a','c'); g.addEdge('bd','b','d');
    // upper [a,b], lower [c,d] — a→c, b→d cross? No: positions (0,0),(1,1)
    assert.equal(countCrossings(['a','b'], ['c','d'], g), 0);
  });

  it('two crossing edges → 1 crossing', () => {
    const g = new LayoutGraph();
    ['a','b','c','d'].forEach(id => g.addNode(id));
    g.addEdge('ad','a','d'); g.addEdge('bc','b','c');
    // upper [a,b], lower [c,d] — a→d (pos 0→1), b→c (pos 1→0): cross
    assert.equal(countCrossings(['a','b'], ['c','d'], g), 1);
  });

  it('three nodes, two crossings', () => {
    // Upper [a,b,c], lower [x,y,z]
    // a→z, b→y, c→x: fully reversed — 3 crossings
    const g = new LayoutGraph();
    ['a','b','c','x','y','z'].forEach(id => g.addNode(id));
    g.addEdge('az','a','z');
    g.addEdge('by','b','y');
    g.addEdge('cx','c','x');
    assert.equal(countCrossings(['a','b','c'], ['x','y','z'], g), 3);
  });

  it('edges only exist in one direction (upper→lower)', () => {
    const g = new LayoutGraph();
    ['a','b'].forEach(id => g.addNode(id));
    g.addEdge('ab','a','b');
    // lower→upper direction not counted
    assert.equal(countCrossings(['a'], ['b'], g), 0);
  });
});


// ── minimizeCrossings ─────────────────────────────────────────────────────────

describe('minimizeCrossings', () => {
  it('single layer: no-op', () => {
    const g = new LayoutGraph();
    g.addNode('a'); g.node('a')._rank = 0;
    const layers = [['a']];
    minimizeCrossings(g, layers);   // should not throw
    assert.equal(layers[0][0], 'a');
  });

  it('two layers, no edges: layers unchanged', () => {
    const g = new LayoutGraph();
    ['a','b','c','d'].forEach(id => g.addNode(id));
    g.node('a')._rank = 0; g.node('b')._rank = 0;
    g.node('c')._rank = 1; g.node('d')._rank = 1;
    const layers = [['a','b'], ['c','d']];
    minimizeCrossings(g, layers);
    assert.equal(layers[0].length, 2);
    assert.equal(layers[1].length, 2);
  });

  it('does not remove or add nodes from layers', () => {
    const g = rankedGraph(['s','a','b','c','t'],
      [['sa','s','a'],['sb','s','b'],['sc','s','c'],
       ['at','a','t'],['bt','b','t'],['ct','c','t']]);
    const layers = buildLayers(g);
    const before = layers.map(l => l.length);
    minimizeCrossings(g, layers);
    const after = layers.map(l => l.length);
    assert.deepEqual(before, after);
  });

  it('every node still present after minimisation', () => {
    const g = rankedGraph(['s','a','b','c','t'],
      [['sa','s','a'],['sb','s','b'],['sc','s','c'],
       ['at','a','t'],['bt','b','t'],['ct','c','t']]);
    const layers = buildLayers(g);
    minimizeCrossings(g, layers);
    const all = new Set(layers.flat());
    for (const id of g.nodeIds) {
      assert.ok(all.has(id), `node ${id} missing after minimisation`);
    }
  });

  it('crossings do not increase for a known-crossing arrangement', () => {
    // Two-layer graph where initial order has a crossing:
    // upper [a, b], lower [d, c]
    // a→c (0→1), b→d (1→0) → 1 crossing initially
    const g = new LayoutGraph();
    ['a','b','c','d'].forEach(id => g.addNode(id));
    g.node('a')._rank = 0; g.node('b')._rank = 0;
    g.node('c')._rank = 1; g.node('d')._rank = 1;
    g.addEdge('ac','a','c'); g.addEdge('bd','b','d');
    const layers = [['a','b'], ['d','c']];   // d before c → crossing
    const before = totalCrossings(g, layers);
    minimizeCrossings(g, layers);
    const after = totalCrossings(g, layers);
    assert.ok(after <= before, `crossings should not increase: ${before} → ${after}`);
    assert.equal(after, 0);
  });

  it('fully reversed layer: resolves to 0 crossings', () => {
    // a→x, b→y, c→z; initial lower order [z,y,x] → 3 crossings
    const g = new LayoutGraph();
    ['a','b','c','x','y','z'].forEach(id => g.addNode(id));
    g.node('a')._rank = 0; g.node('b')._rank = 0; g.node('c')._rank = 0;
    g.node('x')._rank = 1; g.node('y')._rank = 1; g.node('z')._rank = 1;
    g.addEdge('ax','a','x'); g.addEdge('by','b','y'); g.addEdge('cz','c','z');
    const layers = [['a','b','c'], ['z','y','x']];
    minimizeCrossings(g, layers);
    assert.equal(totalCrossings(g, layers), 0);
  });

  it('works end-to-end with dummy nodes inserted', () => {
    // s→a→t and s→t (skip edge), s rank 0, a rank 1, t rank 2
    // After insertDummyNodes the skip edge s→t becomes s→dummy→t
    const g = rankedGraph(['s','a','t'],
      [['sa','s','a'],['at','a','t'],['st','s','t']]);
    const layers = buildLayers(g);
    insertDummyNodes(g, layers);
    minimizeCrossings(g, layers);
    // All nodes still present
    const all = new Set(layers.flat());
    assert.ok(all.has('s'));
    assert.ok(all.has('a'));
    assert.ok(all.has('t'));
  });
});

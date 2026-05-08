/**
 * Tests for layout/graph.js — LayoutGraph
 */

// ── Construction ─────────────────────────────────────────────────────────────

describe('LayoutGraph — construction', () => {
  it('starts empty', () => {
    const g = new LayoutGraph();
    assert.equal(g.nodeCount, 0);
    assert.equal(g.edgeCount, 0);
  });

  it('addNode stores width and height', () => {
    const g = new LayoutGraph();
    g.addNode('a', 100, 50);
    assert.equal(g.nodeCount, 1);
    assert.equal(g.node('a').width,  100);
    assert.equal(g.node('a').height,  50);
  });

  it('addNode defaults width and height to zero', () => {
    const g = new LayoutGraph();
    g.addNode('x');
    assert.equal(g.node('x').width,  0);
    assert.equal(g.node('x').height, 0);
  });

  it('addNode is chainable', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addNode('c');
    assert.equal(g.nodeCount, 3);
  });

  it('addNode throws on duplicate id', () => {
    const g = new LayoutGraph();
    g.addNode('a');
    let threw = false;
    try { g.addNode('a'); } catch { threw = true; }
    assert.ok(threw, 'should throw on duplicate node id');
  });

  it('addEdge stores source and target', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('e1', 'a', 'b');
    assert.equal(g.edgeCount, 1);
    assert.equal(g.edge('e1').source, 'a');
    assert.equal(g.edge('e1').target, 'b');
    assert.equal(g.edge('e1').reversed, false);
  });

  it('addEdge is chainable', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addNode('c')
     .addEdge('ab', 'a', 'b').addEdge('bc', 'b', 'c');
    assert.equal(g.edgeCount, 2);
  });

  it('addEdge throws on duplicate id', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('e', 'a', 'b');
    let threw = false;
    try { g.addEdge('e', 'a', 'b'); } catch { threw = true; }
    assert.ok(threw, 'should throw on duplicate edge id');
  });

  it('addEdge throws on unknown source', () => {
    const g = new LayoutGraph();
    g.addNode('b');
    let threw = false;
    try { g.addEdge('e', 'missing', 'b'); } catch { threw = true; }
    assert.ok(threw, 'should throw on unknown source');
  });

  it('addEdge throws on unknown target', () => {
    const g = new LayoutGraph();
    g.addNode('a');
    let threw = false;
    try { g.addEdge('e', 'a', 'missing'); } catch { threw = true; }
    assert.ok(threw, 'should throw on unknown target');
  });

  it('hasNode / hasEdge', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('ab', 'a', 'b');
    assert.ok( g.hasNode('a'));
    assert.ok(!g.hasNode('z'));
    assert.ok( g.hasEdge('ab'));
    assert.ok(!g.hasEdge('zz'));
  });

  it('node() returns undefined for unknown id', () => {
    const g = new LayoutGraph();
    assert.equal(g.node('nope'), undefined);
  });
});


// ── Adjacency ─────────────────────────────────────────────────────────────────

describe('LayoutGraph — adjacency', () => {
  // a → b → c, a → c  (triangle)
  function triangle() {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addNode('c');
    g.addEdge('ab', 'a', 'b').addEdge('bc', 'b', 'c').addEdge('ac', 'a', 'c');
    return g;
  }

  it('successors', () => {
    const g = triangle();
    assert.deepEqual(g.successors('a').sort(), ['b', 'c']);
    assert.deepEqual(g.successors('b'),        ['c']);
    assert.deepEqual(g.successors('c'),        []);
  });

  it('predecessors', () => {
    const g = triangle();
    assert.deepEqual(g.predecessors('a'),        []);
    assert.deepEqual(g.predecessors('c').sort(), ['a', 'b']);
  });

  it('outEdges count', () => {
    const g = triangle();
    assert.equal(g.outEdges('a').length, 2);
    assert.equal(g.outEdges('b').length, 1);
    assert.equal(g.outEdges('c').length, 0);
  });

  it('inEdges count', () => {
    const g = triangle();
    assert.equal(g.inEdges('a').length, 0);
    assert.equal(g.inEdges('c').length, 2);
  });

  it('outEdges / inEdges return edge ids referencing the edge object', () => {
    const g = triangle();
    const eids = g.outEdges('a');
    for (const eid of eids) {
      assert.ok(g.edge(eid) !== undefined, 'edge id should resolve');
      assert.equal(g.edge(eid).source, 'a');
    }
  });

  it('successors returns empty array for unknown node', () => {
    const g = new LayoutGraph();
    assert.deepEqual(g.successors('x'), []);
  });
});


// ── Sources and sinks ────────────────────────────────────────────────────────

describe('LayoutGraph — sources and sinks', () => {
  it('chain: one source, one sink', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addNode('c');
    g.addEdge('ab', 'a', 'b').addEdge('bc', 'b', 'c');
    assert.deepEqual(g.sources(), ['a']);
    assert.deepEqual(g.sinks(),   ['c']);
  });

  it('isolated node is both source and sink', () => {
    const g = new LayoutGraph();
    g.addNode('x');
    assert.deepEqual(g.sources(), ['x']);
    assert.deepEqual(g.sinks(),   ['x']);
  });

  it('pure cycle has no sources or sinks', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b');
    g.addEdge('ab', 'a', 'b').addEdge('ba', 'b', 'a');
    assert.equal(g.sources().length, 0);
    assert.equal(g.sinks().length,   0);
  });

  it('diamond: one source, one sink, two internal nodes', () => {
    const g = new LayoutGraph();
    g.addNode('s').addNode('l').addNode('r').addNode('t');
    g.addEdge('sl', 's', 'l').addEdge('sr', 's', 'r')
     .addEdge('lt', 'l', 't').addEdge('rt', 'r', 't');
    assert.deepEqual(g.sources(), ['s']);
    assert.deepEqual(g.sinks(),   ['t']);
  });
});


// ── Mutation ─────────────────────────────────────────────────────────────────

describe('LayoutGraph — removeEdge', () => {
  it('decrements edgeCount and clears adjacency', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('e', 'a', 'b');
    g.removeEdge('e');
    assert.equal(g.edgeCount, 0);
    assert.equal(g.outEdges('a').length, 0);
    assert.equal(g.inEdges('b').length,  0);
  });

  it('is a no-op for an unknown edge id', () => {
    const g = new LayoutGraph();
    g.addNode('a');
    g.removeEdge('nope');   // should not throw
    assert.equal(g.nodeCount, 1);
  });
});

describe('LayoutGraph — removeNode', () => {
  it('removes the node and all incident edges', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addNode('c');
    g.addEdge('ab', 'a', 'b').addEdge('bc', 'b', 'c');
    g.removeNode('b');
    assert.equal(g.nodeCount, 2);
    assert.equal(g.edgeCount, 0);
    assert.ok(!g.hasNode('b'));
  });

  it('updates adjacency of remaining nodes', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addNode('c');
    g.addEdge('ab', 'a', 'b').addEdge('bc', 'b', 'c');
    g.removeNode('b');
    assert.equal(g.successors('a').length,   0);
    assert.equal(g.predecessors('c').length, 0);
  });

  it('is a no-op for an unknown node id', () => {
    const g = new LayoutGraph();
    g.addNode('a');
    g.removeNode('nope');   // should not throw
    assert.equal(g.nodeCount, 1);
  });
});


// ── Edge reversal ─────────────────────────────────────────────────────────────

describe('LayoutGraph — reverseEdge', () => {
  it('swaps source and target', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('e', 'a', 'b');
    g.reverseEdge('e');
    assert.equal(g.edge('e').source, 'b');
    assert.equal(g.edge('e').target, 'a');
  });

  it('sets reversed flag', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('e', 'a', 'b');
    g.reverseEdge('e');
    assert.equal(g.edge('e').reversed, true);
  });

  it('updates adjacency maps', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('e', 'a', 'b');
    g.reverseEdge('e');
    assert.ok( g.successors('b').includes('a'), 'b→a should exist');
    assert.ok(!g.successors('a').includes('b'), 'a→b should be gone');
    assert.equal(g.inEdges('a').length,  1);
    assert.equal(g.outEdges('a').length, 0);
  });

  it('double-reverse restores original direction and clears flag', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b').addEdge('e', 'a', 'b');
    g.reverseEdge('e').reverseEdge('e');
    assert.equal(g.edge('e').source,   'a');
    assert.equal(g.edge('e').target,   'b');
    assert.equal(g.edge('e').reversed, false);
  });

  it('is a no-op for unknown edge id', () => {
    const g = new LayoutGraph();
    g.reverseEdge('nope');   // should not throw
  });
});


// ── Self-edges ────────────────────────────────────────────────────────────────

describe('LayoutGraph — self-edges', () => {
  it('allows a self-edge', () => {
    const g = new LayoutGraph();
    g.addNode('a').addEdge('aa', 'a', 'a');
    assert.equal(g.edgeCount, 1);
    assert.ok(g.successors('a').includes('a'));
    assert.ok(g.predecessors('a').includes('a'));
  });

  it('removing a self-edge node does not error', () => {
    const g = new LayoutGraph();
    g.addNode('a').addEdge('aa', 'a', 'a');
    g.removeNode('a');
    assert.equal(g.nodeCount, 0);
    assert.equal(g.edgeCount, 0);
  });

  it('self-edge node appears in neither sources nor sinks', () => {
    const g = new LayoutGraph();
    g.addNode('a').addEdge('aa', 'a', 'a');
    assert.equal(g.sources().length, 0);
    assert.equal(g.sinks().length,   0);
  });
});


// ── Multi-edges ───────────────────────────────────────────────────────────────

describe('LayoutGraph — multi-edges', () => {
  it('allows parallel edges between the same pair', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b');
    g.addEdge('e1', 'a', 'b').addEdge('e2', 'a', 'b');
    assert.equal(g.edgeCount, 2);
    assert.equal(g.outEdges('a').length, 2);
    assert.equal(g.inEdges('b').length,  2);
  });

  it('removing one parallel edge leaves the other intact', () => {
    const g = new LayoutGraph();
    g.addNode('a').addNode('b');
    g.addEdge('e1', 'a', 'b').addEdge('e2', 'a', 'b');
    g.removeEdge('e1');
    assert.equal(g.edgeCount, 1);
    assert.ok(g.hasEdge('e2'));
    assert.equal(g.successors('a').length, 1);
  });
});

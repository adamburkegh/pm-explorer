/**
 * Tests for inductive-miner.js — IMUVCL variant.
 *
 * Covers (in order):
 *   1. Base cases           — single activity, empty log, empty-trace fall-through
 *   2. XOR cut              — disjoint variants, nested XOR
 *   3. Sequence cut         — plain, with inner XOR, with repeated activities
 *   4. Concurrency cut      — flat PAR, PAR inside SEQ
 *   5. Loop cut             — leaf do+redo, sequence do-body, XOR redo
 *   6. Petri net invariants — bipartite arcs, source/sink marking
 *   7. Functional: running_example.xes
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUVCL(...rows) {
  const m = new Map();
  for (const [acts, count] of rows)
    m.set(JSON.stringify(acts), count ?? 1);
  return m;
}

/** Compact string representation of a process tree. */
function treeStr(node) {
  if (!node.operator) return node.label ?? 'τ';
  return `${node.operator}(${node.children.map(treeStr).join(', ')})`;
}

/** All leaf labels in depth-first order (null for τ). */
function leafLabels(node) {
  if (!node.operator) return [node.label ?? null];
  return node.children.flatMap(leafLabels);
}

/** Visible (non-silent) transitions in the net. */
function visibleTransitions(net) {
  return [...net.transitions.values()].filter(t => !t.silent);
}

/** Sorted labels of currently-enabled visible transitions. */
function enabledVisibleLabels(net) {
  net.updateEnabledTransitions();
  return [...net.transitions.values()]
    .filter(t => t.isEnabled && !t.silent)
    .map(t => t.label)
    .sort();
}

/** Arcs whose source is the given place. */
function arcsFromPlace(net, place) {
  return [...net.arcs.values()].filter(a => a.source === place.id);
}

// Net manipulation helpers
function _fireT(net, t) {
  for (const arc of net.arcs.values()) {
    if (arc.target === t.id) { const p = net.places.get(arc.source); if (p) p.tokens--; }
    if (arc.source === t.id) { const p = net.places.get(arc.target); if (p) p.tokens++; }
  }
  net.updateEnabledTransitions();
}

/** Fire all enabled silent transitions until quiescent. */
function fireSilents(net) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of net.transitions.values()) {
      if (t.silent && t.isEnabled) { _fireT(net, t); changed = true; break; }
    }
  }
}

/** Fire the first enabled visible transition with the given label. */
function fireLabel(net, label) {
  net.updateEnabledTransitions();
  for (const t of net.transitions.values()) {
    if (t.label === label && t.isEnabled) { _fireT(net, t); return true; }
  }
  return false;
}

function resetNet(net, source) {
  for (const p of net.places.values()) p.tokens = 0;
  source.tokens = 1;
  net.updateEnabledTransitions();
}

/**
 * Attempt to replay a sequence of visible activities.
 * Silents are fired greedily before each visible step.
 * NOTE: only reliable for τ-free nets; XOR(τ,X) nodes need manual routing.
 */
function replay(net, source, acts) {
  resetNet(net, source);
  for (const act of acts) {
    fireSilents(net);
    if (!fireLabel(net, act)) return false;
  }
  fireSilents(net);
  return true;
}

// ── 1. Base cases ─────────────────────────────────────────────────────────────

describe('base case — single activity', () => {
  const uvcl = makeUVCL([['A'], 3]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree is a leaf (operator is null)', () => {
    assert.equal(tree.operator, null);
  });
  it('leaf label is A', () => {
    assert.equal(tree.label, 'A');
  });
  it('net has exactly 1 visible transition', () => {
    assert.equal(visibleTransitions(net).length, 1);
  });
  it('only A is enabled initially', () => {
    resetNet(net, source);
    assert.deepEqual(enabledVisibleLabels(net), ['A']);
  });
  it('replay [A] places token in sink', () => {
    assert.ok(replay(net, source, ['A']));
    assert.equal(sink.tokens, 1);
  });
});

describe('base case — empty log (τ leaf)', () => {
  const uvcl = makeUVCL([[], 3]);
  const { processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree is a silent leaf (null operator, null label)', () => {
    assert.equal(tree.operator, null);
    assert.equal(tree.label, null);
  });
});

describe('base case — single activity self-loop', () => {
  // [A], [A,A], [A,A,A] — A repeats → LOOP(A, τ)
  const uvcl = makeUVCL([['A'], 1], [['A', 'A'], 1], [['A', 'A', 'A'], 1]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is loop', () => {
    assert.equal(tree.operator, 'loop');
  });
  it('do-body is leaf A', () => {
    assert.equal(tree.children[0].label, 'A');
  });
  it('redo is τ (silent leaf)', () => {
    assert.equal(tree.children[1].operator, null);
    assert.equal(tree.children[1].label, null);
  });
  it('firing A once lands token in sink', () => {
    // Manual simulation: don't call fireSilents after the last visible step,
    // because τ_redo is also enabled from pOut and would loop back.
    resetNet(net, source);
    assert.ok(fireLabel(net, 'A'));
    assert.equal(sink.tokens, 1);
  });
  it('firing A, τ_redo, A loops and lands in sink', () => {
    resetNet(net, source);
    assert.ok(fireLabel(net, 'A'));       // first do: token in pOut
    // fire the silent redo (τ_redo: pOut→pIn) to loop back
    const silentEnabled = [...net.transitions.values()].find(t => t.silent && t.isEnabled);
    assert.ok(silentEnabled, 'redo τ should be enabled after first A');
    _fireT(net, silentEnabled);           // token back in pIn
    assert.ok(fireLabel(net, 'A'));       // second do: token in pOut again
    assert.equal(sink.tokens, 1);
  });
});

describe('base case — single activity self-loop with optional exit', () => {
  // [A], [A,A], [A,B], [A,A,B] → SEQ(LOOP(A,τ), XOR(τ,B))
  const uvcl = makeUVCL([['A'], 1], [['A','A'], 1], [['A','A','A'], 1],
                         [['A','B'], 1], [['A','A','B'], 1]);
  const { processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('top-level is sequence', () => {
    assert.equal(tree.operator, 'sequence');
  });
  it('first child is a loop', () => {
    assert.equal(tree.children[0].operator, 'loop');
  });
  it('loop do-body is A', () => {
    assert.equal(tree.children[0].children[0].label, 'A');
  });
  it('loop redo is τ', () => {
    assert.equal(tree.children[0].children[1].label, null);
  });
  it('second child is xor', () => {
    assert.equal(tree.children[1].operator, 'xor');
  });
  it('xor contains τ and B', () => {
    const labels = tree.children[1].children.map(c => c.label).sort();
    assert.deepEqual(labels, [null, 'B'].sort((a,b) => String(a).localeCompare(String(b))));
  });
});

describe('base case — empty trace + activity (EmptyTraces fall-through)', () => {
  const uvcl = makeUVCL([[], 2], [['A'], 3]);
  const { processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is xor', () => {
    assert.equal(tree.operator, 'xor');
  });
  it('xor has 2 children', () => {
    assert.equal(tree.children.length, 2);
  });
  it('first child is τ (silent leaf)', () => {
    assert.equal(tree.children[0].operator, null);
    assert.equal(tree.children[0].label, null);
  });
  it('second child is leaf A', () => {
    assert.equal(tree.children[1].label, 'A');
  });
});

// ── 2. XOR cut ────────────────────────────────────────────────────────────────

describe('xor cut — two single-activity variants', () => {
  const uvcl = makeUVCL([['A'], 3], [['B'], 2]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is xor', () => {
    assert.equal(tree.operator, 'xor');
  });
  it('xor children are exactly A and B', () => {
    const ls = tree.children.map(c => c.label).sort();
    assert.deepEqual(ls, ['A', 'B']);
  });
  it('2 visible transitions', () => {
    assert.equal(visibleTransitions(net).length, 2);
  });
  it('both A and B enabled initially', () => {
    resetNet(net, source);
    assert.deepEqual(enabledVisibleLabels(net), ['A', 'B']);
  });
  it('replay [A] reaches sink', () => {
    assert.ok(replay(net, source, ['A']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [B] reaches sink', () => {
    assert.ok(replay(net, source, ['B']));
    assert.equal(sink.tokens, 1);
  });
  it('no arcs leave the sink', () => {
    assert.equal(arcsFromPlace(net, sink).length, 0);
  });
});

describe('xor cut — two sequence variants', () => {
  // [A,B] and [C,D] → XOR(SEQ(A,B), SEQ(C,D))
  const uvcl = makeUVCL([['A', 'B'], 3], [['C', 'D'], 3]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('top-level operator is xor', () => {
    assert.equal(tree.operator, 'xor');
  });
  it('both children are sequences', () => {
    assert.ok(tree.children.every(c => c.operator === 'sequence'));
  });
  it('all four activities appear as leaves', () => {
    assert.deepEqual(leafLabels(tree).sort(), ['A', 'B', 'C', 'D']);
  });
  it('replay [A,B] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [C,D] reaches sink', () => {
    assert.ok(replay(net, source, ['C', 'D']));
    assert.equal(sink.tokens, 1);
  });
});

// ── 3. Sequence cut ───────────────────────────────────────────────────────────

describe('sequence cut — simple three-step', () => {
  const uvcl = makeUVCL([['A', 'B', 'C'], 5]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is sequence', () => {
    assert.equal(tree.operator, 'sequence');
  });
  it('has 3 children in order A, B, C', () => {
    assert.equal(tree.children.length, 3);
    assert.deepEqual(tree.children.map(c => c.label), ['A', 'B', 'C']);
  });
  it('only A enabled initially', () => {
    resetNet(net, source);
    assert.deepEqual(enabledVisibleLabels(net), ['A']);
  });
  it('replay [A,B,C] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B', 'C']));
    assert.equal(sink.tokens, 1);
  });
  it('no arcs leave the sink', () => {
    assert.equal(arcsFromPlace(net, sink).length, 0);
  });
});

describe('sequence cut — inner XOR branch', () => {
  // [A,B,C] and [A,D,C] → SEQ(A, XOR(B,D), C)
  const uvcl = makeUVCL([['A', 'B', 'C'], 3], [['A', 'D', 'C'], 3]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('top-level is sequence', () => {
    assert.equal(tree.operator, 'sequence');
  });
  it('first child is A, last is C', () => {
    assert.equal(tree.children[0].label, 'A');
    assert.equal(tree.children[tree.children.length - 1].label, 'C');
  });
  it('middle child is xor', () => {
    assert.equal(tree.children[1].operator, 'xor');
  });
  it('xor children are B and D', () => {
    const ls = tree.children[1].children.map(c => c.label).sort();
    assert.deepEqual(ls, ['B', 'D']);
  });
  it('only A enabled initially', () => {
    resetNet(net, source);
    assert.deepEqual(enabledVisibleLabels(net), ['A']);
  });
  it('replay [A,B,C] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B', 'C']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [A,D,C] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'D', 'C']));
    assert.equal(sink.tokens, 1);
  });
});

describe('sequence cut — filter-based projection (repeated activities)', () => {
  // Validates that _seqProject correctly handles activities that repeat within
  // a sequence group (e.g. the running-example middle: ec,ct,d appear twice in
  // one trace).  A wrong split-point approach loses the tail occurrences.
  const uvcl = makeUVCL(
    [['ec', 'ct', 'd', 'ri', 'et', 'ct', 'd'], 1],
    [['ct', 'ec', 'd'],                         2],
    [['ec', 'ct', 'd'],                         1],
    [['et', 'ct', 'd'],                         1],
    [['ec', 'ct', 'd', 'ri', 'ec', 'ct', 'd'], 1],
  );
  const { processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('top-level is loop (not a flower model)', () => {
    assert.equal(tree.operator, 'loop',
      `got ${treeStr(tree)} — repeated activities confused the projection`);
  });
  it('redo is ri', () => {
    assert.equal(tree.children[1].label, 'ri');
  });
  it('do-body contains et, ec, ct and d', () => {
    const dl = leafLabels(tree.children[0]).filter(l => l !== null);
    for (const act of ['et', 'ec', 'ct', 'd']) {
      assert.ok(dl.includes(act), `${act} missing from do-body: ${dl}`);
    }
  });
  it('do-body is a sequence (not a flower)', () => {
    assert.equal(tree.children[0].operator, 'sequence');
  });
});

// ── 4. Concurrency cut ────────────────────────────────────────────────────────

describe('concurrency cut — flat PAR(A, B)', () => {
  // [A,B] and [B,A] — both orderings observed
  const uvcl = makeUVCL([['A', 'B'], 3], [['B', 'A'], 3]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is parallel', () => {
    assert.equal(tree.operator, 'parallel');
  });
  it('2 children: A and B', () => {
    assert.equal(tree.children.length, 2);
    assert.deepEqual(tree.children.map(c => c.label).sort(), ['A', 'B']);
  });
  it('2 visible transitions', () => {
    assert.equal(visibleTransitions(net).length, 2);
  });
  it('replay [A,B] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [B,A] reaches sink', () => {
    assert.ok(replay(net, source, ['B', 'A']));
    assert.equal(sink.tokens, 1);
  });
  it('no arcs leave the sink', () => {
    assert.equal(arcsFromPlace(net, sink).length, 0);
  });
});

describe('concurrency cut — PAR inside SEQ  (a, par(b,c), d)', () => {
  const uvcl = makeUVCL([['a', 'b', 'c', 'd'], 3], [['a', 'c', 'b', 'd'], 3]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('top-level is sequence with 3 children', () => {
    assert.equal(tree.operator, 'sequence');
    assert.equal(tree.children.length, 3);
  });
  it('first child is leaf a', () => {
    assert.equal(tree.children[0].label, 'a');
  });
  it('middle child is parallel', () => {
    assert.equal(tree.children[1].operator, 'parallel');
  });
  it('parallel children are b and c', () => {
    assert.deepEqual(tree.children[1].children.map(c => c.label).sort(), ['b', 'c']);
  });
  it('last child is leaf d', () => {
    assert.equal(tree.children[2].label, 'd');
  });
  it('only a enabled initially — no silent transitions required first', () => {
    resetNet(net, source);
    const enabled = [...net.transitions.values()].filter(t => t.isEnabled);
    assert.equal(enabled.filter(t => t.silent).length, 0);
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].label, 'a');
  });
  it('no arcs leave the sink', () => {
    assert.equal(arcsFromPlace(net, sink).length, 0);
  });
  it('replay [a,b,c,d] reaches sink', () => {
    assert.ok(replay(net, source, ['a', 'b', 'c', 'd']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [a,c,b,d] reaches sink', () => {
    assert.ok(replay(net, source, ['a', 'c', 'b', 'd']));
    assert.equal(sink.tokens, 1);
  });
});

// ── 5. Loop cut ───────────────────────────────────────────────────────────────

describe('loop cut — leaf do and leaf redo', () => {
  const uvcl = makeUVCL([['A'], 3], [['A', 'B', 'A'], 2], [['A', 'B', 'A', 'B', 'A'], 1]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is loop', () => {
    assert.equal(tree.operator, 'loop');
  });
  it('do-body is leaf A', () => {
    assert.equal(tree.children[0].label, 'A');
  });
  it('redo is leaf B', () => {
    assert.equal(tree.children[1].label, 'B');
  });
  it('only A enabled initially', () => {
    resetNet(net, source);
    assert.deepEqual(enabledVisibleLabels(net), ['A']);
  });
  it('replay [A] reaches sink', () => {
    assert.ok(replay(net, source, ['A']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [A,B,A] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B', 'A']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [A,B,A,B,A] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B', 'A', 'B', 'A']));
    assert.equal(sink.tokens, 1);
  });
});

describe('loop cut — sequence do-body, leaf redo', () => {
  // [A,B] and [A,B,C,A,B] → LOOP(SEQ(A,B), C)
  const uvcl = makeUVCL([['A', 'B'], 2], [['A', 'B', 'C', 'A', 'B'], 1]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is loop', () => {
    assert.equal(tree.operator, 'loop');
  });
  it('do-body is sequence', () => {
    assert.equal(tree.children[0].operator, 'sequence');
  });
  it('do-body children are A then B', () => {
    assert.deepEqual(tree.children[0].children.map(c => c.label), ['A', 'B']);
  });
  it('redo is leaf C', () => {
    assert.equal(tree.children[1].label, 'C');
  });
  it('only A enabled initially', () => {
    resetNet(net, source);
    assert.deepEqual(enabledVisibleLabels(net), ['A']);
  });
  it('replay [A,B] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [A,B,C,A,B] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B', 'C', 'A', 'B']));
    assert.equal(sink.tokens, 1);
  });
});

describe('loop cut — two redo options', () => {
  // [A], [A,B,A], [A,C,A] — B and C are separate redo groups
  const uvcl = makeUVCL([['A'], 2], [['A', 'B', 'A'], 2], [['A', 'C', 'A'], 2]);
  const { net, source, sink, processTree: tree } = applyInductiveMinerUvcl(uvcl);

  it('tree operator is loop', () => {
    assert.equal(tree.operator, 'loop');
  });
  it('do-body is leaf A', () => {
    assert.equal(tree.children[0].label, 'A');
  });
  it('redo options include B and C', () => {
    const redoLabels = tree.children.slice(1).flatMap(leafLabels).filter(Boolean);
    assert.ok(redoLabels.includes('B'), `B missing; redo: ${redoLabels}`);
    assert.ok(redoLabels.includes('C'), `C missing; redo: ${redoLabels}`);
  });
  it('only A enabled initially', () => {
    resetNet(net, source);
    assert.deepEqual(enabledVisibleLabels(net), ['A']);
  });
  it('replay [A] reaches sink', () => {
    assert.ok(replay(net, source, ['A']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [A,B,A] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'B', 'A']));
    assert.equal(sink.tokens, 1);
  });
  it('replay [A,C,A] reaches sink', () => {
    assert.ok(replay(net, source, ['A', 'C', 'A']));
    assert.equal(sink.tokens, 1);
  });
});

// ── 6. Petri net structural invariants ───────────────────────────────────────

describe('petri net invariants — bipartite arcs and markings', () => {
  const cases = [
    ['single A',          makeUVCL([['A'], 1])],
    ['xor A|B',           makeUVCL([['A'], 1], [['B'], 1])],
    ['seq A B C',         makeUVCL([['A','B','C'], 1])],
    ['par A||B',          makeUVCL([['A','B'], 1], [['B','A'], 1])],
    ['loop A redo B',     makeUVCL([['A'], 1], [['A','B','A'], 1])],
    ['seq(a,par(b,c),d)', makeUVCL([['a','b','c','d'],1],[['a','c','b','d'],1])],
    ['xor AB|CD',         makeUVCL([['A','B'], 1], [['C','D'], 1])],
  ];

  for (const [label, uvcl] of cases) {
    it(`[${label}] every arc connects place↔transition`, () => {
      const { net } = applyInductiveMinerUvcl(uvcl);
      for (const arc of net.arcs.values()) {
        const sp = net.places.has(arc.source), tp = net.places.has(arc.target);
        const st = net.transitions.has(arc.source), tt = net.transitions.has(arc.target);
        assert.ok((sp && tt) || (st && tp),
          `arc ${arc.source}→${arc.target} violates bipartite property`);
      }
    });
    it(`[${label}] source has 1 initial token`, () => {
      const { source } = applyInductiveMinerUvcl(uvcl);
      assert.equal(source.tokens, 1);
    });
    it(`[${label}] sink has finalMarking=1`, () => {
      const { sink } = applyInductiveMinerUvcl(uvcl);
      assert.equal(sink.finalMarking, 1);
    });
    it(`[${label}] initialMarking map seeds source with 1`, () => {
      const { source, initialMarking } = applyInductiveMinerUvcl(uvcl);
      assert.equal(initialMarking.get(source.id), 1);
    });
    it(`[${label}] finalMarking map identifies sink with 1`, () => {
      const { sink, finalMarking } = applyInductiveMinerUvcl(uvcl);
      assert.equal(finalMarking.get(sink.id), 1);
    });
  }
});

// ── 7. Functional: running_example.xes ───────────────────────────────────────

describe('applyInductiveMiner — running_example.xes', () => {
  const log = xesParser.parse(RUNNING_EXAMPLE_XES);
  const { net, source, sink, processTree: tree, initialMarking, finalMarking } = applyInductiveMiner(log);

  const knownActivities = [
    'register request', 'examine casually', 'check ticket',
    'decide', 'reinitiate request', 'examine thoroughly',
    'pay compensation', 'reject request',
  ];

  it('8 visible transitions — one per activity', () => {
    assert.equal(visibleTransitions(net).length, 8);
  });

  it('all 8 known activities appear as transitions', () => {
    const labels = new Set(visibleTransitions(net).map(t => t.label));
    for (const act of knownActivities) {
      assert.ok(labels.has(act), `missing transition: ${act}`);
    }
  });

  it('top-level tree is a sequence', () => {
    assert.equal(tree.operator, 'sequence');
  });

  it('sequence has exactly 3 children', () => {
    assert.equal(tree.children.length, 3);
  });

  it('first sequence child is register request', () => {
    assert.equal(tree.children[0].label, 'register request');
  });

  it('middle sequence child is a loop', () => {
    assert.equal(tree.children[1].operator, 'loop');
  });

  it('loop redo contains reinitiate request', () => {
    const redoLabels = tree.children[1].children.slice(1).flatMap(leafLabels);
    assert.ok(redoLabels.includes('reinitiate request'),
      `reinitiate request not found in redo; got: ${redoLabels}`);
  });

  it('final sequence child is an xor', () => {
    assert.equal(tree.children[2].operator, 'xor');
  });

  it('final xor contains pay compensation and reject request', () => {
    const endLabels = leafLabels(tree.children[2]).filter(Boolean);
    assert.ok(endLabels.includes('pay compensation'));
    assert.ok(endLabels.includes('reject request'));
  });

  it('source has 1 initial token', () => {
    assert.equal(source.tokens, 1);
  });

  it('sink has finalMarking=1', () => {
    assert.equal(sink.finalMarking, 1);
  });

  it('initialMarking map seeds source with 1', () => {
    assert.equal(initialMarking.get(source.id), 1);
  });

  it('finalMarking map identifies sink with 1', () => {
    assert.equal(finalMarking.get(sink.id), 1);
  });

  it('only register request is enabled initially — no silent first', () => {
    resetNet(net, source);
    const enabled = [...net.transitions.values()].filter(t => t.isEnabled);
    assert.equal(enabled.filter(t => t.silent).length, 0,
      'silent transitions should not fire before register request');
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].label, 'register request');
  });

  it('no arcs leave the sink', () => {
    assert.equal(arcsFromPlace(net, sink).length, 0);
  });

  it('source connects directly to register request', () => {
    const rrT = [...net.transitions.values()]
      .find(t => t.label === 'register request');
    assert.ok(rrT);
    const connected = [...net.arcs.values()]
      .some(a => a.source === source.id && a.target === rrT.id);
    assert.ok(connected, 'source does not directly connect to register request');
  });
});

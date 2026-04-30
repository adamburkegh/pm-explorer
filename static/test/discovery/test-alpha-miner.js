/**
 * Tests for alpha-miner.js — classic Alpha Miner.
 *
 * Unit tests use a tiny three-trace fixture log:
 *   case-1: [A, B, C]
 *   case-2: [A, C]
 *   case-3: [A, B, C]
 *
 * Known relations for this log:
 *   DFG:      A→B:2, A→C:1, B→C:2
 *   causal:   A→B, A→C, B→C   (no bidirectional edges)
 *   parallel: (none)
 *
 * Maximal (A,B) pairs (by hand):
 *   ({A},{B}), ({A},{C}), ({B},{C})   — no merging possible
 *
 * Expected net structure:
 *   Transitions:  A, B, C   (3)
 *   Places:       source, sink, p({A},{B}), p({A},{C}), p({B},{C})   (5)
 *   Arcs (8):     source→A, A→p1, p1→B, A→p2, p2→C, B→p3, p3→C, C→sink
 *   Initial:      source has 1 token
 *   Final:        sink  has finalMarking 1
 */

// ── Shared fixture ────────────────────────────────────────────────────────────

function makeAlphaFixtureLog() {
  const log = new EventLog();
  const cases = [
    { id: 'case-1', acts: ['A', 'B', 'C'] },
    { id: 'case-2', acts: ['A', 'C'] },
    { id: 'case-3', acts: ['A', 'B', 'C'] },
  ];
  for (const { id, acts } of cases) {
    const trace = new Trace();
    trace.attributes[DEFAULT_NAME_KEY] = id;
    let ts = new Date('2024-01-01T08:00:00Z').getTime();
    for (const act of acts) {
      trace.append(new Event({
        [DEFAULT_NAME_KEY]: act,
        [DEFAULT_TIMESTAMP_KEY]: new Date(ts),
      }));
      ts += 3600000; // +1 hour
    }
    log.append(trace);
  }
  return log;
}

// ── buildCausalRelation ───────────────────────────────────────────────────────

describe('buildCausalRelation', () => {
  const dfg = new Map([
    [dfgKey('A', 'B'), 2],
    [dfgKey('A', 'C'), 1],
    [dfgKey('B', 'C'), 2],
  ]);

  it('identifies all three causal pairs', () => {
    const causal = buildCausalRelation(dfg);
    assert.ok(causal.has(dfgKey('A', 'B')));
    assert.ok(causal.has(dfgKey('A', 'C')));
    assert.ok(causal.has(dfgKey('B', 'C')));
    assert.equal(causal.size, 3);
  });

  it('excludes parallel edges from causal', () => {
    const dfg2 = new Map([
      [dfgKey('A', 'B'), 2],
      [dfgKey('B', 'A'), 2], // bidirectional → parallel, not causal
    ]);
    const causal = buildCausalRelation(dfg2);
    assert.equal(causal.size, 0);
  });

  it('handles empty DFG', () => {
    assert.equal(buildCausalRelation(new Map()).size, 0);
  });
});

// ── buildParallelRelation ─────────────────────────────────────────────────────

describe('buildParallelRelation', () => {
  it('empty when no bidirectional edges', () => {
    const dfg = new Map([
      [dfgKey('A', 'B'), 2],
      [dfgKey('B', 'C'), 2],
    ]);
    assert.equal(buildParallelRelation(dfg).size, 0);
  });

  it('includes both directions for bidirectional edges', () => {
    const dfg = new Map([
      [dfgKey('A', 'B'), 2],
      [dfgKey('B', 'A'), 2],
    ]);
    const parallel = buildParallelRelation(dfg);
    assert.ok(parallel.has(dfgKey('A', 'B')));
    assert.ok(parallel.has(dfgKey('B', 'A')));
    assert.equal(parallel.size, 2);
  });

  it('handles empty DFG', () => {
    assert.equal(buildParallelRelation(new Map()).size, 0);
  });
});

// ── applyAlphaMiner — small fixture ──────────────────────────────────────────

describe('applyAlphaMiner (fixture log)', () => {
  const log = makeAlphaFixtureLog();
  const { net, initialMarking, finalMarking, source, sink, transitionMap } =
    applyAlphaMiner(log);

  describe('transitions', () => {
    it('has one transition per activity (3)', () => {
      assert.equal(net.transitions.size, 3);
    });

    it('has transitions for A, B, C', () => {
      assert.ok(transitionMap.has('A'));
      assert.ok(transitionMap.has('B'));
      assert.ok(transitionMap.has('C'));
    });

    it('transition labels match activity names', () => {
      assert.equal(transitionMap.get('A').label, 'A');
      assert.equal(transitionMap.get('C').label, 'C');
    });
  });

  describe('places', () => {
    it('has 5 places: source + sink + 3 internal', () => {
      assert.equal(net.places.size, 5);
    });

    it('source place has 1 token (initial marking)', () => {
      assert.equal(source.tokens, 1);
    });

    it('initialMarking maps source place to 1', () => {
      assert.equal(initialMarking.get(source.id), 1);
    });

    it('sink place has finalMarking=1', () => {
      assert.equal(sink.finalMarking, 1);
    });

    it('finalMarking maps sink place to 1', () => {
      assert.equal(finalMarking.get(sink.id), 1);
    });
  });

  describe('arcs', () => {
    it('has 8 arcs', () => {
      assert.equal(net.arcs.size, 8);
    });

    it('source connects to transition A only', () => {
      const outFromSource = [...net.arcs.values()].filter(
        a => a.source === source.id
      );
      assert.equal(outFromSource.length, 1);
      assert.equal(outFromSource[0].target, transitionMap.get('A').id);
    });

    it('sink receives from transition C only', () => {
      const intoSink = [...net.arcs.values()].filter(
        a => a.target === sink.id
      );
      assert.equal(intoSink.length, 1);
      assert.equal(intoSink[0].source, transitionMap.get('C').id);
    });

    it('transition A has 2 output arcs (to internal places)', () => {
      const outFromA = [...net.arcs.values()].filter(
        a => a.source === transitionMap.get('A').id
      );
      assert.equal(outFromA.length, 2);
    });

    it('transition C has 2 input arcs (from internal places)', () => {
      const intoC = [...net.arcs.values()].filter(
        a => a.target === transitionMap.get('C').id
      );
      assert.equal(intoC.length, 2);
    });

    it('transition B has 1 input and 1 output arc', () => {
      const intoB  = [...net.arcs.values()].filter(a => a.target === transitionMap.get('B').id);
      const outOfB = [...net.arcs.values()].filter(a => a.source === transitionMap.get('B').id);
      assert.equal(intoB.length,  1);
      assert.equal(outOfB.length, 1);
    });
  });

  describe('petri net firing (semantic check)', () => {
    it('only transition A is enabled in initial marking', () => {
      net.updateEnabledTransitions();
      const enabled = [...net.transitions.values()].filter(t => t.isEnabled);
      assert.equal(enabled.length, 1);
      assert.equal(enabled[0].label, 'A');
    });
  });
});

// ── applyAlphaMinerDfg — direct DFG input ────────────────────────────────────

describe('applyAlphaMinerDfg', () => {
  it('gives the same net when called with pre-computed DFG', () => {
    const log  = makeAlphaFixtureLog();
    const { graph, startActivities, endActivities } = getDFG(log, {});
    const { net } = applyAlphaMinerDfg(graph, startActivities, endActivities);
    assert.equal(net.places.size, 5);
    assert.equal(net.transitions.size, 3);
  });
});

// ── Concurrent activities — merge prevention ──────────────────────────────────

describe('concurrent activities (A||B before C)', () => {
  // Traces: [A,B,C], [B,A,C]
  // DFG:      A→B:1, B→A:1, A→C:1, B→C:1
  // parallel: A→B, B→A   (bidirectional)
  // causal:   A→C, B→C   (no causal between A and B)
  //
  // Initial pairs (both pass initial filter — no self-loops in parallel):
  //   ({A},{C}), ({B},{C})
  //
  // Merge attempt: t1[1]⊆t2[1] ({C}⊆{C}) → check unrelated({A},{B})
  //   A→B is in parallel → UNRELATED → cannot merge
  //
  // Result: 2 internal places  (not the merged ({A,B},{C}))
  // Total places: source + sink + p({A},{C}) + p({B},{C}) = 4

  const _log = new EventLog();
  for (const acts of [['A', 'B', 'C'], ['B', 'A', 'C']]) {
    const trace = new Trace();
    trace.attributes[DEFAULT_NAME_KEY] = 'cx';
    let ts = new Date('2024-01-01T08:00:00Z').getTime();
    for (const act of acts) {
      trace.append(new Event({
        [DEFAULT_NAME_KEY]: act,
        [DEFAULT_TIMESTAMP_KEY]: new Date(ts),
      }));
      ts += 3600000;
    }
    _log.append(trace);
  }

  const { net: _net } = applyAlphaMiner(_log);

  it('produces 3 transitions (A, B, C)', () => {
    assert.equal(_net.transitions.size, 3);
  });

  it('produces 4 places (source + sink + 2 internal — not merged)', () => {
    // If A||B were incorrectly merged, we would get only 3 places.
    assert.equal(_net.places.size, 4);
  });
});

// ── Functional: running_example.xes ──────────────────────────────────────────

describe('applyAlphaMiner (running_example.xes)', () => {
  const log = xesParser.parse(RUNNING_EXAMPLE_XES);
  const { net, source, sink, transitionMap } = applyAlphaMiner(log);

  it('produces one transition per activity (8 activities)', () => {
    assert.equal(net.transitions.size, 8);
  });

  it('has all known activities as transitions', () => {
    const knownActivities = [
      'register request', 'examine casually', 'check ticket',
      'decide', 'reinitiate request', 'examine thoroughly',
      'pay compensation', 'reject request',
    ];
    for (const act of knownActivities) {
      assert.ok(transitionMap.has(act), `missing transition: ${act}`);
    }
  });

  it('has more than 2 places (source + sink + at least one internal)', () => {
    assert.ok(net.places.size > 2);
  });

  it('start activity (register request) is reached from source', () => {
    const arcsFromSource = [...net.arcs.values()].filter(
      a => a.source === source.id
    );
    const targetIds = arcsFromSource.map(a => a.target);
    const registerReq = transitionMap.get('register request');
    assert.ok(registerReq, 'register request transition missing');
    assert.ok(targetIds.includes(registerReq.id),
              'source should connect to register request');
  });

  it('end activities (pay compensation, reject request) connect to sink', () => {
    const arcsToSink = [...net.arcs.values()].filter(a => a.target === sink.id);
    const sourceIds  = new Set(arcsToSink.map(a => a.source));
    const payCo  = transitionMap.get('pay compensation');
    const reject = transitionMap.get('reject request');
    assert.ok(payCo  && sourceIds.has(payCo.id),  'pay compensation → sink missing');
    assert.ok(reject && sourceIds.has(reject.id),  'reject request → sink missing');
  });

  it('source place has 1 token', () => {
    assert.equal(source.tokens, 1);
  });

  it('sink place has finalMarking = 1', () => {
    assert.equal(sink.finalMarking, 1);
  });

  it('initial marking: only register request is enabled', () => {
    net.updateEnabledTransitions();
    const enabled = [...net.transitions.values()].filter(t => t.isEnabled);
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].label, 'register request');
  });
});

/**
 * Tests for log-util.js.
 * Translated from pm4py statistics/ and algo/discovery/dfg/ tests.
 *
 * All unit tests use a shared fixture log:
 *   case-1: [A, B, C]   (3 events)
 *   case-2: [A, C]       (2 events)
 *   case-3: [A, B, C]   (3 events)
 *
 * Known values:
 *   variants:         {[A,B,C]:2, [A,C]:1}
 *   start activities: {A:3}
 *   end activities:   {C:3}
 *   DFG edges:        A→B:2, A→C:1, B→C:2
 */

// ── Fixture builder ───────────────────────────────────────────────────────────

function makeFixtureLog() {
  const log = new EventLog();
  const cases = [
    { id: 'case-1', acts: ['A', 'B', 'C'], timestamps: ['2024-01-01T08:00Z', '2024-01-01T09:00Z', '2024-01-01T10:00Z'] },
    { id: 'case-2', acts: ['A', 'C'],       timestamps: ['2024-01-02T08:00Z', '2024-01-02T10:00Z'] },
    { id: 'case-3', acts: ['A', 'B', 'C'], timestamps: ['2024-01-03T08:00Z', '2024-01-03T09:00Z', '2024-01-03T10:00Z'] },
  ];
  for (const { id, acts, timestamps } of cases) {
    const trace = new Trace();
    trace.attributes[DEFAULT_NAME_KEY] = id;
    for (let i = 0; i < acts.length; i++) {
      trace.append(new Event({
        [DEFAULT_NAME_KEY]:    acts[i],
        [DEFAULT_TIMESTAMP_KEY]: new Date(timestamps[i]),
        'org:resource': 'Pete',
      }));
    }
    log.append(trace);
  }
  return log;
}

const LOG = makeFixtureLog();

// ── Variant key encoding ──────────────────────────────────────────────────────

describe('arrayToVariantKey / variantKeyToArray', () => {
  it('roundtrips simple array', () => {
    const arr = ['A', 'B', 'C'];
    assert.deepEqual(variantKeyToArray(arrayToVariantKey(arr)), arr);
  });

  it('roundtrips empty array', () => {
    assert.deepEqual(variantKeyToArray(arrayToVariantKey([])), []);
  });

  it('different arrays produce different keys', () => {
    assert.notEqual(arrayToVariantKey(['A', 'B']), arrayToVariantKey(['A', 'C']));
    assert.notEqual(arrayToVariantKey(['A', 'B']), arrayToVariantKey(['B', 'A']));
  });

  it('same array produces same key', () => {
    assert.equal(arrayToVariantKey(['X', 'Y', 'Z']), arrayToVariantKey(['X', 'Y', 'Z']));
  });
});

// ── DFG key encoding ──────────────────────────────────────────────────────────

describe('dfgKey / dfgKeyParts', () => {
  it('roundtrips a pair', () => {
    const [a, b] = dfgKeyParts(dfgKey('register request', 'examine casually'));
    assert.equal(a, 'register request');
    assert.equal(b, 'examine casually');
  });

  it('different pairs produce different keys', () => {
    assert.notEqual(dfgKey('A', 'B'), dfgKey('B', 'A'));
    assert.notEqual(dfgKey('A', 'B'), dfgKey('A', 'C'));
  });
});

// ── getVariantFromTrace ───────────────────────────────────────────────────────

describe('getVariantFromTrace', () => {
  it('returns activity sequence', () => {
    const trace = LOG.at(0);
    assert.deepEqual(getVariantFromTrace(trace), ['A', 'B', 'C']);
  });

  it('respects custom activity key', () => {
    const trace = new Trace();
    trace.append(new Event({ 'Activity': 'X' }));
    trace.append(new Event({ 'Activity': 'Y' }));
    assert.deepEqual(getVariantFromTrace(trace, 'Activity'), ['X', 'Y']);
  });

  it('returns empty array for empty trace', () => {
    assert.deepEqual(getVariantFromTrace(new Trace()), []);
  });

  it('skips events missing the activity key', () => {
    const trace = new Trace();
    trace.append(new Event({ 'concept:name': 'A' }));
    trace.append(new Event({ 'other': 'x' }));  // no concept:name
    assert.deepEqual(getVariantFromTrace(trace), ['A']);
  });
});

// ── getVariants ───────────────────────────────────────────────────────────────

describe('getVariants', () => {
  const variants = getVariants(LOG);

  it('returns a Map', () => {
    assert.instanceOf(variants, Map);
  });

  it('has correct number of distinct variants', () => {
    // [A,B,C] appears in case-1 and case-3; [A,C] appears in case-2
    assert.equal(variants.size, 2);
  });

  it('variant [A,B,C] contains 2 traces', () => {
    const key = arrayToVariantKey(['A', 'B', 'C']);
    assert.ok(variants.has(key));
    assert.equal(variants.get(key).length, 2);
  });

  it('variant [A,C] contains 1 trace', () => {
    const key = arrayToVariantKey(['A', 'C']);
    assert.ok(variants.has(key));
    assert.equal(variants.get(key).length, 1);
  });

  it('trace objects in variant are the same references from the log', () => {
    const key = arrayToVariantKey(['A', 'C']);
    assert.equal(variants.get(key)[0], LOG.at(1));
  });
});

// ── getUVCL ───────────────────────────────────────────────────────────────────

describe('getUVCL', () => {
  const uvcl = getUVCL(LOG);

  it('returns a Map', () => {
    assert.instanceOf(uvcl, Map);
  });

  it('has correct variant counts', () => {
    assert.equal(uvcl.get(arrayToVariantKey(['A', 'B', 'C'])), 2);
    assert.equal(uvcl.get(arrayToVariantKey(['A', 'C'])),       1);
  });

  it('total count equals number of traces', () => {
    const total = Array.from(uvcl.values()).reduce((s, v) => s + v, 0);
    assert.equal(total, LOG.length);
  });
});

// ── getVariantsSortedByCount ──────────────────────────────────────────────────

describe('getVariantsSortedByCount', () => {
  it('sorts descending by count', () => {
    const uvcl = getUVCL(LOG);
    const sorted = getVariantsSortedByCount(uvcl);
    assert.equal(sorted[0][1], 2);  // [A,B,C] has count 2
    assert.equal(sorted[1][1], 1);  // [A,C] has count 1
  });

  it('works with variant→Trace[] Map from getVariants()', () => {
    const variants = getVariants(LOG);
    const sorted = getVariantsSortedByCount(variants);
    assert.equal(sorted[0][1], 2);
  });

  it('returns array of [key, count] pairs', () => {
    const sorted = getVariantsSortedByCount(getUVCL(LOG));
    assert.ok(Array.isArray(sorted[0]));
    assert.equal(sorted[0].length, 2);
  });
});

// ── getLanguage ───────────────────────────────────────────────────────────────

describe('getLanguage', () => {
  const lang = getLanguage(LOG);

  it('returns a Map', () => {
    assert.instanceOf(lang, Map);
  });

  it('probabilities sum to 1', () => {
    const total = Array.from(lang.values()).reduce((s, v) => s + v, 0);
    assert.closeTo(total, 1.0, 1e-9);
  });

  it('[A,B,C] has probability 2/3', () => {
    assert.closeTo(lang.get(arrayToVariantKey(['A', 'B', 'C'])), 2 / 3, 1e-9);
  });

  it('[A,C] has probability 1/3', () => {
    assert.closeTo(lang.get(arrayToVariantKey(['A', 'C'])), 1 / 3, 1e-9);
  });
});

// ── aggregateConsecutiveActivities ────────────────────────────────────────────

describe('aggregateConsecutiveActivities', () => {
  // Mirrors pm4py variants_util.aggregate_consecutive_activities_in_variants()
  it('collapses runs of same activity (maxRepetitions=1)', () => {
    const uvcl = new Map([
      [arrayToVariantKey(['A', 'B', 'B', 'B', 'C']), 2],
      [arrayToVariantKey(['A', 'B', 'C']), 3],
    ]);
    const result = aggregateConsecutiveActivities(uvcl, 1);
    const key = arrayToVariantKey(['A', 'B', 'C']);
    assert.ok(result.has(key));
    assert.equal(result.get(key), 5);  // 2+3 merged
    assert.equal(result.size, 1);
  });

  it('allows maxRepetitions=2', () => {
    const uvcl = new Map([
      [arrayToVariantKey(['A', 'B', 'B', 'B', 'C']), 1],
    ]);
    const result = aggregateConsecutiveActivities(uvcl, 2);
    // [A,B,B,B,C] → [A,B,B,C] (truncated to 2 B's)
    const key = arrayToVariantKey(['A', 'B', 'B', 'C']);
    assert.ok(result.has(key));
  });

  it('leaves already-collapsed variants unchanged', () => {
    const uvcl = getUVCL(LOG);
    const result = aggregateConsecutiveActivities(uvcl, 1);
    assert.equal(result.size, uvcl.size);
  });
});

// ── getStartActivities ────────────────────────────────────────────────────────

describe('getStartActivities', () => {
  const startActs = getStartActivities(LOG);

  it('returns a Map', () => {
    assert.instanceOf(startActs, Map);
  });

  it('A is the only start activity (all 3 traces start with A)', () => {
    assert.equal(startActs.size, 1);
    assert.equal(startActs.get('A'), 3);
  });

  it('count equals number of traces for single-start log', () => {
    const total = Array.from(startActs.values()).reduce((s, v) => s + v, 0);
    assert.equal(total, LOG.length);
  });

  it('empty log returns empty map', () => {
    assert.equal(getStartActivities(new EventLog()).size, 0);
  });
});

// ── getEndActivities ──────────────────────────────────────────────────────────

describe('getEndActivities', () => {
  const endActs = getEndActivities(LOG);

  it('C is the only end activity (all 3 traces end with C)', () => {
    assert.equal(endActs.size, 1);
    assert.equal(endActs.get('C'), 3);
  });

  it('count equals number of traces for single-end log', () => {
    const total = Array.from(endActs.values()).reduce((s, v) => s + v, 0);
    assert.equal(total, LOG.length);
  });

  it('empty log returns empty map', () => {
    assert.equal(getEndActivities(new EventLog()).size, 0);
  });
});

// ── getActivities ─────────────────────────────────────────────────────────────

describe('getActivities', () => {
  const acts = getActivities(LOG);

  it('returns a Set', () => {
    assert.instanceOf(acts, Set);
  });

  it('contains exactly A, B, C', () => {
    assert.equal(acts.size, 3);
    assert.includes(acts, 'A');
    assert.includes(acts, 'B');
    assert.includes(acts, 'C');
  });

  it('empty log returns empty set', () => {
    assert.equal(getActivities(new EventLog()).size, 0);
  });
});

// ── getDFG ────────────────────────────────────────────────────────────────────

describe('getDFG', () => {
  // Translated from pm4py algo/discovery/dfg/variants/native.py
  // Expected edges from fixture:
  //   A→B: case-1 + case-3 = 2
  //   B→C: case-1 + case-3 = 2
  //   A→C: case-2          = 1
  const { graph, startActivities, endActivities } = getDFG(LOG);

  it('graph is a Map', () => {
    assert.instanceOf(graph, Map);
  });

  it('A→B edge count is 2', () => {
    assert.equal(graph.get(dfgKey('A', 'B')), 2);
  });

  it('B→C edge count is 2', () => {
    assert.equal(graph.get(dfgKey('B', 'C')), 2);
  });

  it('A→C edge count is 1', () => {
    assert.equal(graph.get(dfgKey('A', 'C')), 1);
  });

  it('no spurious edges', () => {
    assert.equal(graph.size, 3);
  });

  it('start activities: A appears 3 times', () => {
    assert.equal(startActivities.get('A'), 3);
    assert.equal(startActivities.size, 1);
  });

  it('end activities: C appears 3 times', () => {
    assert.equal(endActivities.get('C'), 3);
    assert.equal(endActivities.size, 1);
  });

  it('keepOncePerCase=true deduplicates within a trace', () => {
    // Build a log where A→B appears twice in the same trace
    const log2 = new EventLog();
    const trace = new Trace();
    for (const act of ['A', 'B', 'A', 'B']) {
      trace.append(new Event({ [DEFAULT_NAME_KEY]: act }));
    }
    log2.append(trace);

    const dfgAll  = getDFG(log2, { keepOncePerCase: false });
    const dfgOnce = getDFG(log2, { keepOncePerCase: true  });

    assert.equal(dfgAll.graph.get(dfgKey('A', 'B')),  2);  // A→B, A→B
    assert.equal(dfgOnce.graph.get(dfgKey('A', 'B')), 1);  // deduplicated
  });

  it('window=2 skips one event', () => {
    // With window=2: pairs are (A,C), (B,C),(A,C) from [A,B,C]
    const { graph: g2 } = getDFG(LOG, { window: 2 });
    // case-1 [A,B,C]: A→C (i=2), B→C? no: events[0]→events[2] = A→C, events[1]→events[3] N/A → just A→C
    // Wait: window=2 means events[i-2] and events[i]:
    //   i=2: events[0]→events[2] = A→C  (case-1 and case-3: 2 times)
    //   case-2 [A,C]: i=2 → out of range (only 2 events), so nothing
    assert.equal(g2.get(dfgKey('A', 'C')), 2);
    assert.ok(!g2.has(dfgKey('A', 'B')));
    assert.ok(!g2.has(dfgKey('B', 'C')));
  });

  it('empty log produces empty DFG', () => {
    const { graph: g, startActivities: sa, endActivities: ea } = getDFG(new EventLog());
    assert.equal(g.size, 0);
    assert.equal(sa.size, 0);
    assert.equal(ea.size, 0);
  });
});

// ── variantToTrace ────────────────────────────────────────────────────────────

describe('variantToTrace', () => {
  // Mirrors pm4py variants_util.variant_to_trace()
  it('builds a Trace with correct events', () => {
    const trace = variantToTrace(['A', 'B', 'C']);
    assert.equal(trace.length, 3);
    assert.equal(trace.at(0).get('concept:name'), 'A');
    assert.equal(trace.at(2).get('concept:name'), 'C');
  });

  it('uses custom activity key', () => {
    const trace = variantToTrace(['X', 'Y'], 'Activity');
    assert.equal(trace.at(0).get('Activity'), 'X');
  });

  it('empty variant produces empty trace', () => {
    assert.equal(variantToTrace([]).length, 0);
  });
});

// ── filterTraces ──────────────────────────────────────────────────────────────

describe('filterTraces', () => {
  it('keeps only traces satisfying predicate', () => {
    const filtered = filterTraces(LOG, t => t.length >= 3);
    assert.equal(filtered.length, 2);
  });

  it('original log is not mutated', () => {
    filterTraces(LOG, () => false);
    assert.equal(LOG.length, 3);
  });

  it('preserves log metadata', () => {
    LOG.classifiers['Test'] = ['concept:name'];
    const filtered = filterTraces(LOG, () => true);
    assert.deepEqual(filtered.classifiers['Test'], ['concept:name']);
    delete LOG.classifiers['Test'];  // clean up
  });
});

// ── filterEventsByActivity ────────────────────────────────────────────────────

describe('filterEventsByActivity', () => {
  it('removes events not in the allowed set', () => {
    const filtered = filterEventsByActivity(LOG, ['A', 'C']);
    // case-1: [A,C], case-2: [A,C], case-3: [A,C]
    for (const trace of filtered) {
      for (const event of trace) {
        assert.ok(['A', 'C'].includes(event.get('concept:name')));
      }
    }
  });

  it('removes traces that become empty', () => {
    const filtered = filterEventsByActivity(LOG, ['B']);
    // case-2 [A,C] has no B → trace removed
    assert.equal(filtered.length, 2);
  });

  it('accepts a Set', () => {
    const filtered = filterEventsByActivity(LOG, new Set(['A']));
    assert.equal(filtered.length, 3);  // all traces have at least one A
  });
});

// ── getLogSummary ─────────────────────────────────────────────────────────────

describe('getLogSummary', () => {
  const summary = getLogSummary(LOG);

  it('correct trace count', () => {
    assert.equal(summary.traces, 3);
  });

  it('correct event count', () => {
    // case-1: 3, case-2: 2, case-3: 3 → 8
    assert.equal(summary.events, 8);
  });

  it('correct activity count', () => {
    assert.equal(summary.activities, 3);
  });

  it('correct variant count', () => {
    assert.equal(summary.variants, 2);
  });

  it('correct average trace length', () => {
    assert.closeTo(summary.avgTraceLength, 8 / 3, 0.01);
  });

  it('correct median trace length', () => {
    // lengths sorted: [2, 3, 3] → median = 3
    assert.equal(summary.medianTraceLength, 3);
  });

  it('start activities included', () => {
    assert.equal(summary.startActivities['A'], 3);
  });

  it('end activities included', () => {
    assert.equal(summary.endActivities['C'], 3);
  });
});

// ── Functional test: log-util on running_example.xes (inline fixture) ────────
// Translated from pm4py simplified_interface.py test_dfg, test_statistics_log
// End activities: pay compensation (3 traces), reject request (3 traces).

describe('functional: log-util on running_example.xes', () => {
  const log = xesParser.parse(RUNNING_EXAMPLE_XES);

  it('parses 6 traces — mirrors pm4py len(log)==6', () => {
    assert.equal(log.length, 6);
  });

  it('get_start_activities — register request starts all 6 traces', () => {
    const sa = getStartActivities(log);
    assert.equal(sa.get('register request'), 6);
    assert.equal(sa.size, 1);
  });

  it('get_end_activities — pay compensation and reject request, total=6', () => {
    const ea = getEndActivities(log);
    assert.equal(ea.get('pay compensation'), 3);
    assert.equal(ea.get('reject request'), 3);
    assert.equal(ea.size, 2);
  });

  it('variants — UVCL counts sum to 6', () => {
    const uvcl = getUVCL(log);
    const total = Array.from(uvcl.values()).reduce((s, v) => s + v, 0);
    assert.equal(total, 6);
  });

  it('DFG — register request appears as a source', () => {
    const { graph } = getDFG(log);
    const sources = new Set(Array.from(graph.keys()).map(k => dfgKeyParts(k)[0]));
    assert.includes(sources, 'register request');
  });

  it('DFG — edge register request→examine casually or examine thoroughly exists', () => {
    const { graph } = getDFG(log);
    const hasEdge = graph.has(dfgKey('register request', 'examine casually')) ||
                    graph.has(dfgKey('register request', 'examine thoroughly'));
    assert.ok(hasEdge);
  });

  it('language probabilities sum to 1', () => {
    const lang = getLanguage(log);
    const total = Array.from(lang.values()).reduce((s, v) => s + v, 0);
    assert.closeTo(total, 1.0, 1e-9);
  });
});

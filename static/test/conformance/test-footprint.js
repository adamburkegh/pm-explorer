/**
 * Tests for js/conformance/footprint.js — computeFootprintConformance().
 *
 * Fixture log (shared with test-log-util.js):
 *   case-1: [A, B, C]   DF-pairs: A→B, B→C
 *   case-2: [A, C]       DF-pair:  A→C
 *   case-3: [A, B, C]   DF-pairs: A→B, B→C
 *
 * Log footprint = { A→B, B→C, A→C }  (3 distinct pairs)
 */

// ── Fixture helpers ───────────────────────────────────────────────────────────

function fpMakeLog() {
  const log = new EventLog();
  const cases = [
    ['A', 'B', 'C'],
    ['A', 'C'],
    ['A', 'B', 'C'],
  ];
  cases.forEach((acts, i) => {
    const trace = new Trace();
    trace.attributes[DEFAULT_NAME_KEY] = `case-${i + 1}`;
    for (const act of acts)
      trace.append(new Event({ [DEFAULT_NAME_KEY]: act }));
    log.append(trace);
  });
  return log;
}

/** Build a synthetic DFG graph Map from an array of [a, b, count] triples. */
function fpMakeGraph(edges) {
  const g = new Map();
  for (const [a, b, count] of edges)
    g.set(dfgKey(a, b), count ?? 1);
  return g;
}

const ACT_KEY = DEFAULT_NAME_KEY;
const LOG     = fpMakeLog();

// ── Perfect model (model footprint == log footprint) ─────────────────────────

describe('computeFootprintConformance — perfect model', () => {
  // Model exactly matches what the log does: A→B, B→C, A→C
  const graph  = fpMakeGraph([['A','B',2], ['B','C',2], ['A','C',1]]);
  const result = computeFootprintConformance(LOG, graph, ACT_KEY);

  it('fitness is 1.0', () => {
    assert.equal(result.fitness, 1);
  });

  it('precision is 1.0', () => {
    assert.equal(result.precision, 1);
  });

  it('all traces fit', () => {
    assert.equal(result.pctFitting, 1);
    assert.equal(result.fittingTraces, 3);
  });

  it('log footprint size is 3', () => {
    assert.equal(result.logFPSize, 3);
  });

  it('model footprint size is 3', () => {
    assert.equal(result.modelFPSize, 3);
  });

  it('totalTraces is 3', () => {
    assert.equal(result.totalTraces, 3);
  });
});

// ── Incomplete model (missing A→C — too specific / low recall) ────────────────

describe('computeFootprintConformance — incomplete model', () => {
  // Model has A→B and B→C but not A→C
  // log footprint:   { A→B, B→C, A→C }  (3 pairs)
  // model footprint: { A→B, B→C }        (2 pairs)
  // intersection:    { A→B, B→C }        (2)
  // fitness    = 2/3 ≈ 0.667
  // precision  = 2/2 = 1.0
  // fitting:   case-1 ✓, case-2 ✗ (A→C not in model), case-3 ✓  → 2/3
  const graph  = fpMakeGraph([['A','B',2], ['B','C',2]]);
  const result = computeFootprintConformance(LOG, graph, ACT_KEY);

  it('fitness is 2/3', () => {
    assert.closeTo(result.fitness, 2 / 3, 1e-9);
  });

  it('precision is 1.0 (every model edge seen in log)', () => {
    assert.equal(result.precision, 1);
  });

  it('2 of 3 traces fit', () => {
    assert.equal(result.fittingTraces, 2);
    assert.closeTo(result.pctFitting, 2 / 3, 1e-9);
  });
});

// ── Overfitting model (extra edges not seen in log) ───────────────────────────

describe('computeFootprintConformance — overfitting model', () => {
  // Model has all log edges + 2 extras (C→A, B→A)
  // log footprint:   { A→B, B→C, A→C }  (3)
  // model footprint: { A→B, B→C, A→C, C→A, B→A }  (5)
  // intersection:    { A→B, B→C, A→C }  (3)
  // fitness    = 3/3 = 1.0
  // precision  = 3/5 = 0.6
  // fitting:   all 3 (model allows everything the log does)
  const graph  = fpMakeGraph([['A','B',2], ['B','C',2], ['A','C',1], ['C','A',1], ['B','A',1]]);
  const result = computeFootprintConformance(LOG, graph, ACT_KEY);

  it('fitness is 1.0', () => {
    assert.equal(result.fitness, 1);
  });

  it('precision is 3/5 = 0.6', () => {
    assert.closeTo(result.precision, 0.6, 1e-9);
  });

  it('all traces fit', () => {
    assert.equal(result.fittingTraces, 3);
    assert.equal(result.pctFitting, 1);
  });

  it('model footprint size is 5', () => {
    assert.equal(result.modelFPSize, 5);
  });
});

// ── Disjoint model (no overlap with log) ──────────────────────────────────────

describe('computeFootprintConformance — disjoint model', () => {
  // Model contains edges that never appear in the log
  // intersection = 0
  // fitness    = 0/3 = 0.0
  // precision  = 0/2 = 0.0
  // no traces fit
  const graph  = fpMakeGraph([['X','Y',1], ['Y','Z',1]]);
  const result = computeFootprintConformance(LOG, graph, ACT_KEY);

  it('fitness is 0', () => {
    assert.equal(result.fitness, 0);
  });

  it('precision is 0', () => {
    assert.equal(result.precision, 0);
  });

  it('no traces fit', () => {
    assert.equal(result.fittingTraces, 0);
    assert.equal(result.pctFitting, 0);
  });
});

// ── Empty model ───────────────────────────────────────────────────────────────

describe('computeFootprintConformance — empty model', () => {
  // Model has no edges
  // intersection = 0
  // fitness    = 0/3 = 0.0
  // precision  = vacuous: 0/0 → 1.0
  // no traces fit (each has at least one pair that is not in model)
  const graph  = new Map();
  const result = computeFootprintConformance(LOG, graph, ACT_KEY);

  it('fitness is 0 (log has pairs the model does not allow)', () => {
    assert.equal(result.fitness, 0);
  });

  it('precision is 1.0 (vacuous — no model edges to be wrong about)', () => {
    assert.equal(result.precision, 1);
  });

  it('no traces fit', () => {
    assert.equal(result.fittingTraces, 0);
  });

  it('model footprint size is 0', () => {
    assert.equal(result.modelFPSize, 0);
  });
});

// ── Empty log ─────────────────────────────────────────────────────────────────

describe('computeFootprintConformance — empty log', () => {
  // No traces → no pairs → both footprints are empty (log FP trivially)
  // fitness    = vacuous: 0/0 → 1.0
  // pctFitting = vacuous: 0/0 → 1.0
  // precision  = 0/modelSize (model has edges but none seen in log)
  const graph  = fpMakeGraph([['A','B',1], ['B','C',1]]);
  const result = computeFootprintConformance(new EventLog(), graph, ACT_KEY);

  it('fitness is 1.0 (vacuous)', () => {
    assert.equal(result.fitness, 1);
  });

  it('pctFitting is 1.0 (vacuous)', () => {
    assert.equal(result.pctFitting, 1);
  });

  it('precision is 0 (model has edges, log has none)', () => {
    assert.equal(result.precision, 0);
  });

  it('totalTraces is 0', () => {
    assert.equal(result.totalTraces, 0);
  });

  it('log footprint size is 0', () => {
    assert.equal(result.logFPSize, 0);
  });
});

// ── Single-event traces (no consecutive pairs possible) ───────────────────────

describe('computeFootprintConformance — single-event traces', () => {
  // Traces of length 1 produce no DF-pairs
  // logFP is empty → fitness and pctFitting are both vacuously 1
  const log = new EventLog();
  for (const act of ['A', 'B', 'C']) {
    const trace = new Trace();
    trace.append(new Event({ [DEFAULT_NAME_KEY]: act }));
    log.append(trace);
  }
  const graph  = fpMakeGraph([['A','B',1]]);
  const result = computeFootprintConformance(log, graph, ACT_KEY);

  it('fitness is 1.0 (no log pairs to be wrong about)', () => {
    assert.equal(result.fitness, 1);
  });

  it('all traces fit (trivially — no pairs to violate)', () => {
    assert.equal(result.fittingTraces, 3);
    assert.equal(result.pctFitting, 1);
  });

  it('log footprint size is 0', () => {
    assert.equal(result.logFPSize, 0);
  });

  it('precision is 0 (model edge A→B never seen)', () => {
    assert.equal(result.precision, 0);
  });
});

// ── Repeated pairs within a trace (deduplication) ────────────────────────────

describe('computeFootprintConformance — repeated pairs deduplicated', () => {
  // Log: one trace [A, B, A, B]
  // DF-pairs: A→B (twice), B→A (once)  →  log footprint = { A→B, B→A } (size 2)
  // Model: { A→B }
  // intersection = { A→B } = 1
  // fitness    = 1/2 = 0.5  (B→A not in model)
  // precision  = 1/1 = 1.0
  // trace does not fit (B→A missing from model)
  const log   = new EventLog();
  const trace = new Trace();
  for (const act of ['A', 'B', 'A', 'B'])
    trace.append(new Event({ [DEFAULT_NAME_KEY]: act }));
  log.append(trace);

  const graph  = fpMakeGraph([['A','B',1]]);
  const result = computeFootprintConformance(log, graph, ACT_KEY);

  it('log footprint size is 2 (A→B and B→A deduplicated)', () => {
    assert.equal(result.logFPSize, 2);
  });

  it('fitness is 0.5', () => {
    assert.closeTo(result.fitness, 0.5, 1e-9);
  });

  it('precision is 1.0', () => {
    assert.equal(result.precision, 1);
  });

  it('trace does not fit (B→A absent from model)', () => {
    assert.equal(result.fittingTraces, 0);
    assert.equal(result.pctFitting, 0);
  });
});

// ── Custom activity key ───────────────────────────────────────────────────────

describe('computeFootprintConformance — custom activity key', () => {
  const CUSTOM_KEY = 'Activity';
  const log        = new EventLog();
  const trace      = new Trace();
  for (const act of ['X', 'Y', 'Z'])
    trace.append(new Event({ [CUSTOM_KEY]: act }));
  log.append(trace);

  // Perfect model for [X, Y, Z]
  const graph  = fpMakeGraph([['X','Y',1], ['Y','Z',1]]);
  const result = computeFootprintConformance(log, graph, CUSTOM_KEY);

  it('fitness is 1.0 with custom key', () => {
    assert.equal(result.fitness, 1);
  });

  it('precision is 1.0 with custom key', () => {
    assert.equal(result.precision, 1);
  });

  it('trace fits', () => {
    assert.equal(result.fittingTraces, 1);
  });
});

/**
 * Footprint-based conformance checking against a DFG.
 *
 * Footprint definition
 * ─────────────────────
 *   Log footprint   — set of distinct directly-follows pairs (a → b) observed
 *                     across all consecutive event pairs in the log.
 *   Model footprint — set of edge keys present in a DFG (Map<dfgKey, count>).
 *
 * Metrics
 * ────────
 *   Fitness    = |log ∩ model| / |log|
 *     Fraction of log behaviour (DF-pairs) that the model permits.
 *     1.0 → model allows everything the log does.
 *
 *   Precision  = |log ∩ model| / |model|
 *     Fraction of model behaviour seen in the log.
 *     1.0 → every model edge was exercised by the log.
 *
 *   Fitting traces = traces where every consecutive pair is in the model footprint.
 *
 * Dependencies (expected as browser globals or Node stubs):
 *   dfgKey(a, b)   — from log-util.js
 *
 * @param {EventLog} log      Parsed event log (EventLog instance).
 * @param {Map}      graph    DFG edge map: dfgKey(a,b) → count.
 * @param {string}   actKey   Activity attribute key (e.g. 'concept:name').
 * @returns {{
 *   fitness:       number,   // [0, 1]
 *   precision:     number,   // [0, 1]
 *   pctFitting:    number,   // [0, 1]
 *   logFPSize:     number,   // |log footprint|
 *   modelFPSize:   number,   // |model footprint|
 *   totalTraces:   number,
 *   fittingTraces: number,
 * }}
 */
function computeFootprintConformance(log, graph, actKey) {
  const modelFP = new Set(graph.keys());
  const logFP   = new Set();
  let totalTraces   = 0;
  let fittingTraces = 0;

  for (const trace of log) {
    totalTraces++;
    const events       = Array.from(trace);
    let   traceFitting = true;
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i].get(actKey);
      const b = events[i + 1].get(actKey);
      if (a == null || b == null) continue;
      const k = dfgKey(a, b);
      logFP.add(k);
      if (!modelFP.has(k)) traceFitting = false;
    }
    if (traceFitting) fittingTraces++;
  }

  const intersection = [...logFP].filter(k => modelFP.has(k)).length;
  const fitness      = logFP.size   > 0 ? intersection / logFP.size   : 1;
  const precision    = modelFP.size > 0 ? intersection / modelFP.size : 1;
  const pctFitting   = totalTraces  > 0 ? fittingTraces / totalTraces  : 1;

  return {
    fitness,
    precision,
    pctFitting,
    logFPSize:     logFP.size,
    modelFPSize:   modelFP.size,
    totalTraces,
    fittingTraces,
  };
}

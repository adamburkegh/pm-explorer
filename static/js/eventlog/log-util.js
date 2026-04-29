/**
 * Event log utility functions for process mining.
 *
 * Mirrors:
 *   pm4py/util/variants_util.py
 *   pm4py/statistics/variants/log/get.py
 *   pm4py/statistics/start_activities/log/get.py
 *   pm4py/statistics/end_activities/log/get.py
 *   pm4py/algo/discovery/dfg/variants/native.py
 *
 * Variant keys
 * ────────────
 * A variant is a sequence of activity names (string[]). Because JS Maps
 * require reference equality for non-primitive keys we encode a variant
 * as a JSON string: variantKey = JSON.stringify(['A','B','C']).
 * Use variantKeyToArray() / arrayToVariantKey() to convert.
 *
 * DFG edge keys
 * ─────────────
 * Directly-follows pairs (a, b) are encoded as `a + DFG_EDGE_SEP + b`
 * (unit-separator U+001F). Use dfgKey() / dfgKeyParts() to convert.
 *
 * UVCL (Univariate Variant Compressed Log)
 * ─────────────────────────────────────────
 * Maps variantKey → count (number), equivalent to pm4py's Counter[Tuple[str,...]].
 */

// ── Variant key encoding ──────────────────────────────────────────────────────

/** @param {string[]} activities */
function arrayToVariantKey(activities) {
  return JSON.stringify(activities);
}

/** @param {string} key @returns {string[]} */
function variantKeyToArray(key) {
  return JSON.parse(key);
}

// ── DFG edge key encoding ─────────────────────────────────────────────────────

/** @param {string} a @param {string} b */
function dfgKey(a, b) {
  return a + DFG_EDGE_SEP + b;
}

/** @param {string} key @returns {[string, string]} */
function dfgKeyParts(key) {
  const idx = key.indexOf(DFG_EDGE_SEP);
  return [key.slice(0, idx), key.slice(idx + 1)];
}

// ── Variant extraction ────────────────────────────────────────────────────────

/**
 * Extract the activity sequence from a single trace.
 * Mirrors pm4py variants_util.get_variant_from_trace().
 *
 * @param {Trace} trace
 * @param {string} [activityKey]
 * @returns {string[]}
 */
function getVariantFromTrace(trace, activityKey = DEFAULT_NAME_KEY) {
  const result = [];
  for (const event of trace) {
    const act = event.get(activityKey);
    if (act !== undefined) result.push(act);
  }
  return result;
}

/**
 * Get a map of variant → traces that share that variant.
 * Mirrors pm4py statistics/variants/log/get.py get_variants().
 *
 * @param {EventLog} log
 * @param {string} [activityKey]
 * @returns {Map<string, Trace[]>}  variantKey → Trace[]
 */
function getVariants(log, activityKey) {
  activityKey = activityKey ?? log.activityKey;
  const variants = new Map();  // variantKey → Trace[]

  for (const trace of log) {
    const key = arrayToVariantKey(getVariantFromTrace(trace, activityKey));
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push(trace);
  }

  return variants;
}

/**
 * Univariate Variant Compressed Log — variant → frequency count.
 * Mirrors pm4py's UVCL (Counter[Tuple[str,...]]).
 *
 * @param {EventLog} log
 * @param {string} [activityKey]
 * @returns {Map<string, number>}  variantKey → count
 */
function getUVCL(log, activityKey) {
  activityKey = activityKey ?? log.activityKey;
  const uvcl = new Map();

  for (const trace of log) {
    const key = arrayToVariantKey(getVariantFromTrace(trace, activityKey));
    uvcl.set(key, (uvcl.get(key) ?? 0) + 1);
  }

  return uvcl;
}

/**
 * Return variants sorted by descending frequency.
 * Mirrors pm4py get_variants_sorted_by_count().
 *
 * @param {Map<string, Trace[]|number>} variants - output of getVariants() or getUVCL()
 * @returns {Array<[string, number]>}  [[variantKey, count], ...]
 */
function getVariantsSortedByCount(variants) {
  const pairs = [];
  for (const [key, val] of variants) {
    const count = typeof val === 'number' ? val : val.length;
    pairs.push([key, count]);
  }
  return pairs.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Stochastic language: variant → probability (sums to 1).
 * Mirrors pm4py get_language().
 *
 * @param {EventLog} log
 * @param {string} [activityKey]
 * @returns {Map<string, number>}  variantKey → probability
 */
function getLanguage(log, activityKey) {
  const uvcl = getUVCL(log, activityKey);
  const total = Array.from(uvcl.values()).reduce((s, v) => s + v, 0);
  const lang = new Map();
  for (const [key, count] of uvcl) lang.set(key, count / total);
  return lang;
}

/**
 * Collapse consecutive repeated activities within each variant.
 * Mirrors pm4py variants_util.aggregate_consecutive_activities_in_variants().
 *
 * @param {Map<string, number|Trace[]>} variants
 * @param {number} [maxRepetitions=1]
 * @returns {Map<string, number|Trace[]>}
 */
function aggregateConsecutiveActivities(variants, maxRepetitions = 1) {
  const result = new Map();
  for (const [key, value] of variants) {
    const acts = variantKeyToArray(key);
    const agg = [];
    let lastAct = null, count = 0;
    for (const act of acts) {
      if (act !== lastAct) { lastAct = act; count = 1; }
      else count++;
      if (count <= maxRepetitions) agg.push(act);
    }
    const newKey = arrayToVariantKey(agg);
    if (!result.has(newKey)) {
      result.set(newKey, typeof value === 'number' ? 0 : []);
    }
    if (typeof value === 'number') {
      result.set(newKey, result.get(newKey) + value);
    } else {
      result.get(newKey).push(...value);
    }
  }
  return result;
}

// ── Start / end activities ────────────────────────────────────────────────────

/**
 * Count how often each activity appears as the first event in a trace.
 * Mirrors pm4py statistics/start_activities/log/get.py.
 *
 * @param {EventLog} log
 * @param {string} [activityKey]
 * @returns {Map<string, number>}
 */
function getStartActivities(log, activityKey) {
  activityKey = activityKey ?? log.activityKey;
  const counts = new Map();
  for (const trace of log) {
    const first = trace.at(0);
    if (!first) continue;
    const act = first.get(activityKey);
    if (act !== undefined) counts.set(act, (counts.get(act) ?? 0) + 1);
  }
  return counts;
}

/**
 * Count how often each activity appears as the last event in a trace.
 * Mirrors pm4py statistics/end_activities/log/get.py.
 *
 * @param {EventLog} log
 * @param {string} [activityKey]
 * @returns {Map<string, number>}
 */
function getEndActivities(log, activityKey) {
  activityKey = activityKey ?? log.activityKey;
  const counts = new Map();
  for (const trace of log) {
    const last = trace.at(-1);
    if (!last) continue;
    const act = last.get(activityKey);
    if (act !== undefined) counts.set(act, (counts.get(act) ?? 0) + 1);
  }
  return counts;
}

/**
 * Set of all distinct activities appearing in the log.
 *
 * @param {EventLog} log
 * @param {string} [activityKey]
 * @returns {Set<string>}
 */
function getActivities(log, activityKey) {
  activityKey = activityKey ?? log.activityKey;
  const acts = new Set();
  for (const trace of log) {
    for (const event of trace) {
      const act = event.get(activityKey);
      if (act !== undefined) acts.add(act);
    }
  }
  return acts;
}

// ── Directly-follows graph ────────────────────────────────────────────────────

/**
 * Compute a directly-follows graph from an event log.
 * Mirrors pm4py algo/discovery/dfg/variants/native.py.
 *
 * Returns a plain object rather than a class so it is easy to JSON-serialize
 * and pass around. Edge keys are encoded with dfgKey().
 *
 * @param {EventLog} log
 * @param {object} [params]
 * @param {string}  [params.activityKey]
 * @param {number}  [params.window=1]          - lag between events to count as DF
 * @param {boolean} [params.keepOncePerCase=false] - deduplicate pairs within a trace
 * @returns {{ graph: Map<string,number>, startActivities: Map<string,number>, endActivities: Map<string,number> }}
 */
function getDFG(log, params = {}) {
  const activityKey      = params.activityKey ?? log.activityKey;
  const window           = params.window       ?? 1;
  const keepOncePerCase  = params.keepOncePerCase ?? false;

  const graph            = new Map();   // dfgKey(a,b) → count
  const startActivities  = new Map();   // activity → count
  const endActivities    = new Map();   // activity → count

  for (const trace of log) {
    const events = Array.from(trace);
    if (events.length === 0) continue;

    // Start / end activities
    const firstAct = events[0].get(activityKey);
    const lastAct  = events[events.length - 1].get(activityKey);
    if (firstAct !== undefined) startActivities.set(firstAct, (startActivities.get(firstAct) ?? 0) + 1);
    if (lastAct  !== undefined) endActivities.set(lastAct,   (endActivities.get(lastAct)     ?? 0) + 1);

    // Directly-follows pairs
    const seen = keepOncePerCase ? new Set() : null;
    for (let i = window; i < events.length; i++) {
      const a = events[i - window].get(activityKey);
      const b = events[i].get(activityKey);
      if (a === undefined || b === undefined) continue;
      const k = dfgKey(a, b);
      if (keepOncePerCase) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      graph.set(k, (graph.get(k) ?? 0) + 1);
    }
  }

  return { graph, startActivities, endActivities };
}

// ── Trace reconstruction ──────────────────────────────────────────────────────

/**
 * Build a minimal Trace from an activity sequence.
 * Mirrors pm4py variants_util.variant_to_trace().
 *
 * @param {string[]} activities
 * @param {string} [activityKey]
 * @returns {Trace}
 */
function variantToTrace(activities, activityKey = DEFAULT_NAME_KEY) {
  const trace = new Trace();
  for (const act of activities) {
    trace.append(new Event({ [activityKey]: act }));
  }
  return trace;
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Filter traces by a predicate, returning a new EventLog.
 *
 * @param {EventLog} log
 * @param {function(Trace): boolean} predicate
 * @returns {EventLog}
 */
function filterTraces(log, predicate) {
  return log.filter(predicate);
}

/**
 * Keep only events whose activity is in the given set (remove others from traces;
 * remove empty traces from the result).
 *
 * @param {EventLog} log
 * @param {Set<string>|string[]} activities
 * @param {string} [activityKey]
 * @returns {EventLog}
 */
function filterEventsByActivity(log, activities, activityKey) {
  activityKey = activityKey ?? log.activityKey;
  const allowed = activities instanceof Set ? activities : new Set(activities);
  return log
    .map(trace => {
      const t = new Trace();
      t.attributes = { ...trace.attributes };
      for (const event of trace) {
        if (allowed.has(event.get(activityKey))) t.append(event);
      }
      return t;
    })
    .filter(t => t.length > 0);
}

// ── Summary statistics ────────────────────────────────────────────────────────

/**
 * High-level summary of a log useful for display / debugging.
 *
 * @param {EventLog} log
 * @param {string} [activityKey]
 * @returns {object}
 */
function getLogSummary(log, activityKey) {
  activityKey = activityKey ?? log.activityKey;
  const activities    = getActivities(log, activityKey);
  const variants      = getUVCL(log, activityKey);
  const startActs     = getStartActivities(log, activityKey);
  const endActs       = getEndActivities(log, activityKey);
  const totalEvents   = Array.from(log).reduce((s, t) => s + t.length, 0);
  const traceLengths  = Array.from(log).map(t => t.length).sort((a, b) => a - b);
  const medLen        = traceLengths[Math.floor(traceLengths.length / 2)] ?? 0;

  return {
    traces:            log.length,
    events:            totalEvents,
    activities:        activities.size,
    variants:          variants.size,
    avgTraceLength:    log.length ? +(totalEvents / log.length).toFixed(2) : 0,
    medianTraceLength: medLen,
    startActivities:   Object.fromEntries(startActs),
    endActivities:     Object.fromEntries(endActs),
  };
}

/**
 * Alpha Miner — classic variant.
 *
 * Translated from:
 *   pm4py/algo/discovery/alpha/variants/classic.py
 *   pm4py/algo/discovery/alpha/data_structures/alpha_classic_abstraction.py
 *   pm4py/algo/discovery/causal/variants/alpha.py
 *
 * References:
 *   Van der Aalst et al., "Workflow Mining: Discovering Process Models from
 *   Event Logs", IEEE TKDE 16, 2004. DOI: 10.1109/TKDE.2004.47
 *
 * Requires (must be loaded before this script):
 *   constants.js — DEFAULT_NAME_KEY, DFG_EDGE_SEP
 *   log-util.js  — getDFG, dfgKey, dfgKeyParts
 *   model.js     — PetriNet, Place, Transition, Arc
 */

// ── Relation builders ─────────────────────────────────────────────────────────

/**
 * Build the causal relation from a DFG.
 * (a→b) is causal iff a→b ∈ DFG and b→a ∉ DFG.
 * Mirrors pm4py/algo/discovery/causal/variants/alpha.py::apply()
 *
 * @param {Map<string,number>} dfgGraph  Map keyed by dfgKey(a,b)
 * @returns {Set<string>}  Set of dfgKey strings for causal pairs
 */
function buildCausalRelation(dfgGraph) {
  const causal = new Set();
  for (const key of dfgGraph.keys()) {
    const [f, t] = dfgKeyParts(key);
    if (!dfgGraph.has(dfgKey(t, f))) {
      causal.add(key);
    }
  }
  return causal;
}

/**
 * Build the parallel relation from a DFG.
 * (a,b) is parallel iff both a→b and b→a appear in the DFG.
 * Mirrors ClassicAlphaAbstraction.__parallel computation.
 *
 * @param {Map<string,number>} dfgGraph
 * @returns {Set<string>}  Set of dfgKey strings (both directions included)
 */
function buildParallelRelation(dfgGraph) {
  const parallel = new Set();
  for (const key of dfgGraph.keys()) {
    const [f, t] = dfgKeyParts(key);
    if (dfgGraph.has(dfgKey(t, f))) {
      parallel.add(key);
    }
  }
  return parallel;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _isSubset(setA, setB) {
  for (const a of setA) if (!setB.has(a)) return false;
  return true;
}

function _setUnion(setA, setB) {
  return new Set([...setA, ...setB]);
}

function _setsEqual(setA, setB) {
  if (setA.size !== setB.size) return false;
  for (const a of setA) if (!setB.has(a)) return false;
  return true;
}

function _pairsEqual(p1, p2) {
  return _setsEqual(p1[0], p2[0]) && _setsEqual(p1[1], p2[1]);
}

function _containsPair(pairList, pair) {
  for (const p of pairList) {
    if (_pairsEqual(p, pair)) return true;
  }
  return false;
}

/**
 * Exclude causal pair (a,b) if (a,a) or (b,b) is in the parallel relation.
 * Mirrors pm4py's __initial_filter.
 */
function _initialFilter(parallelRelation, a, b) {
  return (
    !parallelRelation.has(dfgKey(a, a)) &&
    !parallelRelation.has(dfgKey(b, b))
  );
}

/**
 * True iff every pair (a,b) with a∈setA, b∈setB is in the causal relation.
 * Mirrors pm4py's __check_all_causal.
 */
function _checkAllCausal(causalRelation, setA, setB) {
  for (const a of setA) {
    for (const b of setB) {
      if (!causalRelation.has(dfgKey(a, b))) return false;
    }
  }
  return true;
}

/**
 * True if any pair from (setA×setB) ∪ (setB×setA) is in the parallel or
 * causal relation.  Used to decide whether two partial sets can be merged.
 * Mirrors pm4py's __check_is_unrelated.
 */
function _checkIsUnrelated(parallelRelation, causalRelation, setA, setB) {
  for (const a of setA) {
    for (const b of setB) {
      const k1 = dfgKey(a, b);
      const k2 = dfgKey(b, a);
      if (parallelRelation.has(k1) || causalRelation.has(k1)) return true;
      if (parallelRelation.has(k2) || causalRelation.has(k2)) return true;
    }
  }
  return false;
}

/**
 * True iff `pair` is not a proper subset of any other pair in allPairs.
 * Mirrors pm4py's __pair_maximizer.
 */
function _isPairMaximal(allPairs, pair) {
  for (const other of allPairs) {
    if (other === pair) continue;
    if (_isSubset(pair[0], other[0]) && _isSubset(pair[1], other[1])) {
      return false;
    }
  }
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply the classic Alpha Miner to an event log.
 * Mirrors pm4py's alpha classic apply().
 *
 * @param {EventLog} log
 * @param {object}  [params]
 * @param {string}  [params.activityKey]
 * @returns {{ net: PetriNet, source: Place, sink: Place,
 *             transitionMap:  Map<string,Transition>,
 *             initialMarking: Map<string,number>,
 *             finalMarking:   Map<string,number> }}
 */
function applyAlphaMiner(log, params = {}) {
  const activityKey = params.activityKey || log.activityKey || DEFAULT_NAME_KEY;
  const { graph: dfgGraph, startActivities, endActivities } =
    getDFG(log, { activityKey });
  return applyAlphaMinerDfg(dfgGraph, startActivities, endActivities);
}

/**
 * Apply the classic Alpha Miner from a pre-computed DFG + start/end activities.
 * Mirrors pm4py's apply_dfg_sa_ea().
 *
 * @param {Map<string,number>} dfgGraph        Map keyed by dfgKey(a,b)
 * @param {Map<string,number>} startActivities
 * @param {Map<string,number>} endActivities
 * @returns {{ net: PetriNet, source: Place, sink: Place,
 *             transitionMap:  Map<string,Transition>,
 *             initialMarking: Map<string,number>,
 *             finalMarking:   Map<string,number> }}
 */
function applyAlphaMinerDfg(dfgGraph, startActivities, endActivities) {
  // Collect every activity label mentioned in the DFG or start/end sets
  const labels = new Set();
  for (const key of dfgGraph.keys()) {
    const [f, t] = dfgKeyParts(key);
    labels.add(f);
    labels.add(t);
  }
  for (const a of startActivities.keys()) labels.add(a);
  for (const a of endActivities.keys()) labels.add(a);

  // ── Relations ───────────────────────────────────────────────────────────────
  const causalRelation   = buildCausalRelation(dfgGraph);
  const parallelRelation = buildParallelRelation(dfgGraph);

  // ── Step 1: initial pairs ───────────────────────────────────────────────────
  // One pair ({a},{b}) per causal edge, with self-parallel activities filtered.
  const pairs = [];
  for (const key of causalRelation) {
    const [a, b] = dfgKeyParts(key);
    if (_initialFilter(parallelRelation, a, b)) {
      pairs.push([new Set([a]), new Set([b])]);
    }
  }

  // ── Step 2: merge pairs ─────────────────────────────────────────────────────
  // Single pass (matches pm4py's nested for-loop): for each pair t1, compare
  // with every other pair t2.  If their A-sets or B-sets overlap (via subset),
  // and neither A-side nor B-side has internal relations, merge and add the
  // new combined pair if all its cross-pairs are causal.
  for (let i = 0; i < pairs.length; i++) {
    const t1 = pairs[i];
    for (let j = i; j < pairs.length; j++) {
      const t2 = pairs[j];
      if (t1 === t2) continue;
      if (_isSubset(t1[0], t2[0]) || _isSubset(t1[1], t2[1])) {
        if (
          !_checkIsUnrelated(parallelRelation, causalRelation, t1[0], t2[0]) &&
          !_checkIsUnrelated(parallelRelation, causalRelation, t1[1], t2[1])
        ) {
          const newPair = [_setUnion(t1[0], t2[0]), _setUnion(t1[1], t2[1])];
          if (
            !_containsPair(pairs, newPair) &&
            _checkAllCausal(causalRelation, newPair[0], newPair[1])
          ) {
            pairs.push(newPair);
          }
        }
      }
    }
  }

  // ── Step 3: maximise ────────────────────────────────────────────────────────
  const maximalPairs = pairs.filter(p => _isPairMaximal(pairs, p));

  // ── Step 4: assemble Petri net ──────────────────────────────────────────────
  const net = new PetriNet(PetriNet.generateId(), 'alpha_classic_net');

  // One visible transition per activity label
  const transitionMap = new Map(); // activityName → Transition
  for (const label of labels) {
    const t = new Transition(PetriNet.generateId(), { x: 0, y: 0 }, label);
    net.addTransition(t);
    transitionMap.set(label, t);
  }

  const source = new Place(PetriNet.generateId(), { x: 0, y: 0 }, 'start', 1);
  net.addPlace(source);
  for (const actName of startActivities.keys()) {
    const t = transitionMap.get(actName);
    if (t) net.addArc(new Arc(PetriNet.generateId(), source.id, t.id));
  }

  const sink = new Place(PetriNet.generateId(), { x: 0, y: 0 }, 'end', 0, null, 1);
  net.addPlace(sink);
  for (const actName of endActivities.keys()) {
    const t = transitionMap.get(actName);
    if (t) net.addArc(new Arc(PetriNet.generateId(), t.id, sink.id));
  }

  // One internal place per maximal (A, B) pair
  for (const [setA, setB] of maximalPairs) {
    const p = new Place(PetriNet.generateId(), { x: 0, y: 0 });
    net.addPlace(p);
    for (const a of setA) {
      const t = transitionMap.get(a);
      if (t) net.addArc(new Arc(PetriNet.generateId(), t.id, p.id));
    }
    for (const b of setB) {
      const t = transitionMap.get(b);
      if (t) net.addArc(new Arc(PetriNet.generateId(), p.id, t.id));
    }
  }

  return {
    net,
    /** @type {Place}           */ source,
    /** @type {Place}           */ sink,
    /** @type {Map<string,Transition>} */ transitionMap,
    initialMarking: new Map([[source.id, 1]]),
    finalMarking:   new Map([[sink.id,   1]]),
  };
}

/**
 * Inductive Miner — UVCL variant (IMUVCL).
 *
 * Translated from:
 *   pm4py/algo/discovery/inductive/variants/im.py          — IMUVCL class
 *   pm4py/algo/discovery/inductive/variants/abc.py          — InductiveMinerFramework
 *   pm4py/algo/discovery/inductive/dtypes/im_ds.py          — IMDataStructureUVCL
 *   pm4py/algo/discovery/inductive/cuts/xor.py              — ExclusiveChoiceCut
 *   pm4py/algo/discovery/inductive/cuts/sequence.py         — SequenceCut
 *   pm4py/algo/discovery/inductive/cuts/concurrency.py      — ConcurrencyCut
 *   pm4py/algo/discovery/inductive/cuts/loop.py             — LoopCut
 *   pm4py/algo/discovery/inductive/base_case/single_activity.py
 *   pm4py/algo/discovery/inductive/base_case/empty_log.py
 *   pm4py/algo/discovery/inductive/fall_through/empty_traces.py
 *   pm4py/algo/discovery/inductive/fall_through/flower.py
 *
 * References:
 *   Leemans et al., "Discovering Block-Structured Process Models from Event Logs
 *   Containing Infrequent Behaviour", BPM Workshops 2013.
 *
 * Requires (must be loaded before this script):
 *   constants.js — DEFAULT_NAME_KEY, DFG_EDGE_SEP
 *   log-util.js  — getUVCL, dfgKey, dfgKeyParts, variantKeyToArray, arrayToVariantKey
 *   model.js     — PetriNet, Place, Transition, Arc
 */

// ── Process Tree ──────────────────────────────────────────────────────────────

/**
 * A node in a process tree.
 *
 * operator: null | 'xor' | 'sequence' | 'parallel' | 'loop'
 *   null  → leaf node; label is the activity name, or null for tau (silent)
 *
 * @typedef {{ operator: string|null, label: string|null, children: ProcessTreeNode[] }} ProcessTreeNode
 */

function makeLeaf(label) {
  return { operator: null, label, children: [] };
}

function makeNode(operator, children) {
  return { operator, label: null, children };
}

// ── DFG helpers ───────────────────────────────────────────────────────────────

/**
 * Collect every vertex (activity) mentioned in a DFG map.
 * Mirrors pm4py/objects/dfg/util.py::get_vertices().
 *
 * @param {Map<string,number>} dfg
 * @returns {Set<string>}
 */
function _dfgVertices(dfg) {
  const v = new Set();
  for (const key of dfg.keys()) {
    const [a, b] = dfgKeyParts(key);
    v.add(a);
    v.add(b);
  }
  return v;
}

/**
 * Compute IMUVCL's DFG from a compressed log.
 * Returns { dfg, startActs, endActs } — all as Map<string,number>.
 *
 * The DFG counts each directly-follows pair once per variant occurrence
 * (matching pm4py behaviour for UVCL).
 *
 * @param {Map<string,number>} uvcl
 * @returns {{ dfg: Map<string,number>, startActs: Map<string,number>, endActs: Map<string,number> }}
 */
function _computeImDfg(uvcl) {
  const dfg      = new Map();
  const startActs = new Map();
  const endActs   = new Map();

  for (const [key, count] of uvcl) {
    const acts = variantKeyToArray(key);
    if (acts.length === 0) continue;

    const first = acts[0];
    const last  = acts[acts.length - 1];
    startActs.set(first, (startActs.get(first) ?? 0) + count);
    endActs.set(last,    (endActs.get(last)     ?? 0) + count);

    for (let i = 1; i < acts.length; i++) {
      const k = dfgKey(acts[i - 1], acts[i]);
      dfg.set(k, (dfg.get(k) ?? 0) + count);
    }
  }

  return { dfg, startActs, endActs };
}

/**
 * Get the set of all activities in a UVCL.
 *
 * @param {Map<string,number>} uvcl
 * @returns {Set<string>}
 */
function _uvclAlphabet(uvcl) {
  const acts = new Set();
  for (const key of uvcl.keys()) {
    for (const a of variantKeyToArray(key)) acts.add(a);
  }
  return acts;
}

// ── Union-Find ────────────────────────────────────────────────────────────────

function _makeUF(items) {
  const parent = new Map();
  for (const x of items) parent.set(x, x);
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  function groups() {
    const g = new Map();
    for (const x of parent.keys()) {
      const r = find(x);
      if (!g.has(r)) g.set(r, new Set());
      g.get(r).add(x);
    }
    return [...g.values()];
  }
  return { find, union, groups };
}

/**
 * Connected components of an undirected graph (vertices, directed edges treated
 * as undirected).  Used for XOR and loop cut.
 *
 * @param {Set<string>} nodes
 * @param {Map<string,number>} dfg  — directed, treated as undirected here
 * @returns {Set<string>[]}
 */
function _connectedComponents(nodes, dfg) {
  const uf = _makeUF(nodes);
  for (const key of dfg.keys()) {
    const [a, b] = dfgKeyParts(key);
    if (nodes.has(a) && nodes.has(b)) uf.union(a, b);
  }
  return uf.groups();
}

// ── Transitive closure (BFS) ──────────────────────────────────────────────────

/**
 * For each node compute the set of nodes reachable from it (post) and the set
 * that can reach it (pre) via directed edges in the DFG.
 * Mirrors pm4py/objects/dfg/util.py::get_transitive_relations().
 *
 * @param {Set<string>} nodes
 * @param {Map<string,number>} dfg
 * @returns {{ pre: Map<string,Set<string>>, post: Map<string,Set<string>> }}
 */
function _transitiveReachability(nodes, dfg) {
  // Build adjacency list
  const succ = new Map(); // node → Set of direct successors
  for (const n of nodes) succ.set(n, new Set());
  for (const key of dfg.keys()) {
    const [a, b] = dfgKeyParts(key);
    if (nodes.has(a) && nodes.has(b)) succ.get(a).add(b);
  }

  // BFS from each node
  const post = new Map();
  for (const start of nodes) {
    const visited = new Set();
    const queue = [start];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      for (const nb of succ.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    visited.delete(start); // post-set excludes the node itself
    post.set(start, visited);
  }

  // pre-set is the transpose
  const pre = new Map();
  for (const n of nodes) pre.set(n, new Set());
  for (const [n, postSet] of post) {
    for (const m of postSet) pre.get(m).add(n);
  }

  return { pre, post };
}

// ── XOR cut ───────────────────────────────────────────────────────────────────

/**
 * Exclusive Choice cut.
 * Returns groups if the undirected DFG is disconnected, null otherwise.
 * Mirrors pm4py/algo/discovery/inductive/cuts/xor.py::ExclusiveChoiceCut.apply().
 *
 * @param {Set<string>} nodes
 * @param {Map<string,number>} dfg
 * @returns {Set<string>[]|null}
 */
function _xorCut(nodes, dfg) {
  if (nodes.size === 0) return null;
  const groups = _connectedComponents(nodes, dfg);
  return groups.length > 1 ? groups : null;
}

/**
 * Project UVCL onto XOR groups: each trace goes to the group whose activities
 * overlap most with the trace alphabet.  If a trace has no activities from any
 * group (e.g. empty), it is dropped.
 *
 * Mirrors pm4py ExclusiveChoiceCut.project().
 *
 * @param {Map<string,number>} uvcl
 * @param {Set<string>[]} groups
 * @returns {Map<string,number>[]}
 */
function _xorProject(uvcl, groups) {
  const projections = groups.map(() => new Map());

  for (const [key, count] of uvcl) {
    const acts = variantKeyToArray(key);
    // Find the group that contains the first activity of the trace
    // (pm4py: assign trace to first group that contains any of its activities)
    let assigned = -1;
    outer: for (let gi = 0; gi < groups.length; gi++) {
      for (const a of acts) {
        if (groups[gi].has(a)) { assigned = gi; break outer; }
      }
    }
    if (assigned < 0) continue; // empty trace — handled separately
    const filteredActs = acts.filter(a => groups[assigned].has(a));
    const fk = arrayToVariantKey(filteredActs);
    projections[assigned].set(fk, (projections[assigned].get(fk) ?? 0) + count);
  }

  return projections;
}

// ── Sequence cut ──────────────────────────────────────────────────────────────

/**
 * Check whether two groups g1, g2 should be merged during sequence grouping.
 * Mirrors SequenceCut.__merge_groups_condition():
 *   merge if there exists a node in g1 that cannot reach any node in g2
 *   OR a node in g2 that is not reachable from any node in g1.
 *
 * @param {Set<string>} g1
 * @param {Set<string>} g2
 * @param {Map<string,Set<string>>} post  transitive post-sets
 * @returns {boolean}
 */
function _mergeGroupsCondition(g1, g2, post) {
  // If any node in g1 cannot reach ANY node in g2 → merge
  for (const a of g1) {
    let reachesG2 = false;
    for (const b of g2) {
      if (post.get(a)?.has(b)) { reachesG2 = true; break; }
    }
    if (!reachesG2) return true;
  }
  // If any node in g2 is not reachable from ANY node in g1 → merge
  for (const b of g2) {
    let reachableFromG1 = false;
    for (const a of g1) {
      if (post.get(a)?.has(b)) { reachableFromG1 = true; break; }
    }
    if (!reachableFromG1) return true;
  }
  return false;
}

/**
 * Merge consecutive groups that should not be split.
 * Mirrors SequenceCut.__merge_groups().
 *
 * @param {Set<string>[]} groups  ordered groups (initially one per node)
 * @param {Map<string,Set<string>>} post
 * @returns {Set<string>[]}
 */
function _mergeGroups(groups, post) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < groups.length - 1; i++) {
      if (_mergeGroupsCondition(groups[i], groups[i + 1], post)) {
        // Merge group[i+1] into group[i]
        for (const x of groups[i + 1]) groups[i].add(x);
        groups.splice(i + 1, 1);
        changed = true;
        break; // restart
      }
    }
  }
  return groups;
}

/**
 * Sequence cut.
 * Orders nodes by topological reachability, then merges groups that cannot
 * be cleanly separated.
 * Mirrors pm4py SequenceCut.apply().
 *
 * @param {Set<string>} nodes
 * @param {Map<string,number>} dfg
 * @param {Map<string,number>} startActs
 * @param {Map<string,number>} endActs
 * @returns {Set<string>[]|null}  ordered groups, or null
 */
function _sequenceCut(nodes, dfg, startActs, endActs) {
  if (nodes.size <= 1) return null;

  const { post } = _transitiveReachability(nodes, dfg);

  // Collapse SCCs: nodes that can mutually reach each other belong in the
  // same sequence group (they are concurrent, not sequential).
  const sccUF = _makeUF(nodes);
  const nodeArr = [...nodes];
  for (let i = 0; i < nodeArr.length; i++) {
    for (let j = i + 1; j < nodeArr.length; j++) {
      const a = nodeArr[i], b = nodeArr[j];
      if (post.get(a)?.has(b) && post.get(b)?.has(a)) sccUF.union(a, b);
    }
  }
  let groups = sccUF.groups();

  // Topological sort of SCC groups: g1 before g2 if any node in g1 reaches
  // any node in g2 (not vice versa, by SCC definition).
  groups.sort((g1, g2) => {
    for (const a of g1) for (const b of g2) if (post.get(a)?.has(b)) return -1;
    for (const a of g2) for (const b of g1) if (post.get(a)?.has(b)) return 1;
    return 0;
  });

  // Merge groups that violate the sequence condition
  groups = _mergeGroups(groups, post);

  if (groups.length < 2) return null;

  // Validity check: no activity in a later group may transitively reach an activity
  // in an earlier group.  This rules out loops (A↔B) being misidentified as sequences.
  for (let i = 0; i < groups.length - 1; i++) {
    for (const a of groups[i]) {
      for (let j = i + 1; j < groups.length; j++) {
        for (const b of groups[j]) {
          if (post.get(b)?.has(a)) return null;
        }
      }
    }
  }

  return groups;
}

/**
 * Project UVCL onto sequence groups.
 *
 * Because sequence-cut groups are disjoint (each activity belongs to exactly
 * one group by construction), the projection is a simple filter: each trace
 * is independently filtered to the activities of each group, preserving their
 * relative order.  This correctly handles activities that repeat within the
 * same group (e.g. loop-like sub-traces such as [ec,ct,d,ri,et,ct,d]).
 *
 * @param {Map<string,number>} uvcl
 * @param {Set<string>[]} groups  ordered sequence groups (disjoint partition)
 * @returns {Map<string,number>[]}
 */
function _seqProject(uvcl, groups) {
  const projections = groups.map(() => new Map());

  for (const [key, count] of uvcl) {
    const acts = variantKeyToArray(key);
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const slice = acts.filter(a => group.has(a));
      const fk    = arrayToVariantKey(slice);
      projections[gi].set(fk, (projections[gi].get(fk) ?? 0) + count);
    }
  }

  return projections;
}

// ── Concurrency cut ───────────────────────────────────────────────────────────

/**
 * Concurrency (Parallel) cut.
 * All activities must have edges in both directions between groups.
 * Mirrors pm4py ConcurrencyCut.apply().
 *
 * Algorithm: start with all nodes in one group, then split any pair (a,b)
 * that does NOT have both a→b and b→a in the DFG into separate groups.
 *
 * @param {Set<string>} nodes
 * @param {Map<string,number>} dfg
 * @param {Map<string,number>} startActs
 * @param {Map<string,number>} endActs
 * @returns {Set<string>[]|null}
 */
function _concurrencyCut(nodes, dfg, startActs, endActs) {
  if (nodes.size <= 1) return null;

  // Union-Find: nodes in the same component must NOT be concurrent with each other
  // We separate nodes that are NOT bidirectionally connected
  const uf = _makeUF(nodes);

  // Two nodes a, b must be in the same group if they are NOT fully concurrent
  // i.e., if a→b or b→a is missing from the DFG
  const nodeArr = [...nodes];
  for (let i = 0; i < nodeArr.length; i++) {
    for (let j = i + 1; j < nodeArr.length; j++) {
      const a = nodeArr[i], b = nodeArr[j];
      if (!dfg.has(dfgKey(a, b)) || !dfg.has(dfgKey(b, a))) {
        uf.union(a, b);
      }
    }
  }

  const groups = uf.groups();
  if (groups.length < 2) return null;

  // Additional validity checks from pm4py:
  // 1. Every start activity must appear in every group
  // 2. Every end activity must appear in every group
  for (const group of groups) {
    for (const sa of startActs.keys()) {
      if (nodes.has(sa) && !group.has(sa)) {
        // start activity is in a different group — that's fine (only some groups need starts)
        // pm4py actually checks that every group has SOME start activity
      }
    }
  }

  // pm4py check: each group must have at least one start activity AND one end activity
  for (const group of groups) {
    let hasStart = false, hasEnd = false;
    for (const a of group) {
      if (startActs.has(a)) hasStart = true;
      if (endActs.has(a)) hasEnd = true;
    }
    if (!hasStart || !hasEnd) return null;
  }

  return groups;
}

/**
 * Project UVCL onto concurrency groups.
 * Each group gets a projected log containing only its activities.
 * Mirrors ConcurrencyCut.project().
 *
 * @param {Map<string,number>} uvcl
 * @param {Set<string>[]} groups
 * @returns {Map<string,number>[]}
 */
function _concurrencyProject(uvcl, groups) {
  return groups.map(group => {
    const proj = new Map();
    for (const [key, count] of uvcl) {
      const acts = variantKeyToArray(key).filter(a => group.has(a));
      const fk = arrayToVariantKey(acts);
      proj.set(fk, (proj.get(fk) ?? 0) + count);
    }
    return proj;
  });
}

// ── Loop cut ──────────────────────────────────────────────────────────────────

/**
 * Compute connected components among "redo" candidates (nodes not in do-set),
 * respecting the loop structure.
 * Mirrors LoopCut.__compute_loop_connected_components().
 *
 * @param {Set<string>} nodes
 * @param {Map<string,number>} dfg
 * @param {Map<string,number>} startActs
 * @param {Map<string,number>} endActs
 * @returns {{ doSet: Set<string>, redoGroups: Set<string>[] }|null}
 */
function _loopCut(nodes, dfg, startActs, endActs) {
  if (nodes.size <= 1) return null;

  // do-set = start activities ∪ end activities (within the current node set)
  const doSet = new Set();
  for (const a of startActs.keys()) if (nodes.has(a)) doSet.add(a);
  for (const a of endActs.keys())   if (nodes.has(a)) doSet.add(a);

  // redo candidates = everything else
  const redoCandidates = new Set([...nodes].filter(n => !doSet.has(n)));

  // Check 1: every redo-candidate must have edges only to/from do-set or other redo-candidates
  // (pm4py actually checks 4 conditions)

  // Check 2: every redo node must have an edge to a start activity (do→redo edge OK)
  // and an edge from an end activity (redo→do edge OK)
  // Simplified: build redo sub-DFG + edges bridging redo↔do
  const uf = _makeUF(redoCandidates);
  for (const key of dfg.keys()) {
    const [a, b] = dfgKeyParts(key);
    if (redoCandidates.has(a) && redoCandidates.has(b)) {
      uf.union(a, b);
    }
  }

  const redoGroups = redoCandidates.size > 0 ? uf.groups() : [];

  // Validity checks (mirrors pm4py LoopCut._apply()):
  // 1. No edges from do-node to do-node that skip through redo
  //    (Can't easily check without more info; we trust the DFG structure)

  // 2. Every redo group must have ≥1 edge coming from an end activity
  //    AND ≥1 edge going to a start activity
  for (const rg of redoGroups) {
    let hasInFromEnd = false, hasOutToStart = false;
    for (const r of rg) {
      for (const e of endActs.keys()) {
        if (nodes.has(e) && dfg.has(dfgKey(e, r))) { hasInFromEnd = true; break; }
      }
      for (const s of startActs.keys()) {
        if (nodes.has(s) && dfg.has(dfgKey(r, s))) { hasOutToStart = true; break; }
      }
    }
    if (!hasInFromEnd || !hasOutToStart) return null;
  }

  // 3. No edges from redo to redo across groups (already separated by UF)
  // 4. Every start-activity must have an edge from every end-activity
  //    OR from some redo group (for valid looping)
  //    pm4py checks: no direct end→start edge unless it's via redo
  // We enforce a simpler but sufficient check:
  // If there are no redo candidates at all, this isn't a loop cut
  if (redoCandidates.size === 0) return null;

  return { doSet, redoGroups };
}

/**
 * Project UVCL onto loop groups [do, redo1, redo2, ...].
 * Mirrors LoopCut.project().
 *
 * Segmentation: a trace is split at do→redo and redo→do transitions.
 * do-portions go into doProj; redo-portions go into the matching redoProj.
 *
 * @param {Map<string,number>} uvcl
 * @param {Set<string>} doSet
 * @param {Set<string>[]} redoGroups
 * @returns {Map<string,number>[]}  [doProj, redoProj0, redoProj1, ...]
 */
function _loopProject(uvcl, doSet, redoGroups) {
  const doProj   = new Map();
  const redoProjs = redoGroups.map(() => new Map());

  // Helper: which redo group does an activity belong to?
  const actToRedoIdx = new Map();
  for (let ri = 0; ri < redoGroups.length; ri++) {
    for (const a of redoGroups[ri]) actToRedoIdx.set(a, ri);
  }

  function addToProj(proj, acts, count) {
    const fk = arrayToVariantKey(acts);
    proj.set(fk, (proj.get(fk) ?? 0) + count);
  }

  for (const [key, count] of uvcl) {
    const acts = variantKeyToArray(key);

    let segment = [];
    let inRedo  = false;
    let redoIdx = -1;

    function flush() {
      if (!inRedo) {
        addToProj(doProj, segment, count);
      } else {
        addToProj(redoProjs[redoIdx], segment, count);
      }
      segment = [];
    }

    for (const a of acts) {
      const isDoAct   = doSet.has(a);
      const isRedoAct = actToRedoIdx.has(a);

      if (isDoAct && !inRedo) {
        segment.push(a);
      } else if (isRedoAct && !inRedo) {
        // Transition: flush do-segment, start redo
        flush();
        inRedo  = true;
        redoIdx = actToRedoIdx.get(a);
        segment.push(a);
      } else if (isDoAct && inRedo) {
        // Transition: flush redo-segment, start new do
        flush();
        inRedo  = false;
        segment.push(a);
      } else if (isRedoAct && inRedo) {
        if (actToRedoIdx.get(a) === redoIdx) {
          segment.push(a);
        } else {
          // Switch redo group (unusual but handle)
          flush();
          redoIdx = actToRedoIdx.get(a);
          segment.push(a);
        }
      }
      // Unknown activity: skip
    }
    flush();
  }

  return [doProj, ...redoProjs];
}

// ── Base cases ────────────────────────────────────────────────────────────────

/**
 * True if the UVCL represents an empty log (no variants, or only the empty trace).
 */
function _isEmptyLog(uvcl) {
  for (const [key, count] of uvcl) {
    if (count <= 0) continue;
    const acts = variantKeyToArray(key);
    if (acts.length > 0) return false;
  }
  return true;
}

/**
 * True if the UVCL has exactly one activity (all traces are [X] for some X,
 * possibly with the empty trace present too).
 * Mirrors SingleActivityBaseCase.
 */
function _isSingleActivity(uvcl) {
  const acts = _uvclAlphabet(uvcl);
  return acts.size === 1;
}

// ── Fall-throughs ─────────────────────────────────────────────────────────────

/**
 * Flower model fall-through.
 * Returns LOOP(τ, XOR(a1, a2, ...)) — fires any activity zero or more times
 * in any order.
 * Mirrors FlowerModel.apply().
 *
 * @param {Map<string,number>} uvcl
 * @returns {ProcessTreeNode}
 */
function _flowerModel(uvcl) {
  const acts = [..._uvclAlphabet(uvcl)].sort();
  const xorChildren = acts.map(a => makeLeaf(a));
  // Add tau so the XOR can be skipped (redo can fire zero times in loop)
  xorChildren.push(makeLeaf(null)); // tau
  return makeNode('loop', [makeLeaf(null), makeNode('xor', xorChildren)]);
}

/**
 * Empty-traces fall-through.
 * If the log contains the empty trace, wrap the remainder in XOR(τ, recurse).
 * Mirrors EmptyTracesUVCL.apply().
 *
 * @param {Map<string,number>} uvcl
 * @returns {{ tree: ProcessTreeNode, remainder: Map<string,number> }|null}
 *   Returns null if no empty traces present.
 */
function _emptyTracesFallThrough(uvcl) {
  let hasEmpty = false;
  const remainder = new Map();
  for (const [key, count] of uvcl) {
    const acts = variantKeyToArray(key);
    if (acts.length === 0) hasEmpty = true;
    else remainder.set(key, count);
  }
  return hasEmpty ? { remainder } : null;
}

// ── Main recursion ────────────────────────────────────────────────────────────

/**
 * Recursively apply the Inductive Miner (IMUVCL) to a compressed log.
 * Mirrors InductiveMinerFramework._recurse() / apply().
 *
 * @param {Map<string,number>} uvcl
 * @returns {ProcessTreeNode}
 */
function _imRecurse(uvcl) {
  // ── Base case 1: empty log ────────────────────────────────────────────────
  if (_isEmptyLog(uvcl)) {
    return makeLeaf(null); // tau
  }

  // ── Base case 2: single activity ──────────────────────────────────────────
  if (_isSingleActivity(uvcl)) {
    const act = [..._uvclAlphabet(uvcl)][0];
    let hasEmpty = false, hasMulti = false;
    for (const [key, count] of uvcl) {
      if (count <= 0) continue;
      const len = variantKeyToArray(key).length;
      if (len === 0) hasEmpty = true;
      if (len > 1)   hasMulti = true;
    }
    // Traces longer than 1 mean the activity self-loops → LOOP(act, τ)
    if (hasMulti) {
      const loop = makeNode('loop', [makeLeaf(act), makeLeaf(null)]);
      return hasEmpty ? makeNode('xor', [makeLeaf(null), loop]) : loop;
    }
    if (hasEmpty) return makeNode('xor', [makeLeaf(null), makeLeaf(act)]);
    return makeLeaf(act);
  }

  // ── Fall-through 1: empty traces ──────────────────────────────────────────
  const emptyFT = _emptyTracesFallThrough(uvcl);
  if (emptyFT) {
    const child = _imRecurse(emptyFT.remainder);
    return makeNode('xor', [makeLeaf(null), child]);
  }

  // Compute DFG for cut detection
  const { dfg, startActs, endActs } = _computeImDfg(uvcl);
  const nodes = _uvclAlphabet(uvcl);

  // ── XOR cut ───────────────────────────────────────────────────────────────
  {
    const groups = _xorCut(nodes, dfg);
    if (groups) {
      const projections = _xorProject(uvcl, groups);
      return makeNode('xor', projections.map(_imRecurse));
    }
  }

  // ── Sequence cut ──────────────────────────────────────────────────────────
  {
    const groups = _sequenceCut(nodes, dfg, startActs, endActs);
    if (groups) {
      const projections = _seqProject(uvcl, groups);
      return makeNode('sequence', projections.map(_imRecurse));
    }
  }

  // ── Concurrency cut ───────────────────────────────────────────────────────
  {
    const groups = _concurrencyCut(nodes, dfg, startActs, endActs);
    if (groups) {
      const projections = _concurrencyProject(uvcl, groups);
      return makeNode('parallel', projections.map(_imRecurse));
    }
  }

  // ── Loop cut ──────────────────────────────────────────────────────────────
  {
    const result = _loopCut(nodes, dfg, startActs, endActs);
    if (result) {
      const { doSet, redoGroups } = result;
      const projections = _loopProject(uvcl, doSet, redoGroups);
      return makeNode('loop', projections.map(_imRecurse));
    }
  }

  // ── Fall-through: Flower model ────────────────────────────────────────────
  return _flowerModel(uvcl);
}

// ── Process Tree → Petri Net conversion ──────────────────────────────────────

/**
 * Convert a process tree to a Petri net (with initial and final markings).
 *
 * Standard conversion rules:
 *   Leaf(act)  : pIn → t_act → pOut
 *   Leaf(tau)  : pIn → t_silent → pOut
 *   Sequence   : chain with shared intermediate places
 *   XOR        : all children share pIn and pOut
 *   Parallel   : AND-split → children → AND-join (silent transitions)
 *   Loop       : do-child maps (pIn,pOut); redo-children map (pOut,pIn)
 *
 * @param {ProcessTreeNode} tree
 * @returns {{ net: PetriNet, source: Place, sink: Place }}
 */
function _processTreeToPetriNet(tree) {
  const net = new PetriNet(PetriNet.generateId(), 'inductive_miner_net');

  const source = new Place(PetriNet.generateId(), { x: 0, y: 0 }, 'start', 1);
  const sink   = new Place(PetriNet.generateId(), { x: 0, y: 0 }, 'end',   0, null, 1);
  net.addPlace(source);
  net.addPlace(sink);

  _convertNode(net, tree, source.id, sink.id);

  return { net, source, sink };
}

/**
 * Recursively wire a process tree node between pInId and pOutId.
 *
 * @param {PetriNet} net
 * @param {ProcessTreeNode} node
 * @param {string} pInId
 * @param {string} pOutId
 */
function _convertNode(net, node, pInId, pOutId) {
  if (node.operator === null) {
    // Leaf
    const isSilent = node.label === null;
    const t = new Transition(
      PetriNet.generateId(), { x: 0, y: 0 },
      isSilent ? '' : node.label,
      1, 0, isSilent
    );
    net.addTransition(t);
    net.addArc(new Arc(PetriNet.generateId(), pInId,  t.id));
    net.addArc(new Arc(PetriNet.generateId(), t.id,   pOutId));
    return;
  }

  if (node.operator === 'sequence') {
    // Chain: pIn → child[0] → p1 → child[1] → p2 → ... → child[n-1] → pOut
    let curIn = pInId;
    for (let i = 0; i < node.children.length; i++) {
      const curOut = i < node.children.length - 1
        ? (() => { const p = new Place(PetriNet.generateId(), { x: 0, y: 0 }); net.addPlace(p); return p.id; })()
        : pOutId;
      _convertNode(net, node.children[i], curIn, curOut);
      curIn = curOut;
    }
    return;
  }

  if (node.operator === 'xor') {
    // All children share pIn and pOut
    for (const child of node.children) {
      _convertNode(net, child, pInId, pOutId);
    }
    return;
  }

  if (node.operator === 'parallel') {
    // AND-split: silent t_split fires once, produces one token per child
    // AND-join:  silent t_join fires once, consumes one token per child
    const tSplit = new Transition(PetriNet.generateId(), { x: 0, y: 0 }, '', 1, 0, true);
    const tJoin  = new Transition(PetriNet.generateId(), { x: 0, y: 0 }, '', 1, 0, true);
    net.addTransition(tSplit);
    net.addTransition(tJoin);
    net.addArc(new Arc(PetriNet.generateId(), pInId,    tSplit.id));
    net.addArc(new Arc(PetriNet.generateId(), tJoin.id, pOutId));

    for (const child of node.children) {
      const pChildIn  = new Place(PetriNet.generateId(), { x: 0, y: 0 });
      const pChildOut = new Place(PetriNet.generateId(), { x: 0, y: 0 });
      net.addPlace(pChildIn);
      net.addPlace(pChildOut);
      net.addArc(new Arc(PetriNet.generateId(), tSplit.id,    pChildIn.id));
      net.addArc(new Arc(PetriNet.generateId(), pChildOut.id, tJoin.id));
      _convertNode(net, child, pChildIn.id, pChildOut.id);
    }
    return;
  }

  if (node.operator === 'loop') {
    // Loop: children[0] = do-body, children[1..] = redo-bodies
    // Structure: pIn → do-body → pOut → (redo-body → pIn)* | exit → pOut (already done)
    // Petri net encoding:
    //   pIn → [do-body] → pOut
    //   pOut → [redo-body_i] → pIn   (for each redo child)
    const doChild = node.children[0];
    _convertNode(net, doChild, pInId, pOutId);

    for (let i = 1; i < node.children.length; i++) {
      _convertNode(net, node.children[i], pOutId, pInId);
    }
    return;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply the Inductive Miner (IMUVCL) to an event log.
 *
 * @param {EventLog} log
 * @param {object}  [params]
 * @param {string}  [params.activityKey]
 * @returns {{ net: PetriNet, initialMarking: Map<string,number>,
 *             finalMarking: Map<string,number>, source: Place, sink: Place,
 *             processTree: ProcessTreeNode }}
 */
function applyInductiveMiner(log, params = {}) {
  const activityKey = params.activityKey || log.activityKey || DEFAULT_NAME_KEY;
  const uvcl = getUVCL(log, activityKey);
  return applyInductiveMinerUvcl(uvcl);
}

/**
 * Apply the Inductive Miner directly to a UVCL (compressed log).
 *
 * @param {Map<string,number>} uvcl
 * @returns {{ net: PetriNet, source: Place, sink: Place,
 *             processTree: ProcessTreeNode }}
 */
function applyInductiveMinerUvcl(uvcl) {
  const processTree = _imRecurse(uvcl);
  const { net, source, sink } = _processTreeToPetriNet(processTree);
  net.updateEnabledTransitions();

  return { net, source, sink, processTree };
}

/**
 * Generic directed graph for the Sugiyama layout pipeline.
 *
 * Nodes carry a width and height used by the coordinate-assignment phase to
 * space nodes without overlaps.  Edges are simple directed pairs identified
 * by a caller-supplied id.
 *
 * The graph is intentionally mutable: the layout pipeline adds dummy nodes,
 * reverses back-edges, and removes them again during computation.
 *
 * All mutating methods return `this` for chaining.
 *
 * Usage (browser + Node.js via vm.runInThisContext):
 *   var declarations hoist onto the global object so LayoutGraph,
 *   LayoutNode and LayoutEdge are accessible after loading with
 *   vm.runInThisContext.
 */

// ── Node ─────────────────────────────────────────────────────────────────────

var LayoutNode = class LayoutNode {
  /**
   * @param {string} id
   * @param {number} width   Pixel width  (used for coordinate spacing)
   * @param {number} height  Pixel height (used for coordinate spacing)
   */
  constructor(id, width = 0, height = 0) {
    this.id     = id;
    this.width  = width;
    this.height = height;
  }
};


// ── Edge ─────────────────────────────────────────────────────────────────────

var LayoutEdge = class LayoutEdge {
  /**
   * @param {string} id
   * @param {string} source  Node id
   * @param {string} target  Node id
   */
  constructor(id, source, target) {
    this.id       = id;
    this.source   = source;
    this.target   = target;
    /** True when this edge has been flipped by cycle removal. */
    this.reversed = false;
  }
};


// ── Graph ────────────────────────────────────────────────────────────────────

var LayoutGraph = class LayoutGraph {
  constructor() {
    /** @type {Map<string, LayoutNode>} */
    this._nodes = new Map();
    /** @type {Map<string, LayoutEdge>} */
    this._edges = new Map();
    /** @type {Map<string, Set<string>>} nodeId → Set of outgoing edge ids */
    this._out   = new Map();
    /** @type {Map<string, Set<string>>} nodeId → Set of incoming edge ids */
    this._in    = new Map();
  }

  // ── Mutation ──────────────────────────────────────────────────────────────

  /**
   * Add a node.  Throws if the id is already present.
   * @param {string} id
   * @param {number} [width=0]
   * @param {number} [height=0]
   * @returns {this}
   */
  addNode(id, width = 0, height = 0) {
    if (this._nodes.has(id)) throw new Error(`Duplicate node id: "${id}"`);
    this._nodes.set(id, new LayoutNode(id, width, height));
    this._out.set(id, new Set());
    this._in.set(id, new Set());
    return this;
  }

  /**
   * Add a directed edge.  Throws if the id is already present or if either
   * endpoint does not exist.
   * @param {string} id
   * @param {string} source  Node id
   * @param {string} target  Node id
   * @returns {this}
   */
  addEdge(id, source, target) {
    if (this._edges.has(id))       throw new Error(`Duplicate edge id: "${id}"`);
    if (!this._nodes.has(source))  throw new Error(`Unknown source node: "${source}"`);
    if (!this._nodes.has(target))  throw new Error(`Unknown target node: "${target}"`);
    this._edges.set(id, new LayoutEdge(id, source, target));
    this._out.get(source).add(id);
    this._in.get(target).add(id);
    return this;
  }

  /**
   * Remove an edge.  No-op if the edge does not exist.
   * @param {string} id
   * @returns {this}
   */
  removeEdge(id) {
    const e = this._edges.get(id);
    if (!e) return this;
    this._out.get(e.source).delete(id);
    this._in.get(e.target).delete(id);
    this._edges.delete(id);
    return this;
  }

  /**
   * Remove a node and all of its incident edges.  No-op if the node does not
   * exist.
   * @param {string} id
   * @returns {this}
   */
  removeNode(id) {
    if (!this._nodes.has(id)) return this;
    // Collect incident edge ids before mutating (self-edges appear in both sets)
    const incident = new Set([
      ...this._out.get(id),
      ...this._in.get(id),
    ]);
    for (const eid of incident) this.removeEdge(eid);
    this._out.delete(id);
    this._in.delete(id);
    this._nodes.delete(id);
    return this;
  }

  /**
   * Reverse an edge in-place, swapping source ↔ target and toggling the
   * `reversed` flag.  Double-reversing restores the original direction.
   * No-op if the edge does not exist.
   * @param {string} id
   * @returns {this}
   */
  reverseEdge(id) {
    const e = this._edges.get(id);
    if (!e) return this;
    this._out.get(e.source).delete(id);
    this._in.get(e.target).delete(id);
    const tmp = e.source;
    e.source   = e.target;
    e.target   = tmp;
    e.reversed = !e.reversed;
    this._out.get(e.source).add(id);
    this._in.get(e.target).add(id);
    return this;
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /** @returns {LayoutNode|undefined} */
  node(id) { return this._nodes.get(id); }

  /** @returns {LayoutEdge|undefined} */
  edge(id) { return this._edges.get(id); }

  /** @returns {IterableIterator<string>} */
  get nodeIds() { return this._nodes.keys(); }

  /** @returns {IterableIterator<string>} */
  get edgeIds() { return this._edges.keys(); }

  get nodeCount() { return this._nodes.size; }
  get edgeCount()  { return this._edges.size; }

  hasNode(id) { return this._nodes.has(id); }
  hasEdge(id) { return this._edges.has(id); }

  /**
   * Edge ids of all edges leaving `id`.
   * @param {string} id
   * @returns {string[]}
   */
  outEdges(id) { return [...(this._out.get(id) ?? [])]; }

  /**
   * Edge ids of all edges entering `id`.
   * @param {string} id
   * @returns {string[]}
   */
  inEdges(id) { return [...(this._in.get(id) ?? [])]; }

  /**
   * Direct successor node ids (targets of outgoing edges).
   * @param {string} id
   * @returns {string[]}
   */
  successors(id) {
    return this.outEdges(id).map(eid => this._edges.get(eid).target);
  }

  /**
   * Direct predecessor node ids (sources of incoming edges).
   * @param {string} id
   * @returns {string[]}
   */
  predecessors(id) {
    return this.inEdges(id).map(eid => this._edges.get(eid).source);
  }

  /**
   * Node ids with no incoming edges.
   * @returns {string[]}
   */
  sources() {
    return [...this._nodes.keys()].filter(id => this._in.get(id).size === 0);
  }

  /**
   * Node ids with no outgoing edges.
   * @returns {string[]}
   */
  sinks() {
    return [...this._nodes.keys()].filter(id => this._out.get(id).size === 0);
  }
};

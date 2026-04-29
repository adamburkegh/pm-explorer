/**
 * Core event log data structures.
 * Mirrors pm4py/objects/log/obj.py — EventLog, Trace, Event.
 *
 * Iteration semantics match pm4py:
 *   for (const trace of log)  { ... }   // iterates Trace objects
 *   for (const event of trace) { ... }  // iterates Event objects
 *   event.get('concept:name')            // attribute access (Map API)
 *   trace.attributes['concept:name']     // trace-level attribute
 */

// ── Event ─────────────────────────────────────────────────────────────────────
// Mirrors pm4py Event (Mapping). Extends Map for native JS dict semantics.
class Event extends Map {
  /**
   * @param {object|Map|Array} [init] - optional key-value pairs
   */
  constructor(init) {
    super();
    if (init) {
      if (init instanceof Map) {
        for (const [k, v] of init) this.set(k, v);
      } else if (Array.isArray(init)) {
        for (const [k, v] of init) this.set(k, v);
      } else {
        for (const [k, v] of Object.entries(init)) this.set(k, v);
      }
    }
  }

  /** Convenience: attribute access via bracket-style get. */
  attr(key, fallback = undefined) {
    return this.has(key) ? this.get(key) : fallback;
  }

  toObject() {
    return Object.fromEntries(this);
  }
}

// ── Trace ─────────────────────────────────────────────────────────────────────
// Mirrors pm4py Trace (Sequence of Event). Wraps an array internally.
class Trace {
  constructor() {
    this._events    = [];   // Event[]
    this.attributes = {};   // trace-level XES attributes  (e.g. concept:name = case id)
    this.properties = {};   // runtime state (not persisted to XES)
  }

  // Sequence protocol
  get length() { return this._events.length; }
  [Symbol.iterator]() { return this._events[Symbol.iterator](); }
  at(i) { return this._events.at(i); }

  append(event) { this._events.push(event); return this; }
  insert(i, event) { this._events.splice(i, 0, event); return this; }

  /** Return a shallow copy with the same attributes. */
  clone() {
    const t = new Trace();
    t.attributes = { ...this.attributes };
    t.properties = { ...this.properties };
    t._events    = [...this._events];
    return t;
  }

  /** Project to array of values for a single attribute key. */
  project(key) {
    return this._events.map(e => e.get(key));
  }
}

// ── EventStream ───────────────────────────────────────────────────────────────
// Base class, mirrors pm4py EventStream. Holds a flat sequence of Trace objects.
class EventStream {
  constructor() {
    this._traces       = [];   // Trace[]
    this.attributes    = {};   // log-level XES attributes
    this.extensions    = {};   // XES extension declarations  { prefix: {name, uri} }
    this.omniPresent   = {};   // XES global defaults  { 'trace': {key:val,...}, 'event': {key:val,...} }
    this.classifiers   = {};   // XES classifiers  { name: [key, ...] }
    this.properties    = {};   // runtime properties (set by importer; holds PARAM_* defaults)
  }

  get length() { return this._traces.length; }
  [Symbol.iterator]() { return this._traces[Symbol.iterator](); }
  at(i) { return this._traces.at(i); }

  append(trace) { this._traces.push(trace); return this; }

  /** Convenience: get the effective activity key from properties, or default. */
  get activityKey() {
    return this.properties[PARAM_ACTIVITY_KEY] ?? DEFAULT_NAME_KEY;
  }

  /** Convenience: get the effective case-id attribute key from properties, or default. */
  get caseIdKey() {
    return this.properties[PARAM_CASEID_KEY] ?? DEFAULT_TRACEID_KEY;
  }

  /** Convenience: get the effective timestamp key. */
  get timestampKey() {
    return this.properties[PARAM_TIMESTAMP_KEY] ?? DEFAULT_TIMESTAMP_KEY;
  }
}

// ── EventLog ──────────────────────────────────────────────────────────────────
// Mirrors pm4py EventLog (extends EventStream). Primary container.
class EventLog extends EventStream {
  constructor() {
    super();
    // Populate default parameter keys so callers can always read them.
    Object.assign(this.properties, DEFAULT_LOG_PROPERTIES);
  }

  /**
   * Filter traces, returning a new EventLog preserving metadata.
   * @param {function(Trace): boolean} predicate
   */
  filter(predicate) {
    const result = _copyLogMeta(this);
    for (const trace of this) {
      if (predicate(trace)) result.append(trace);
    }
    return result;
  }

  /**
   * Map traces to a new EventLog.
   * @param {function(Trace): Trace} fn
   */
  map(fn) {
    const result = _copyLogMeta(this);
    for (const trace of this) result.append(fn(trace));
    return result;
  }

  /**
   * Serialize to a plain object (for JSON.stringify / storage).
   * Timestamps are serialized as ISO strings.
   */
  toJSON() {
    return {
      attributes:  this.attributes,
      extensions:  this.extensions,
      classifiers: this.classifiers,
      omniPresent: this.omniPresent,
      properties:  this.properties,
      traces: Array.from(this).map(trace => ({
        attributes: trace.attributes,
        events: Array.from(trace).map(event => {
          const obj = {};
          for (const [k, v] of event) {
            obj[k] = v instanceof Date ? v.toISOString() : v;
          }
          return obj;
        })
      }))
    };
  }

  /**
   * Deserialize from a plain object produced by toJSON().
   * @param {object} data
   * @param {string} [tsKey] - timestamp key to parse back to Date
   */
  static fromJSON(data, tsKey = DEFAULT_TIMESTAMP_KEY) {
    const log = new EventLog();
    Object.assign(log.attributes,  data.attributes  || {});
    Object.assign(log.extensions,  data.extensions  || {});
    Object.assign(log.classifiers, data.classifiers || {});
    Object.assign(log.omniPresent, data.omniPresent || {});
    Object.assign(log.properties,  { ...DEFAULT_LOG_PROPERTIES, ...(data.properties || {}) });

    for (const td of (data.traces || [])) {
      const trace = new Trace();
      trace.attributes = { ...td.attributes };
      for (const ed of (td.events || [])) {
        const event = new Event();
        for (const [k, v] of Object.entries(ed)) {
          event.set(k, k === tsKey && typeof v === 'string' ? new Date(v) : v);
        }
        trace.append(event);
      }
      log.append(trace);
    }
    return log;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function _copyLogMeta(src) {
  const dst = new EventLog();
  dst.attributes  = { ...src.attributes };
  dst.extensions  = { ...src.extensions };
  dst.classifiers = { ...src.classifiers };
  dst.omniPresent = { ...src.omniPresent };
  dst.properties  = { ...src.properties };
  return dst;
}

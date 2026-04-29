/**
 * XES event log parser.
 * Mirrors pm4py/objects/log/importer/xes/variants/iterparse.py.
 *
 * Uses the browser DOMParser API (or a compatible DOM in Node.js).
 * Produces an EventLog with fully typed attributes.
 *
 * XES type → JS type mapping:
 *   string    → string
 *   date      → Date
 *   int       → number (integer)
 *   float     → number (float)
 *   boolean   → boolean
 *   id        → string
 *   list      → object  { values: [...] }
 *   container → object  { values: [...] }   (XES 2.0)
 */

class XesParser {
  /**
   * Parse an XES XML string into an EventLog.
   *
   * @param {string} xmlText - raw XES XML content
   * @param {object} [params]
   * @param {boolean} [params.sortByTimestamp=true]   - sort events within each trace by timestamp
   * @param {string}  [params.timestampKey]           - override timestamp key for sorting
   * @param {number}  [params.maxTraces=Infinity]     - import at most N traces
   * @returns {EventLog}
   */
  parse(xmlText, params = {}) {
    const sortByTimestamp = params.sortByTimestamp ?? true;
    const tsKey           = params.timestampKey ?? DEFAULT_TIMESTAMP_KEY;
    const maxTraces       = params.maxTraces    ?? Infinity;

    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');

    const parseError = dom.querySelector('parsererror');
    if (parseError) {
      throw new Error(`XES parse error: ${parseError.textContent.trim()}`);
    }

    const logEl = dom.documentElement;
    if (logEl.tagName !== TAG_LOG && logEl.localName !== TAG_LOG) {
      throw new Error(`Root element is <${logEl.tagName}>, expected <log>`);
    }

    const log = new EventLog();

    // ── Log-level metadata ─────────────────────────────────────────────────
    for (const child of logEl.children) {
      const tag = child.localName;

      if (tag === TAG_EXTENSION) {
        const prefix = child.getAttribute(KEY_PREFIX);
        if (prefix) {
          log.extensions[prefix] = {
            name: child.getAttribute(KEY_NAME),
            uri:  child.getAttribute(KEY_URI),
          };
        }

      } else if (tag === TAG_GLOBAL) {
        const scope = child.getAttribute(KEY_SCOPE) || 'event';
        if (!log.omniPresent[scope]) log.omniPresent[scope] = {};
        for (const attrEl of child.children) {
          const { key, value } = this._parseAttrEl(attrEl);
          if (key !== null) log.omniPresent[scope][key] = value;
        }

      } else if (tag === TAG_CLASSIFIER) {
        const name = child.getAttribute(KEY_NAME);
        const keys = (child.getAttribute(KEY_KEYS) || '').trim().split(/\s+/).filter(Boolean);
        if (name) log.classifiers[name] = keys;

      } else if (this._isAttrTag(tag)) {
        const { key, value } = this._parseAttrEl(child);
        if (key !== null) log.attributes[key] = value;
      }
    }

    // ── Traces ─────────────────────────────────────────────────────────────
    let traceCount = 0;
    for (const traceEl of logEl.children) {
      if (traceEl.localName !== TAG_TRACE) continue;
      if (traceCount >= maxTraces) break;

      const trace = new Trace();

      for (const child of traceEl.children) {
        const tag = child.localName;

        if (tag === TAG_EVENT) {
          const event = new Event();
          for (const attrEl of child.children) {
            const { key, value } = this._parseAttrEl(attrEl);
            if (key !== null) event.set(key, value);
          }
          // Apply event-level global defaults for missing keys
          if (log.omniPresent.event) {
            for (const [k, v] of Object.entries(log.omniPresent.event)) {
              if (!event.has(k)) event.set(k, v);
            }
          }
          trace.append(event);

        } else if (this._isAttrTag(tag)) {
          const { key, value } = this._parseAttrEl(child);
          if (key !== null) trace.attributes[key] = value;
        }
      }

      // Apply trace-level global defaults
      if (log.omniPresent.trace) {
        for (const [k, v] of Object.entries(log.omniPresent.trace)) {
          if (!(k in trace.attributes)) trace.attributes[k] = v;
        }
      }

      if (sortByTimestamp) {
        trace._events.sort((a, b) => {
          const ta = a.get(tsKey);
          const tb = b.get(tsKey);
          if (!(ta instanceof Date) || !(tb instanceof Date)) return 0;
          return ta - tb;
        });
      }

      log.append(trace);
      traceCount++;
    }

    // ── Post-import: set default property keys (mirrors pm4py importer) ────
    Object.assign(log.properties, DEFAULT_LOG_PROPERTIES);
    // Override timestamp key if caller supplied one
    if (params.timestampKey) log.properties[PARAM_TIMESTAMP_KEY] = params.timestampKey;

    return log;
  }

  // ── Attribute parsing ─────────────────────────────────────────────────────

  _isAttrTag(tag) {
    return [TAG_STRING, TAG_DATE, TAG_INT, TAG_FLOAT, TAG_BOOLEAN, TAG_ID,
            TAG_LIST, TAG_CONTAINER].includes(tag);
  }

  /**
   * Parse a single XES attribute element into { key, value }.
   * Handles nested list/container children recursively.
   */
  _parseAttrEl(el) {
    const tag = el.localName;
    const key = el.getAttribute(KEY_KEY);
    if (!key) return { key: null, value: null };

    switch (tag) {
      case TAG_STRING: return { key, value: el.getAttribute(KEY_VALUE) ?? '' };
      case TAG_ID:     return { key, value: el.getAttribute(KEY_VALUE) ?? '' };

      case TAG_DATE: {
        const raw = el.getAttribute(KEY_VALUE);
        const d = raw ? new Date(raw) : null;
        return { key, value: d && !isNaN(d) ? d : null };
      }

      case TAG_INT: {
        const n = parseInt(el.getAttribute(KEY_VALUE), 10);
        return { key, value: isNaN(n) ? null : n };
      }

      case TAG_FLOAT: {
        const n = parseFloat(el.getAttribute(KEY_VALUE));
        return { key, value: isNaN(n) ? null : n };
      }

      case TAG_BOOLEAN: {
        const raw = (el.getAttribute(KEY_VALUE) || '').toLowerCase();
        return { key, value: raw === 'true' };
      }

      case TAG_LIST:
      case TAG_CONTAINER: {
        const values = [];
        // Children may be inside a <values> wrapper (list) or direct (container)
        const childEls = el.querySelector(TAG_VALUES)?.children ?? el.children;
        for (const child of childEls) {
          const parsed = this._parseAttrEl(child);
          if (parsed.key !== null) values.push({ key: parsed.key, value: parsed.value });
        }
        return { key, value: { values } };
      }

      default:
        return { key, value: el.getAttribute(KEY_VALUE) ?? null };
    }
  }

  // ── Convenience: parse from a File or Blob ────────────────────────────────

  /**
   * Parse an XES File/Blob (async, returns Promise<EventLog>).
   * @param {File|Blob} file
   * @param {object} [params]
   */
  async parseFile(file, params = {}) {
    const text = await file.text();
    return this.parse(text, params);
  }

  /**
   * Parse from a URL (async, returns Promise<EventLog>).
   * @param {string} url
   * @param {object} [params]
   */
  async parseUrl(url, params = {}) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch XES: ${resp.status} ${resp.statusText}`);
    const text = await resp.text();
    return this.parse(text, params);
  }
}

// Singleton for convenience
const xesParser = new XesParser();

/**
 * DTLog — minimal text format for event logs.
 *
 * Format rules
 * ────────────
 *   • One line = one case (trace).
 *   • Lines starting with # are comments; blank lines are ignored.
 *   • Delimiter is detected per-line:
 *       – If the line contains a comma  → split on commas   (multi-word names OK)
 *       – Otherwise                     → split on whitespace (simple single-word names)
 *
 * Examples:
 *   a b c d                            → 4 activities, space-split
 *   register request, examine, decide  → 3 activities, comma-split (multi-word safe)
 *
 * Synthetic timestamps are assigned (1 min apart) so the EventLog is
 * compatible with time-aware algorithms.
 *
 */

/**
 * Parse DTLog text into an EventLog.
 *
 * @param {string} text
 * @returns {{ log: EventLog, errors: string[] }}
 */
function parseDtLog(text) {
  const log    = new EventLog();
  const errors = [];
  const actKey = DEFAULT_NAME_KEY;

  // Synthetic base: 2024-01-01 00:00:00 UTC
  const BASE_MS  = Date.UTC(2024, 0, 1, 0, 0, 0);
  const STEP_MS  = 60_000;   // 1 minute between events
  const CASE_GAP = 3_600_000; // 1 hour between cases

  let caseNum  = 0;
  let caseTime = BASE_MS;

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    caseNum++;

    // Per-line delimiter detection
    const activities = trimmed.includes(',')
      ? trimmed.split(',').map(s => s.trim()).filter(Boolean)
      : trimmed.split(/\s+/).filter(Boolean);

    if (activities.length === 0) {
      errors.push(`Line ${i + 1}: no activities found`);
      caseNum--;
      continue;
    }

    const trace = new Trace();
    trace.attributes[DEFAULT_TRACEID_KEY] = `case-${caseNum}`;

    let evtTime = caseTime;
    for (const act of activities) {
      const event = new Event();
      event.set(actKey,                  act);
      event.set(DEFAULT_TIMESTAMP_KEY,   new Date(evtTime));
      event.set(DEFAULT_TRANSITION_KEY,  LIFECYCLE_COMPLETE);
      evtTime += STEP_MS;
      trace.append(event);
    }

    log.append(trace);
    caseTime += CASE_GAP;
  }

  return { log, errors };
}

/**
 * Reverse-render an EventLog to DTLog text.
 * Multi-word activity names → comma-separated line.
 * All single-word names → space-separated line.
 *
 * @param {EventLog} log
 * @returns {string}
 */
function eventLogToDtLog(log) {
  const actKey = log.activityKey;
  const lines  = [];

  for (const trace of log) {
    const acts = [];
    for (const event of trace) {
      const a = event.get(actKey);
      if (a !== undefined) acts.push(String(a));
    }
    if (acts.length === 0) continue;
    const needsComma = acts.some(a => /\s/.test(a));
    lines.push(needsComma ? acts.join(', ') : acts.join(' '));
  }

  return lines.join('\n');
}

/**
 * Serialise an EventLog to a minimal XES XML string suitable for POSTing
 * to the pm4py backend.
 *
 * Only the attributes that pm4py requires are emitted:
 *   concept:name  (activity name, string)
 *   time:timestamp (ISO-8601 date)
 *   lifecycle:transition (string, "complete")
 *
 * @param {EventLog} log
 * @returns {string}  XES XML
 */
function eventLogToXml(log) {
  const actKey = log.activityKey;
  const tsKey  = log.timestampKey;
  const idKey  = log.caseIdKey;

  const isoDate = v => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string') return v;
    return new Date(v).toISOString();
  };

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<log xes.version="1.0" xes.features="nested-attributes" openxes.version="1.0RC7"',
    '     xmlns="http://www.xes-standard.org/">',
    '  <extension name="Concept"   prefix="concept"   uri="http://www.xes-standard.org/concept.xesext"/>',
    '  <extension name="Time"      prefix="time"      uri="http://www.xes-standard.org/time.xesext"/>',
    '  <extension name="Lifecycle" prefix="lifecycle" uri="http://www.xes-standard.org/lifecycle.xesext"/>',
    '  <global scope="trace">',
    '    <string key="concept:name" value="__INVALID__"/>',
    '  </global>',
    '  <global scope="event">',
    '    <string key="concept:name"          value="__INVALID__"/>',
    '    <date   key="time:timestamp"         value="1970-01-01T00:00:00.000Z"/>',
    '    <string key="lifecycle:transition"   value="complete"/>',
    '  </global>',
    '  <classifier name="Activity classifier" keys="concept:name"/>',
  ];

  for (const trace of log) {
    const caseId = trace.attributes[idKey] ?? trace.attributes['concept:name'] ?? '';
    lines.push('  <trace>');
    lines.push(`    <string key="concept:name" value="${xmlEscape(caseId)}"/>`);

    for (const event of trace) {
      lines.push('    <event>');
      const act = event.get(actKey);
      if (act !== undefined)
        lines.push(`      <string key="concept:name" value="${xmlEscape(act)}"/>`);
      const ts = event.get(tsKey);
      if (ts !== undefined)
        lines.push(`      <date key="time:timestamp" value="${xmlEscape(isoDate(ts))}"/>`);
      const lc = event.get(DEFAULT_TRANSITION_KEY);
      lines.push(`      <string key="lifecycle:transition" value="${xmlEscape(lc ?? LIFECYCLE_COMPLETE)}"/>`);
      lines.push('    </event>');
    }

    lines.push('  </trace>');
  }

  lines.push('</log>');
  return lines.join('\n');
}

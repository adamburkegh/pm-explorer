/**
 * Tests for dtlog.js — parseDtLog, eventLogToDtLog, eventLogToXml.
 *
 * Reference: ref-projects/koalas-main/tests/test_dtlog.py (Python originals).
 * Comma-delimiter detection is new to this project and has no Python equivalent.
 *
 * Synthetic timestamp values used throughout:
 *   BASE_MS  = Date.UTC(2024, 0, 1, 0, 0, 0)  → 2024-01-01T00:00:00.000Z
 *   STEP_MS  = 60 000   (1 min between events)
 *   CASE_GAP = 3 600 000 (1 hour between cases)
 */

const BASE_MS  = Date.UTC(2024, 0, 1, 0, 0, 0);
const STEP_MS  = 60_000;
const CASE_GAP = 3_600_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract activity sequence from a Trace. */
function acts(trace) {
  const result = [];
  for (const e of trace) result.push(e.get(DEFAULT_NAME_KEY));
  return result;
}

/** Extract timestamps (as ms) from a Trace. */
function timestamps(trace) {
  const result = [];
  for (const e of trace) result.push(e.get(DEFAULT_TIMESTAMP_KEY).getTime());
  return result;
}

// ── parseDtLog — basic parsing ────────────────────────────────────────────────

describe('parseDtLog — empty and blank input', () => {
  it('empty string → empty log, no errors', () => {
    const { log, errors } = parseDtLog('');
    assert.equal(log.length, 0);
    assert.equal(errors.length, 0);
  });

  it('only blank lines → empty log', () => {
    const { log } = parseDtLog('\n\n   \n');
    assert.equal(log.length, 0);
  });

  it('only comments → empty log', () => {
    const { log } = parseDtLog('# header\n# another comment\n');
    assert.equal(log.length, 0);
  });

  it('comments and blanks mixed → empty log', () => {
    const { log } = parseDtLog('# comment\n\n# another\n');
    assert.equal(log.length, 0);
  });
});

describe('parseDtLog — single trace, space-separated', () => {
  it('single activity', () => {
    const { log } = parseDtLog('a');
    assert.equal(log.length, 1);
    assert.deepEqual(acts(log.at(0)), ['a']);
  });

  it('two activities', () => {
    const { log } = parseDtLog('a b');
    assert.deepEqual(acts(log.at(0)), ['a', 'b']);
  });

  it('three activities — mirrors Python test_convert_single_trace_multi_event', () => {
    const { log } = parseDtLog('jill alex thingy');
    assert.deepEqual(acts(log.at(0)), ['jill', 'alex', 'thingy']);
  });

  it('leading/trailing whitespace on the line is trimmed', () => {
    const { log } = parseDtLog('  a b c  ');
    assert.deepEqual(acts(log.at(0)), ['a', 'b', 'c']);
  });

  it('extra internal whitespace collapsed', () => {
    const { log } = parseDtLog('a  b\tc');
    assert.deepEqual(acts(log.at(0)), ['a', 'b', 'c']);
  });
});

describe('parseDtLog — multiple traces', () => {
  it('two traces — mirrors Python test_convert_single', () => {
    const { log } = parseDtLog('a b\na');
    assert.equal(log.length, 2);
    assert.deepEqual(acts(log.at(0)), ['a', 'b']);
    assert.deepEqual(acts(log.at(1)), ['a']);
  });

  it('three traces — mirrors Python test_convert_triple', () => {
    const { log } = parseDtLog('a b\na\na b');
    assert.equal(log.length, 3);
    assert.deepEqual(acts(log.at(0)), ['a', 'b']);
    assert.deepEqual(acts(log.at(1)), ['a']);
    assert.deepEqual(acts(log.at(2)), ['a', 'b']);
  });

  it('blank lines between traces are ignored', () => {
    const { log } = parseDtLog('a b\n\nc d\n');
    assert.equal(log.length, 2);
  });

  it('comment lines between traces are ignored', () => {
    const { log } = parseDtLog('a b\n# comment\nc d\n');
    assert.equal(log.length, 2);
  });
});

describe('parseDtLog — comma-separated (multi-word activity names)', () => {
  it('three multi-word activities', () => {
    const { log } = parseDtLog('register request, examine casually, decide');
    assert.equal(log.length, 1);
    assert.deepEqual(acts(log.at(0)), ['register request', 'examine casually', 'decide']);
  });

  it('single multi-word activity', () => {
    const { log } = parseDtLog('register request,');
    assert.deepEqual(acts(log.at(0)), ['register request']);
  });

  it('leading/trailing spaces around comma-items are trimmed', () => {
    const { log } = parseDtLog('  a  ,  b  ,  c  ');
    assert.deepEqual(acts(log.at(0)), ['a', 'b', 'c']);
  });

  it('comma-split used when line contains a comma — even for single-word names', () => {
    const { log } = parseDtLog('a, b, c');
    assert.deepEqual(acts(log.at(0)), ['a', 'b', 'c']);
  });

  it('mixed lines: comma for multi-word, space for simple', () => {
    const { log } = parseDtLog('register request, decide\na b c');
    assert.equal(log.length, 2);
    assert.deepEqual(acts(log.at(0)), ['register request', 'decide']);
    assert.deepEqual(acts(log.at(1)), ['a', 'b', 'c']);
  });
});

describe('parseDtLog — case IDs and event attributes', () => {
  it('case IDs are case-1, case-2, …', () => {
    const { log } = parseDtLog('a\nb\nc');
    assert.equal(log.at(0).attributes[DEFAULT_TRACEID_KEY], 'case-1');
    assert.equal(log.at(1).attributes[DEFAULT_TRACEID_KEY], 'case-2');
    assert.equal(log.at(2).attributes[DEFAULT_TRACEID_KEY], 'case-3');
  });

  it('comment lines do not advance case numbering', () => {
    const { log } = parseDtLog('a\n# comment\nb');
    assert.equal(log.at(0).attributes[DEFAULT_TRACEID_KEY], 'case-1');
    assert.equal(log.at(1).attributes[DEFAULT_TRACEID_KEY], 'case-2');
  });

  it('lifecycle:transition is "complete" on every event', () => {
    const { log } = parseDtLog('a b c');
    for (const e of log.at(0))
      assert.equal(e.get(DEFAULT_TRANSITION_KEY), LIFECYCLE_COMPLETE);
  });
});

describe('parseDtLog — synthetic timestamps', () => {
  it('first event of first trace starts at BASE_MS', () => {
    const { log } = parseDtLog('a b');
    assert.equal(timestamps(log.at(0))[0], BASE_MS);
  });

  it('events within a trace are 1 minute apart', () => {
    const { log } = parseDtLog('a b c');
    const ts = timestamps(log.at(0));
    assert.equal(ts[1] - ts[0], STEP_MS);
    assert.equal(ts[2] - ts[1], STEP_MS);
  });

  it('second trace starts 1 hour after first trace starts', () => {
    const { log } = parseDtLog('a b\nc d');
    assert.equal(timestamps(log.at(1))[0], BASE_MS + CASE_GAP);
  });

  it('timestamps are Date objects', () => {
    const { log } = parseDtLog('a');
    assert.instanceOf(log.at(0).at(0).get(DEFAULT_TIMESTAMP_KEY), Date);
  });
});

describe('parseDtLog — error handling', () => {
  it('line of only commas/whitespace → error reported, not counted as a case', () => {
    const { log, errors } = parseDtLog('a b\n,  ,\nc d');
    assert.equal(log.length, 2);
    assert.equal(errors.length, 1);
  });

  it('error message mentions the line number', () => {
    const { errors } = parseDtLog('\n,');
    assert.ok(errors[0].includes('2'));
  });

  it('valid traces before and after error line are parsed correctly', () => {
    const { log } = parseDtLog('a b\n,  ,\nc d');
    assert.deepEqual(acts(log.at(0)), ['a', 'b']);
    assert.deepEqual(acts(log.at(1)), ['c', 'd']);
  });

  it('returns errors array (may be empty) on clean input', () => {
    const { errors } = parseDtLog('a b c');
    assert.ok(Array.isArray(errors));
    assert.equal(errors.length, 0);
  });
});

describe('parseDtLog — line endings', () => {
  it('CRLF line endings handled', () => {
    const { log } = parseDtLog('a b\r\nc d\r\n');
    assert.equal(log.length, 2);
    assert.deepEqual(acts(log.at(0)), ['a', 'b']);
    assert.deepEqual(acts(log.at(1)), ['c', 'd']);
  });
});

// ── eventLogToDtLog ───────────────────────────────────────────────────────────

describe('eventLogToDtLog — space-separated output', () => {
  it('single-word activities produce space-separated line', () => {
    const { log } = parseDtLog('a b c');
    assert.equal(eventLogToDtLog(log), 'a b c');
  });

  it('multiple traces → one line each', () => {
    const { log } = parseDtLog('a b\nc d e');
    assert.equal(eventLogToDtLog(log), 'a b\nc d e');
  });
});

describe('eventLogToDtLog — comma-separated output', () => {
  it('multi-word activity names produce comma-separated line', () => {
    const { log } = parseDtLog('register request, examine casually, decide');
    assert.equal(eventLogToDtLog(log), 'register request, examine casually, decide');
  });

  it('one multi-word name in a trace triggers comma format for the whole line', () => {
    const { log } = parseDtLog('register request, decide');
    const line = eventLogToDtLog(log);
    assert.ok(line.includes(','));
  });

  it('mixed traces: each line independently uses comma or space', () => {
    const input = 'a b\nregister request, decide';
    const { log } = parseDtLog(input);
    const out = eventLogToDtLog(log).split('\n');
    assert.ok(!out[0].includes(','), 'first line should be space-separated');
    assert.ok(out[1].includes(','),  'second line should be comma-separated');
  });
});

describe('eventLogToDtLog — round-trip', () => {
  it('space-separated round-trip preserves activities', () => {
    const input = 'a b c\nd e\nf';
    const { log: log1 } = parseDtLog(input);
    const { log: log2 } = parseDtLog(eventLogToDtLog(log1));
    assert.equal(log2.length, log1.length);
    for (let i = 0; i < log1.length; i++)
      assert.deepEqual(acts(log2.at(i)), acts(log1.at(i)));
  });

  it('comma-separated round-trip preserves multi-word activities', () => {
    const input = 'register request, examine casually, decide';
    const { log: log1 } = parseDtLog(input);
    const { log: log2 } = parseDtLog(eventLogToDtLog(log1));
    assert.deepEqual(acts(log2.at(0)), acts(log1.at(0)));
  });

  it('empty log round-trips to empty string', () => {
    const { log } = parseDtLog('');
    assert.equal(eventLogToDtLog(log), '');
  });
});

describe('eventLogToDtLog — edge cases', () => {
  it('traces with no recognised activity key are omitted', () => {
    const log = new EventLog();
    const trace = new Trace();
    trace.append(new Event({ 'other:key': 'X' }));
    log.append(trace);
    assert.equal(eventLogToDtLog(log), '');
  });
});

// ── eventLogToXml ─────────────────────────────────────────────────────────────

describe('eventLogToXml — structure', () => {
  it('starts with XML declaration', () => {
    const { log } = parseDtLog('a');
    assert.ok(eventLogToXml(log).startsWith('<?xml'));
  });

  it('contains XES log element', () => {
    const xml = eventLogToXml(parseDtLog('a').log);
    assert.ok(xml.includes('<log '));
    assert.ok(xml.includes('</log>'));
  });

  it('empty log produces valid shell with no trace elements', () => {
    const xml = eventLogToXml(parseDtLog('').log);
    assert.ok(!xml.includes('<trace>'));
  });

  it('one trace per case', () => {
    const xml = eventLogToXml(parseDtLog('a b\nc d').log);
    assert.equal((xml.match(/<trace>/g) || []).length, 2);
  });

  it('one event element per activity', () => {
    const xml = eventLogToXml(parseDtLog('a b c').log);
    assert.equal((xml.match(/<event>/g) || []).length, 3);
  });

  it('activity name appears in concept:name string element', () => {
    const xml = eventLogToXml(parseDtLog('myactivity').log);
    assert.ok(xml.includes('value="myactivity"'));
  });

  it('case ID appears in trace concept:name', () => {
    const xml = eventLogToXml(parseDtLog('a').log);
    assert.ok(xml.includes('value="case-1"'));
  });

  it('timestamp appears as ISO-8601 date element', () => {
    const xml = eventLogToXml(parseDtLog('a').log);
    assert.ok(xml.includes('key="time:timestamp"'));
    assert.ok(xml.includes('2024-01-01T00:00:00.000Z'));
  });

  it('lifecycle:transition is "complete"', () => {
    const xml = eventLogToXml(parseDtLog('a').log);
    assert.ok(xml.includes('key="lifecycle:transition"'));
    assert.ok(xml.includes('value="complete"'));
  });
});

describe('eventLogToXml — XML escaping', () => {
  it('ampersand in activity name is escaped', () => {
    const { log } = parseDtLog('bread & butter,');
    assert.ok(eventLogToXml(log).includes('bread &amp; butter'));
  });

  it('less-than in activity name is escaped', () => {
    const { log } = parseDtLog('a < b,');
    assert.ok(eventLogToXml(log).includes('a &lt; b'));
  });

  it('quote in activity name is escaped', () => {
    const { log } = parseDtLog('"quoted",');
    assert.ok(eventLogToXml(log).includes('&quot;quoted&quot;'));
  });

  it('unescaped raw characters do not appear in output', () => {
    const { log } = parseDtLog('a & b < c,');
    const xml = eventLogToXml(log);
    // raw & and < should not appear outside the XML structure itself
    const valueContent = xml.match(/value="([^"]*)"/g) || [];
    for (const v of valueContent) {
      assert.ok(!v.includes(' & '),  'raw & in attribute value');
      assert.ok(!v.includes('<'),    'raw < in attribute value');
    }
  });
});

describe('eventLogToXml — round-trip via xesParser', () => {
  it('parsed-back log has same trace count', () => {
    const { log: original } = parseDtLog('a b c\nd e\nf');
    const xml     = eventLogToXml(original);
    const roundTrip = xesParser.parse(xml);
    assert.equal(roundTrip.length, original.length);
  });

  it('parsed-back log preserves activity sequences', () => {
    const { log: original } = parseDtLog('a b c\nd e');
    const roundTrip = xesParser.parse(eventLogToXml(original));
    for (let i = 0; i < original.length; i++)
      assert.deepEqual(acts(roundTrip.at(i)), acts(original.at(i)));
  });

  it('round-trip preserves multi-word activity names', () => {
    const { log: original } = parseDtLog('register request, examine casually, decide');
    const roundTrip = xesParser.parse(eventLogToXml(original));
    assert.deepEqual(acts(roundTrip.at(0)), ['register request', 'examine casually', 'decide']);
  });

  it('round-trip preserves special characters in activity names', () => {
    const { log: original } = parseDtLog('bread & butter, a < b,');
    const roundTrip = xesParser.parse(eventLogToXml(original));
    assert.deepEqual(acts(roundTrip.at(0)), ['bread & butter', 'a < b']);
  });
});

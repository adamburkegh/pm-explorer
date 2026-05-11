/**
 * XES standard attribute key constants and parameter key names.
 * Mirrors pm4py/util/xes_constants.py and pm4py/util/constants.py.
 */

// ── XES standard attribute keys ───────────────────────────────────────────────
const DEFAULT_NAME_KEY       = 'concept:name';
const DEFAULT_TIMESTAMP_KEY  = 'time:timestamp';
const DEFAULT_TRACEID_KEY    = 'concept:name';   // trace-level concept:name
const DEFAULT_TRANSITION_KEY = 'lifecycle:transition';

// ── Parameter keys (used in properties / options objects) ────────────────────
// Mirrors pm4py/util/constants.py PARAMETER_CONSTANT_* names.
const PARAM_ACTIVITY_KEY  = 'pm4py:param:activity_key';
const PARAM_TIMESTAMP_KEY = 'pm4py:param:timestamp_key';
const PARAM_CASEID_KEY    = 'pm4py:param:caseid_key';

// ── Default log properties (set on EventLog after import) ────────────────────
const DEFAULT_LOG_PROPERTIES = {
  [PARAM_ACTIVITY_KEY]:  DEFAULT_NAME_KEY,
  [PARAM_TIMESTAMP_KEY]: DEFAULT_TIMESTAMP_KEY,
  [PARAM_CASEID_KEY]:    DEFAULT_TRACEID_KEY,
};

// ── XES XML tag names ─────────────────────────────────────────────────────────
const TAG_LOG        = 'log';
const TAG_TRACE      = 'trace';
const TAG_EVENT      = 'event';
const TAG_EXTENSION  = 'extension';
const TAG_GLOBAL     = 'global';
const TAG_CLASSIFIER = 'classifier';
const TAG_STRING     = 'string';
const TAG_DATE       = 'date';
const TAG_INT        = 'int';
const TAG_FLOAT      = 'float';
const TAG_BOOLEAN    = 'boolean';
const TAG_ID         = 'id';
const TAG_LIST       = 'list';
const TAG_CONTAINER  = 'container';  // XES 2.0
const TAG_VALUES     = 'values';

// ── XES XML attribute names ───────────────────────────────────────────────────
const KEY_KEY   = 'key';
const KEY_VALUE = 'value';
const KEY_NAME  = 'name';
const KEY_KEYS  = 'keys';
const KEY_SCOPE = 'scope';
const KEY_PREFIX = 'prefix';
const KEY_URI   = 'uri';

// ── XES lifecycle values ──────────────────────────────────────────────────────
const LIFECYCLE_COMPLETE = 'complete';

// ── Separator used to encode (activity_a, activity_b) DFG edge keys ───────────
// Unit separator (U+001F) — safe for activity names in practice.
const DFG_EDGE_SEP = '\x1f';

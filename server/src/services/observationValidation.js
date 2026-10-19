/**
 * Per-observation validation. Pure function: no I/O, so it is unit-testable
 * and the same rules can be reused by the dataset importer (Phase 2).
 *
 * Validation here only rejects values that are malformed or physically
 * impossible. Poor-but-plausible data (e.g. 80 m accuracy, a sudden jump) is
 * stored and flagged later by the preprocessing pipeline, never dropped here.
 */

// Require an explicit UTC designator or offset so timestamps are never
// interpreted in the server's local timezone.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isMissing = (v) => v === undefined || v === null;

function reject(sequence, reason, detail = null) {
  return { ok: false, sequence, reason, detail };
}

/**
 * @param {unknown} raw   one element of the submitted batch
 * @param {object}  ctx   { session, now: Date, rules: config.collection }
 * @returns {{ok:true, value:object} | {ok:false, sequence:number|null, reason:string, detail:string|null}}
 */
export function validateObservation(raw, { session, now, rules }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return reject(null, 'invalid_schema', 'Observation must be an object');
  }
  const { sequence } = raw;
  if (!Number.isInteger(sequence) || sequence < 0) {
    return reject(null, 'invalid_schema', 'sequence must be a non-negative integer');
  }
  if (raw.sessionId !== undefined && raw.sessionId !== session.sessionId) {
    return reject(sequence, 'invalid_schema', 'sessionId does not match the URL');
  }

  const { latitude, longitude } = raw;
  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return reject(sequence, 'invalid_latitude', 'latitude must be a number in [-90, 90]');
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return reject(sequence, 'invalid_longitude', 'longitude must be a number in [-180, 180]');
  }
  // (0, 0) is a common "no fix" placeholder from faulty clients.
  if (latitude === 0 && longitude === 0) {
    return reject(sequence, 'invalid_latitude', '(0, 0) is treated as a missing fix');
  }

  if (typeof raw.timestamp !== 'string' || !ISO_WITH_ZONE.test(raw.timestamp)) {
    return reject(sequence, 'invalid_timestamp', 'timestamp must be ISO-8601 with a timezone, e.g. 2026-10-17T08:30:00Z');
  }
  const timestamp = new Date(raw.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    return reject(sequence, 'invalid_timestamp', 'timestamp is not a real date');
  }
  const skewMs = rules.clockSkewSeconds * 1000;
  if (timestamp.getTime() > now.getTime() + skewMs) {
    return reject(sequence, 'timestamp_in_future');
  }
  if (timestamp.getTime() < new Date(session.startedAt).getTime() - skewMs) {
    return reject(sequence, 'timestamp_before_session');
  }
  if (session.endedAt && timestamp.getTime() > new Date(session.endedAt).getTime() + skewMs) {
    return reject(sequence, 'timestamp_after_session');
  }

  const optional = {};
  for (const [field, reason, check] of [
    ['accuracy', 'invalid_accuracy', (v) => v >= 0 && v <= rules.maxAccuracyMeters],
    ['speed', 'invalid_speed', (v) => v >= 0 && v <= rules.maxSpeedMps],
    ['heading', 'invalid_heading', (v) => v >= 0 && v < 360],
  ]) {
    const v = raw[field];
    if (isMissing(v)) {
      optional[field] = null; // missing measurements are recorded as null, never guessed
    } else if (!isFiniteNumber(v) || !check(v)) {
      return reject(sequence, reason, `${field} is out of range`);
    } else {
      optional[field] = v;
    }
  }

  const bbox = rules.studyAreaBbox;
  if (
    bbox &&
    (longitude < bbox.minLon || longitude > bbox.maxLon || latitude < bbox.minLat || latitude > bbox.maxLat)
  ) {
    return reject(sequence, 'outside_study_area');
  }

  return {
    ok: true,
    value: { sessionId: session.sessionId, sequence, timestamp, latitude, longitude, ...optional },
  };
}

/** True when two observations with the same (sessionId, sequence) carry identical content. */
export function sameObservation(a, b) {
  return (
    new Date(a.timestamp).getTime() === new Date(b.timestamp).getTime() &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    (a.accuracy ?? null) === (b.accuracy ?? null) &&
    (a.speed ?? null) === (b.speed ?? null) &&
    (a.heading ?? null) === (b.heading ?? null)
  );
}

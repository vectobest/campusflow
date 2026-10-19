/**
 * Pure helpers for the GPS collector. No browser APIs here, so they are unit
 * tested directly (see core.test.js).
 */

// Browsers report fixes slightly early/late; allow a little slack so a 5 s
// interval does not turn into 10 s because a fix arrived at 4.97 s.
const INTERVAL_TOLERANCE_MS = 250

/** Should a fix taken at `fixMs` be recorded, given the last recorded fix time? */
export function shouldRecord(fixMs, lastRecordedMs, intervalSeconds) {
  if (!Number.isFinite(fixMs)) return false
  if (lastRecordedMs == null) return true
  // Identical or older timestamps are duplicates the browser re-delivered.
  if (fixMs <= lastRecordedMs) return false
  return fixMs - lastRecordedMs >= intervalSeconds * 1000 - INTERVAL_TOLERANCE_MS
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Map a GeolocationPosition to the API observation schema. Unavailable values become null. */
export function toObservation(position, sessionId, sequence) {
  const c = position.coords
  const speed = numOrNull(c.speed)
  let heading = numOrNull(c.heading)
  // Per the Geolocation spec heading is NaN when stationary; normalise 360 -> 0.
  if (heading !== null) heading = ((heading % 360) + 360) % 360
  return {
    sessionId,
    sequence,
    timestamp: new Date(position.timestamp).toISOString(),
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: numOrNull(c.accuracy),
    speed: speed !== null && speed < 0 ? null : speed,
    heading,
  }
}

/** Remove the sequences the server has acknowledged (accepted, duplicate, or rejected). */
export function removeAcknowledged(queue, sentSequences) {
  const sent = new Set(sentSequences)
  return queue.filter((o) => !sent.has(o.sequence))
}

/** Exponential backoff with jitter, capped. attempt starts at 0. */
export function backoffMs(attempt, { baseMs = 2000, maxMs = 60000, random = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.round(exp / 2 + random() * (exp / 2))
}

/** Errors worth retrying: lost connectivity, server trouble, rate limiting, timeouts. */
export function isRetryable(err) {
  if (!err) return false
  if (err.kind === 'network') return true
  return err.status >= 500 || err.status === 429 || err.status === 408
}

export function summariseRejections(rejected, into = {}) {
  const out = { ...into }
  for (const r of rejected) out[r.reason] = (out[r.reason] || 0) + 1
  return out
}

const EARTH_RADIUS_M = 6371008.8

export function haversineM(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/**
 * Distance to add for the live "walked" counter. Uses the same rules as the
 * analysis cleaning step: ignore fixes worse than maxAccuracyM and jumps
 * implying more than maxSpeedMps, so GPS noise does not inflate the number.
 */
export function stepDistance(prev, next, { maxAccuracyM = 50, maxSpeedMps = 12 } = {}) {
  if (!prev || !next) return 0
  if ((next.accuracy ?? 0) > maxAccuracyM) return 0
  const d = haversineM(prev.lat, prev.lon, next.lat, next.lon)
  const dt = (next.t - prev.t) / 1000
  if (dt <= 0 || d / dt > maxSpeedMps) return 0
  return d
}

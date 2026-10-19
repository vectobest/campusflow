import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sameObservation, validateObservation } from '../src/services/observationValidation.js';

const now = new Date('2026-10-17T10:00:00Z');
const session = { sessionId: 'ses_1', startedAt: new Date('2026-10-17T09:00:00Z'), endedAt: null };
const rules = { clockSkewSeconds: 300, maxAccuracyMeters: 10000, maxSpeedMps: 100, studyAreaBbox: null };
const ctx = { session, now, rules };
const base = { sequence: 3, timestamp: '2026-10-17T09:30:00Z', latitude: 21.25, longitude: 81.6, accuracy: 12.5, speed: 1.2, heading: 85 };
const check = (overrides, c = ctx) => validateObservation({ ...base, ...overrides }, c);

describe('validateObservation', () => {
  it('accepts a well-formed observation and preserves the original timestamp', () => {
    const r = check({});
    assert.equal(r.ok, true);
    assert.equal(r.value.timestamp.toISOString(), '2026-10-17T09:30:00.000Z');
    assert.equal(r.value.sessionId, 'ses_1');
  });

  it('accepts timestamps with an explicit offset', () => {
    const r = check({ timestamp: '2026-10-17T15:00:00+05:30' });
    assert.equal(r.ok, true);
    assert.equal(r.value.timestamp.toISOString(), '2026-10-17T09:30:00.000Z');
  });

  it('records missing optional measurements as null', () => {
    const r = validateObservation({ sequence: 0, timestamp: base.timestamp, latitude: 21.25, longitude: 81.6 }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual([r.value.accuracy, r.value.speed, r.value.heading], [null, null, null]);
  });

  it('keeps poor-but-plausible accuracy (flagging is a preprocessing concern)', () => {
    assert.equal(check({ accuracy: 250 }).ok, true);
  });

  const cases = [
    ['latitude above 90', { latitude: 90.0001 }, 'invalid_latitude'],
    ['latitude as string', { latitude: '21.25' }, 'invalid_latitude'],
    ['NaN latitude', { latitude: Number.NaN }, 'invalid_latitude'],
    ['longitude below -180', { longitude: -180.5 }, 'invalid_longitude'],
    ['(0, 0) null island', { latitude: 0, longitude: 0 }, 'invalid_latitude'],
    ['timestamp without timezone', { timestamp: '2026-10-17T09:30:00' }, 'invalid_timestamp'],
    ['epoch-number timestamp', { timestamp: 1760693400000 }, 'invalid_timestamp'],
    ['impossible calendar date', { timestamp: '2026-13-45T09:30:00Z' }, 'invalid_timestamp'],
    ['timestamp in the future', { timestamp: '2026-10-17T10:06:00Z' }, 'timestamp_in_future'],
    ['timestamp before session start', { timestamp: '2026-10-17T08:50:00Z' }, 'timestamp_before_session'],
    ['negative accuracy', { accuracy: -1 }, 'invalid_accuracy'],
    ['negative speed', { speed: -0.1 }, 'invalid_speed'],
    ['heading of 360', { heading: 360 }, 'invalid_heading'],
    ['negative sequence', { sequence: -1 }, 'invalid_schema'],
    ['fractional sequence', { sequence: 1.5 }, 'invalid_schema'],
    ['mismatched sessionId', { sessionId: 'ses_other' }, 'invalid_schema'],
  ];
  for (const [name, overrides, reason] of cases) {
    it(`rejects ${name}`, () => {
      const r = check(overrides);
      assert.equal(r.ok, false);
      assert.equal(r.reason, reason);
    });
  }

  it('rejects non-object input', () => {
    assert.equal(validateObservation(null, ctx).reason, 'invalid_schema');
    assert.equal(validateObservation([1, 2], ctx).reason, 'invalid_schema');
  });

  it('tolerates clock skew within the configured window', () => {
    assert.equal(check({ timestamp: '2026-10-17T10:04:00Z' }).ok, true);
    assert.equal(check({ timestamp: '2026-10-17T08:56:00Z' }).ok, true);
  });

  it('rejects timestamps after the session ended', () => {
    const ended = { ...ctx, session: { ...session, endedAt: new Date('2026-10-17T09:20:00Z') } };
    assert.equal(check({}, ended).reason, 'timestamp_after_session');
  });

  it('rejects observations outside a configured study area', () => {
    const bboxCtx = { ...ctx, rules: { ...rules, studyAreaBbox: { minLon: 81.5, minLat: 21.2, maxLon: 81.7, maxLat: 21.3 } } };
    assert.equal(check({}, bboxCtx).ok, true);
    assert.equal(check({ latitude: 21.4 }, bboxCtx).reason, 'outside_study_area');
  });
});

describe('sameObservation', () => {
  it('treats null and undefined optional fields as equal', () => {
    assert.equal(sameObservation({ ...base, speed: null }, { ...base, speed: undefined }), true);
  });
  it('detects differing coordinates', () => {
    assert.equal(sameObservation(base, { ...base, latitude: 21.2501 }), false);
  });
});

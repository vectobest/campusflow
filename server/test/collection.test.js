import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { GpsObservation } from '../src/models/GpsObservation.js';
import { Participant } from '../src/models/Participant.js';
import { RejectedObservation } from '../src/models/RejectedObservation.js';
import { User } from '../src/models/User.js';
import { api, clear, makeObservations, makeUser, setup, startSession, teardown } from './helpers.js';

const upload = (auth, sessionId, observations) =>
  api().post(`/api/v1/collection/sessions/${sessionId}/observations`).set(auth).send({ observations });

before(setup);
beforeEach(clear);
after(teardown);

describe('authentication', () => {
  it('rejects unauthenticated collection requests', async () => {
    const res = await api().post('/api/v1/collection/sessions').send({});
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
  });

  it('keeps account identity separate from the participant identifier', async () => {
    const u = await makeUser({ consent: false });
    assert.match(u.participantId, /^p_[0-9a-f-]{36}$/);
    const user = await User.findOne({ email: u.email });
    assert.ok(!u.participantId.includes(user._id.toString()));
    const me = await api().get('/api/v1/auth/me').set(u.auth);
    assert.equal(me.body.data.participant.internalUserId, undefined);
  });

  it('does not reveal whether an email exists on login failure', async () => {
    const u = await makeUser({ consent: false });
    const wrongPw = await api().post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-password-123' });
    const noUser = await api().post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'wrong-password-123' });
    assert.equal(wrongPw.status, 401);
    assert.deepEqual(wrongPw.body, noUser.body);
  });
});

describe('consent enforcement', () => {
  it('refuses to start a session without consent', async () => {
    const u = await makeUser({ consent: false });
    const res = await api().post('/api/v1/collection/sessions').set(u.auth).send({});
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'consent_required');
  });

  it('requires every consent statement to be affirmed', async () => {
    const u = await makeUser({ consent: false });
    const doc = (await api().get('/api/v1/consent/current')).body.data;
    const res = await api()
      .post('/api/v1/consent')
      .set(u.auth)
      .send({ version: doc.version, statementsAccepted: doc.statements.slice(0, 1) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'consent_incomplete');
  });

  it('rejects consent to an outdated version', async () => {
    const u = await makeUser({ consent: false });
    const res = await api().post('/api/v1/consent').set(u.auth).send({ version: '0.1', statementsAccepted: [] });
    assert.equal(res.status, 409);
  });

  it('withdrawal ends open sessions and blocks further uploads', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const w = await api().post('/api/v1/consent/withdraw').set(u.auth).send({});
    assert.equal(w.status, 200);
    assert.equal(w.body.data.participant.consentStatus, 'withdrawn');
    const mine = await api().get('/api/v1/collection/sessions/my').set(u.auth);
    assert.equal(mine.body.data[0].collectionStatus, 'COMPLETED');
    const up = await upload(u.auth, s.sessionId, makeObservations(1));
    assert.equal(up.status, 403);
    assert.equal((await api().post('/api/v1/collection/sessions').set(u.auth).send({})).status, 403);
  });

  it('withdrawal with deleteData removes all contributed observations', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    await upload(u.auth, s.sessionId, makeObservations(5));
    const w = await api().post('/api/v1/consent/withdraw').set(u.auth).send({ deleteData: true });
    assert.equal(w.body.data.deleted.observations, 5);
    assert.equal(await GpsObservation.countDocuments({ sessionId: s.sessionId }), 0);
  });
});

describe('sessions', () => {
  it('creates a session with the requested sampling interval and coarse device metadata only', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth, { samplingIntervalSeconds: 10, formFactor: 'mobile' });
    assert.match(s.sessionId, /^ses_/);
    assert.equal(s.samplingIntervalSeconds, 10);
    assert.equal(s.collectionStatus, 'ACTIVE');
    assert.equal(s.dataOrigin, 'collected');
    assert.deepEqual(s.deviceMetadata, { formFactor: 'mobile' });
  });

  it('rejects sampling intervals outside the configured range', async () => {
    const u = await makeUser();
    const res = await api().post('/api/v1/collection/sessions').set(u.auth).send({ samplingIntervalSeconds: 0.1 });
    assert.equal(res.status, 400);
  });

  it('allows only one open session per participant', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const res = await api().post('/api/v1/collection/sessions').set(u.auth).send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.details.session.sessionId, s.sessionId);
  });

  it('supports pause → resume → stop and records pause intervals', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const path = `/api/v1/collection/sessions/${s.sessionId}`;
    assert.equal((await api().patch(path).set(u.auth).send({ status: 'PAUSED' })).body.data.collectionStatus, 'PAUSED');
    // Retrying the same transition is a harmless no-op.
    assert.equal((await api().patch(path).set(u.auth).send({ status: 'PAUSED' })).status, 200);
    const resumed = await api().patch(path).set(u.auth).send({ status: 'ACTIVE' });
    assert.equal(resumed.body.data.pauses.length, 1);
    assert.ok(resumed.body.data.pauses[0].resumedAt);
    const done = await api().patch(path).set(u.auth).send({ status: 'COMPLETED' });
    assert.ok(done.body.data.endedAt);
    const reopen = await api().patch(path).set(u.auth).send({ status: 'ACTIVE' });
    assert.equal(reopen.status, 409);
    assert.equal(reopen.body.error.code, 'invalid_transition');
  });

  it('paginates the participant\'s own sessions', async () => {
    const u = await makeUser();
    for (let i = 0; i < 3; i++) {
      const s = await startSession(u.auth);
      await api().patch(`/api/v1/collection/sessions/${s.sessionId}`).set(u.auth).send({ status: 'COMPLETED' });
    }
    const res = await api().get('/api/v1/collection/sessions/my?page=2&limit=2').set(u.auth);
    assert.equal(res.body.data.length, 1);
    assert.deepEqual(res.body.meta, { page: 2, limit: 2, total: 3 });
  });
});

describe('observation ingestion', () => {
  it('accepts valid observations and updates session counts', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const res = await upload(u.auth, s.sessionId, makeObservations(10));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.accepted, 10);
    assert.equal(res.body.data.duplicates, 0);
    assert.deepEqual(res.body.data.rejected, []);
    assert.equal(res.body.data.totals.acceptedObservationCount, 10);
    assert.equal(await GpsObservation.countDocuments({ sessionId: s.sessionId }), 10);
  });

  it('stores missing optional fields as null', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const [obs] = makeObservations(1);
    delete obs.speed;
    obs.heading = null;
    await upload(u.auth, s.sessionId, [obs]);
    const stored = await GpsObservation.findOne({ sessionId: s.sessionId }).lean();
    assert.equal(stored.speed, null);
    assert.equal(stored.heading, null);
    assert.equal(stored.accuracy, 8.5);
  });

  it('rejects invalid coordinates with recorded reasons, without storing their coordinates', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const obs = makeObservations(4);
    obs[1].latitude = 95;
    obs[2].longitude = 'east';
    const res = await upload(u.auth, s.sessionId, obs);
    assert.equal(res.body.data.accepted, 2);
    assert.deepEqual(
      res.body.data.rejected.map((r) => [r.sequence, r.reason]),
      [[1, 'invalid_latitude'], [2, 'invalid_longitude']],
    );
    assert.equal(res.body.data.totals.rejectedObservationCount, 2);
    const logged = await RejectedObservation.find({ sessionId: s.sessionId }).lean();
    assert.equal(logged.length, 2);
    assert.ok(logged.every((r) => r.latitude === undefined && r.longitude === undefined));
  });

  it('is idempotent: a retried batch creates no duplicates and does not inflate counts', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const obs = makeObservations(6);
    obs[5].latitude = -100;
    await upload(u.auth, s.sessionId, obs);
    const retry = await upload(u.auth, s.sessionId, obs);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.accepted, 0);
    assert.equal(retry.body.data.duplicates, 5);
    assert.equal(retry.body.data.totals.acceptedObservationCount, 5);
    assert.equal(retry.body.data.totals.rejectedObservationCount, 1);
    assert.equal(retry.body.data.totals.duplicateSubmissionCount, 5);
    assert.equal(await GpsObservation.countDocuments({ sessionId: s.sessionId }), 5);
  });

  it('handles a batch that partially overlaps one already stored', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const base = Date.now() - 50_000;
    await upload(u.auth, s.sessionId, makeObservations(5, { base }));
    const res = await upload(u.auth, s.sessionId, makeObservations(5, { startSeq: 3, base }));
    assert.equal(res.body.data.accepted, 3);
    assert.equal(res.body.data.duplicates, 2);
    assert.equal(await GpsObservation.countDocuments({ sessionId: s.sessionId }), 8);
  });

  it('rejects a reused sequence with different content and keeps the original', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const [original] = makeObservations(1);
    await upload(u.auth, s.sessionId, [original]);
    const res = await upload(u.auth, s.sessionId, [{ ...original, latitude: original.latitude + 0.001 }]);
    assert.equal(res.body.data.rejected[0].reason, 'sequence_conflict');
    const stored = await GpsObservation.findOne({ sessionId: s.sessionId, sequence: 0 }).lean();
    assert.equal(stored.latitude, original.latitude);
  });

  it('detects duplicates inside a single batch', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const [a] = makeObservations(1);
    const res = await upload(u.auth, s.sessionId, [a, { ...a }, { ...a, longitude: a.longitude + 0.01 }]);
    assert.equal(res.body.data.accepted, 1);
    assert.equal(res.body.data.duplicates, 1);
    assert.equal(res.body.data.rejected[0].reason, 'duplicate_in_batch');
  });

  it('accepts out-of-order timestamps and preserves them as submitted', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const obs = makeObservations(3);
    [obs[0].timestamp, obs[2].timestamp] = [obs[2].timestamp, obs[0].timestamp];
    await upload(u.auth, s.sessionId, obs);
    const res = await api().get(`/api/v1/collection/sessions/${s.sessionId}/observations`).set(u.auth);
    assert.deepEqual(res.body.data.map((o) => o.sequence), [0, 1, 2]);
    assert.deepEqual(
      res.body.data.map((o) => o.timestamp),
      obs.map((o) => new Date(o.timestamp).toISOString()),
    );
  });

  it('accepts uploads while paused (queued data) but not after completion', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const path = `/api/v1/collection/sessions/${s.sessionId}`;
    await api().patch(path).set(u.auth).send({ status: 'PAUSED' });
    assert.equal((await upload(u.auth, s.sessionId, makeObservations(2))).status, 200);
    await api().patch(path).set(u.auth).send({ status: 'COMPLETED' });
    const res = await upload(u.auth, s.sessionId, makeObservations(2, { startSeq: 2 }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'session_closed');
  });

  it('rejects empty and oversized batches', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    assert.equal((await upload(u.auth, s.sessionId, [])).status, 400);
    assert.equal((await upload(u.auth, s.sessionId, makeObservations(501))).status, 400);
  });

  it('paginates a participant\'s own observations by sequence', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    await upload(u.auth, s.sessionId, makeObservations(7));
    const path = `/api/v1/collection/sessions/${s.sessionId}/observations`;
    const first = await api().get(`${path}?limit=4`).set(u.auth);
    assert.equal(first.body.meta.nextAfterSequence, 3);
    const second = await api().get(`${path}?limit=4&afterSequence=3`).set(u.auth);
    assert.deepEqual(second.body.data.map((o) => o.sequence), [4, 5, 6]);
    assert.equal(second.body.meta.nextAfterSequence, null);
  });
});

describe('session ownership', () => {
  it('hides other participants\' sessions behind 404 for every operation', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const s = await startSession(owner.auth);
    await upload(owner.auth, s.sessionId, makeObservations(3));
    const path = `/api/v1/collection/sessions/${s.sessionId}`;
    assert.equal((await api().get(path).set(other.auth)).status, 404);
    assert.equal((await api().get(`${path}/observations`).set(other.auth)).status, 404);
    assert.equal((await upload(other.auth, s.sessionId, makeObservations(1, { startSeq: 10 }))).status, 404);
    assert.equal((await api().patch(path).set(other.auth).send({ status: 'COMPLETED' })).status, 404);
    assert.equal((await api().delete(path).set(other.auth)).status, 404);
    assert.equal(await GpsObservation.countDocuments({ sessionId: s.sessionId }), 3);
  });

  it('does not give researchers access to raw participant traces', async () => {
    const owner = await makeUser();
    const researcher = await makeUser({ role: 'researcher' });
    const s = await startSession(owner.auth);
    await upload(owner.auth, s.sessionId, makeObservations(3));
    const res = await api().get(`/api/v1/collection/sessions/${s.sessionId}/observations`).set(researcher.auth);
    assert.equal(res.status, 404);
  });
});

describe('data deletion', () => {
  it('deletes a single session and its observations', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    const obs = makeObservations(4);
    obs[0].latitude = 999;
    await upload(u.auth, s.sessionId, obs);
    const res = await api().delete(`/api/v1/collection/sessions/${s.sessionId}`).set(u.auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.deleted.observations, 3);
    assert.equal(await GpsObservation.countDocuments({ sessionId: s.sessionId }), 0);
    assert.equal(await RejectedObservation.countDocuments({ sessionId: s.sessionId }), 0);
    assert.equal((await api().get(`/api/v1/collection/sessions/${s.sessionId}`).set(u.auth)).status, 404);
  });

  it('deletes all of a participant\'s sessions but leaves other participants untouched', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const s1 = await startSession(u.auth);
    await upload(u.auth, s1.sessionId, makeObservations(2));
    await api().patch(`/api/v1/collection/sessions/${s1.sessionId}`).set(u.auth).send({ status: 'COMPLETED' });
    const s2 = await startSession(u.auth);
    await upload(u.auth, s2.sessionId, makeObservations(3));
    const so = await startSession(other.auth);
    await upload(other.auth, so.sessionId, makeObservations(4));

    const res = await api().delete('/api/v1/collection/sessions/my').set(u.auth);
    assert.deepEqual([res.body.data.deleted.sessions, res.body.data.deleted.observations], [2, 5]);
    assert.equal(await GpsObservation.countDocuments({}), 4);
  });

  it('account deletion removes the user, participant, and all data', async () => {
    const u = await makeUser();
    const s = await startSession(u.auth);
    await upload(u.auth, s.sessionId, makeObservations(3));
    const res = await api().delete('/api/v1/auth/me').set(u.auth);
    assert.equal(res.status, 200);
    assert.equal(await User.countDocuments({ email: u.email }), 0);
    assert.equal(await Participant.countDocuments({ participantId: u.participantId }), 0);
    assert.equal(await GpsObservation.countDocuments({}), 0);
    assert.equal((await api().get('/api/v1/auth/me').set(u.auth)).status, 401);
  });
});

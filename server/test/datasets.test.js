import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { AuditLog } from '../src/models/AuditLog.js';
import { CollectionSession } from '../src/models/CollectionSession.js';
import { GpsObservation } from '../src/models/GpsObservation.js';
import { runRetention } from '../src/services/retention.js';
import { api, clear, makeObservations, makeUser, setup, startSession, teardown } from './helpers.js';

before(setup);
beforeEach(clear);
after(teardown);

async function completedSession(user, n = 3) {
  const s = await startSession(user.auth);
  await api().post(`/api/v1/collection/sessions/${s.sessionId}/observations`).set(user.auth).send({ observations: makeObservations(n) });
  await api().patch(`/api/v1/collection/sessions/${s.sessionId}`).set(user.auth).send({ status: 'COMPLETED' });
  return s;
}

describe('dataset access control', () => {
  it('forbids participants from listing datasets', async () => {
    const u = await makeUser();
    const res = await api().get('/api/v1/datasets').set(u.auth);
    assert.equal(res.status, 403);
  });

  it('gives researchers aggregate summaries without participant identifiers', async () => {
    const p1 = await makeUser();
    const p2 = await makeUser();
    await completedSession(p1, 3);
    await completedSession(p2, 4);
    const r = await makeUser({ role: 'researcher' });
    const res = await api().get('/api/v1/datasets').set(r.auth);
    assert.equal(res.status, 200);
    const [ds] = res.body.data;
    assert.equal(ds.datasetId, 'nitrr-campus-collected');
    assert.equal(ds.dataOrigin, 'collected');
    assert.deepEqual([ds.sessionCount, ds.observationCount, ds.participantCount], [2, 7, 2]);
    assert.ok(!JSON.stringify(res.body).includes(p1.participantId));
  });
});

describe('dataset versioning', () => {
  it('freezes completed sessions only, and does not duplicate an unchanged version', async () => {
    const p = await makeUser();
    await completedSession(p, 3);
    await startSession(p.auth); // still ACTIVE: must be excluded
    const r = await makeUser({ role: 'researcher' });
    const path = '/api/v1/datasets/nitrr-campus-collected/versions';

    const v1 = await api().post(path).set(r.auth).send({ description: 'pilot' });
    assert.equal(v1.status, 201);
    assert.deepEqual([v1.body.data.version, v1.body.data.sessionCount, v1.body.data.observationCount], [1, 1, 3]);
    assert.match(v1.body.data.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(v1.body.data.sessionIds, undefined);

    const again = await api().post(path).set(r.auth).send({});
    assert.equal(again.status, 200);
    assert.equal(again.body.meta.created, false);
    assert.equal(again.body.data.version, 1);
    assert.equal(await AuditLog.countDocuments({ action: 'dataset.version' }), 1);
  });

  it('creates a new version when data changes, and invalidates versions whose data was deleted', async () => {
    const p = await makeUser();
    const s = await completedSession(p, 3);
    const r = await makeUser({ role: 'researcher' });
    const path = '/api/v1/datasets/nitrr-campus-collected/versions';
    await api().post(path).set(r.auth).send({});
    await completedSession(await makeUser(), 2);
    const v2 = await api().post(path).set(r.auth).send({});
    assert.equal(v2.body.data.version, 2);

    await api().delete(`/api/v1/collection/sessions/${s.sessionId}`).set(p.auth);
    const detail = await api().get('/api/v1/datasets/nitrr-campus-collected').set(r.auth);
    assert.ok(detail.body.data.versions.every((v) => v.invalidationReason === 'participant_request'));
  });

  it('refuses to version a dataset that mixes data origins', async () => {
    const p = await makeUser();
    await completedSession(p, 2);
    await CollectionSession.create({
      sessionId: 'syn_mixed',
      participantId: 'syn_p',
      datasetId: 'nitrr-campus-collected',
      dataOrigin: 'synthetic',
      startedAt: new Date(),
      collectionStatus: 'COMPLETED',
      samplingIntervalSeconds: 5,
    });
    const r = await makeUser({ role: 'researcher' });
    const res = await api().post('/api/v1/datasets/nitrr-campus-collected/versions').set(r.auth).send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'mixed_origins');
  });

  it('returns 404 for a dataset with no completed sessions', async () => {
    const r = await makeUser({ role: 'researcher' });
    const res = await api().post('/api/v1/datasets/empty/versions').set(r.auth).send({});
    assert.equal(res.status, 404);
  });
});

describe('retention', () => {
  it('purges sessions older than the retention period and abandons stale open sessions', async () => {
    const p = await makeUser();
    const old = await completedSession(p, 3);
    const stale = await startSession((await makeUser()).auth);
    const fresh = await completedSession(await makeUser(), 2);
    const longAgo = new Date(Date.now() - 400 * 86400 * 1000);
    await CollectionSession.collection.updateOne({ sessionId: old.sessionId }, { $set: { startedAt: longAgo } });
    await CollectionSession.collection.updateOne(
      { sessionId: stale.sessionId },
      { $set: { updatedAt: new Date(Date.now() - 48 * 3600 * 1000) } },
    );

    const result = await runRetention({ retentionDays: 365 });
    assert.equal(result.sessions, 1);
    assert.equal(result.observations, 3);
    assert.equal(result.abandoned, 1);
    assert.equal(await GpsObservation.countDocuments({ sessionId: old.sessionId }), 0);
    assert.equal(await GpsObservation.countDocuments({ sessionId: fresh.sessionId }), 2);
    const abandoned = await CollectionSession.findOne({ sessionId: stale.sessionId });
    assert.equal(abandoned.collectionStatus, 'ABANDONED');
    assert.ok(abandoned.endedAt);
    assert.equal(await AuditLog.countDocuments({ action: 'retention.run' }), 1);
  });

  it('does nothing when retention is disabled', async () => {
    const p = await makeUser();
    const s = await completedSession(p, 1);
    await CollectionSession.collection.updateOne({ sessionId: s.sessionId }, { $set: { startedAt: new Date(0) } });
    const result = await runRetention({ retentionDays: 0 });
    assert.equal(result.sessions, 0);
  });
});

describe('public stats', () => {
  it('counts only finished collected sessions and hides small participant counts', async () => {
    const p1 = await makeUser();
    await completedSession(p1, 3);
    await startSession((await makeUser()).auth); // still active: not counted
    await CollectionSession.create({
      sessionId: 'syn_x', participantId: 'syn', datasetId: 'synthetic-dev', dataOrigin: 'synthetic',
      startedAt: new Date(), collectionStatus: 'COMPLETED', samplingIntervalSeconds: 5, acceptedObservationCount: 999,
    });
    let res = await api().get('/api/v1/stats/public');
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.data.sessions, res.body.data.observations, res.body.data.participants], [1, 3, null]);

    await completedSession(await makeUser(), 2);
    await completedSession(await makeUser(), 2);
    res = await api().get('/api/v1/stats/public');
    assert.equal(res.body.data.participants, 3);
    assert.equal(res.body.data.sessions, 3);
  });
});

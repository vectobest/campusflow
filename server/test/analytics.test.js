import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { api, clear, makeUser, setup, teardown } from './helpers.js';

before(setup);
beforeEach(async () => {
  await clear();
  await mongoose.connection.db.collection('analyticsresults').deleteMany({});
});
after(teardown);

const results = () => mongoose.connection.db.collection('analyticsresults');

describe('analytics results', () => {
  it('is restricted to researchers', async () => {
    const p = await makeUser();
    assert.equal((await api().get('/api/v1/analytics/results').set(p.auth)).status, 403);
    assert.equal((await api().get('/api/v1/analytics/results')).status, 401);
  });

  it('returns 404 before any analysis has run', async () => {
    const r = await makeUser({ role: 'researcher' });
    const res = await api().get('/api/v1/analytics/results/none').set(r.auth);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'no_results');
  });

  it('lists datasets and returns the latest run', async () => {
    await results().insertMany([
      { datasetId: 'synthetic-dev', dataOrigin: 'synthetic', generatedAt: '2026-10-17T10:00:00Z', summary: { trips: 1 } },
      { datasetId: 'synthetic-dev', dataOrigin: 'synthetic', generatedAt: '2026-10-17T11:00:00Z', summary: { trips: 2 } },
    ]);
    const r = await makeUser({ role: 'researcher' });
    const list = await api().get('/api/v1/analytics/results').set(r.auth);
    assert.deepEqual(list.body.data.map((d) => [d.datasetId, d.runs, d.dataOrigin]), [['synthetic-dev', 2, 'synthetic']]);
    const latest = await api().get('/api/v1/analytics/results/synthetic-dev').set(r.auth);
    assert.equal(latest.body.data.summary.trips, 2);
    assert.equal(latest.body.data._id, undefined);
  });
});

import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getConsentDocument } from '../src/consent/documents.js';
import { config } from '../src/config.js';
import { connectDb } from '../src/db.js';
import '../src/models/index.js';
import { User } from '../src/models/User.js';

if (config.nodeEnv !== 'test' || !config.mongoUri.includes('test')) {
  throw new Error('Tests must run with NODE_ENV=test against a *test* database (use `npm test`).');
}

export const app = createApp();
export const api = () => request(app);

export async function setup() {
  await connectDb();
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function clear() {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
}

export const teardown = () => mongoose.disconnect();

let counter = 0;

/** Register a new account; optionally grant consent and set a role. Returns { token, participantId, auth }. */
export async function makeUser({ consent = true, role = null } = {}) {
  counter += 1;
  const email = `user${counter}_${Date.now()}@example.test`;
  const res = await api().post('/api/v1/auth/register').send({ email, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const { token } = res.body.data;
  const auth = { Authorization: `Bearer ${token}` };
  if (role) await User.updateOne({ email }, { role });
  if (consent) {
    const doc = getConsentDocument(config.consent.currentVersion);
    const c = await api().post('/api/v1/consent').set(auth).send({ version: doc.version, statementsAccepted: doc.statements });
    if (c.status !== 200) throw new Error(`consent failed: ${c.status}`);
  }
  return { email, token, auth, participantId: res.body.data.participant.participantId };
}

export async function startSession(auth, body = { samplingIntervalSeconds: 5, formFactor: 'mobile' }) {
  const res = await api().post('/api/v1/collection/sessions').set(auth).send(body);
  if (res.status !== 201) throw new Error(`session create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** n observations, 5 s apart, starting `startOffsetS` seconds after now - 1 minute. */
export function makeObservations(n, { startSeq = 0, base = Date.now() - 60_000 + 1000 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    sequence: startSeq + i,
    timestamp: new Date(base + (startSeq + i) * 5000).toISOString(),
    latitude: 21.25 + (startSeq + i) * 1e-5,
    longitude: 81.6 + (startSeq + i) * 1e-5,
    accuracy: 8.5,
    speed: 1.2,
    heading: 90,
  }));
}

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { Participant } from '../src/models/Participant.js';
import { User } from '../src/models/User.js';
import { api, clear, setup, teardown } from './helpers.js';

// Fake Google verifier: the "credential" is a key into this table.
const TOKENS = {
  'token-alice-xxxxxxxxxxxx': { sub: 'g-alice', email: 'Alice@nitrr.ac.in', emailVerified: true, hostedDomain: 'nitrr.ac.in' },
  'token-bob-xxxxxxxxxxxxxx': { sub: 'g-bob', email: 'bob@gmail.com', emailVerified: true, hostedDomain: null },
  'token-unverified-xxxxxxx': { sub: 'g-u', email: 'u@gmail.com', emailVerified: false, hostedDomain: null },
};
const app = createApp({
  googleVerifier: async (credential) => {
    if (!TOKENS[credential]) throw new Error('bad signature');
    return TOKENS[credential];
  },
});
const google = (credential) => request(app).post('/api/v1/auth/google').send({ credential });
const original = { ...config.google };

before(setup);
beforeEach(clear);
afterEach(() => Object.assign(config.google, original));
after(teardown);

describe('Sign in with Google', () => {
  it('exposes the public client ID for the web app', async () => {
    const res = await request(app).get('/api/v1/config/auth');
    assert.equal(res.body.data.googleClientId, config.google.clientId);
  });

  it('creates an account and participant on first sign-in, then signs in to the same one', async () => {
    const first = await google('token-alice-xxxxxxxxxxxx');
    assert.equal(first.status, 201);
    assert.equal(first.body.data.user.email, 'alice@nitrr.ac.in');
    assert.deepEqual(first.body.data.user.signInMethods, { password: false, google: true });
    assert.match(first.body.data.participant.participantId, /^p_/);

    const again = await google('token-alice-xxxxxxxxxxxx');
    assert.equal(again.status, 200);
    assert.equal(again.body.data.user.id, first.body.data.user.id);
    assert.equal(await User.countDocuments(), 1);
    assert.equal(await Participant.countDocuments(), 1);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${again.body.data.token}`);
    assert.equal(me.status, 200);
  });

  it('links Google to an existing password account with the same verified email', async () => {
    const reg = await api().post('/api/v1/auth/register').send({ email: 'bob@gmail.com', password: 'bob-password-123' });
    const res = await google('token-bob-xxxxxxxxxxxxxx');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.id, reg.body.data.user.id);
    assert.deepEqual(res.body.data.user.signInMethods, { password: true, google: true });
    assert.equal(res.body.data.participant.participantId, reg.body.data.participant.participantId);
    // The password still works after linking.
    assert.equal((await api().post('/api/v1/auth/login').send({ email: 'bob@gmail.com', password: 'bob-password-123' })).status, 200);
  });

  it('does not allow password login for a Google-only account', async () => {
    await google('token-alice-xxxxxxxxxxxx');
    const res = await api().post('/api/v1/auth/login').send({ email: 'alice@nitrr.ac.in', password: 'anything-at-all' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_credentials');
  });

  it('rejects tokens that fail verification and unverified emails', async () => {
    assert.equal((await google('forged-token-xxxxxxxxxxxx')).body.error.code, 'invalid_google_token');
    const unverified = await google('token-unverified-xxxxxxx');
    assert.equal(unverified.status, 401);
    assert.equal(unverified.body.error.code, 'google_email_unverified');
    assert.equal(await User.countDocuments(), 0);
  });

  it('enforces the allowed Google Workspace domains when configured', async () => {
    config.google.allowedDomains = ['nitrr.ac.in'];
    assert.equal((await google('token-alice-xxxxxxxxxxxx')).status, 201);
    const outsider = await google('token-bob-xxxxxxxxxxxxxx');
    assert.equal(outsider.status, 403);
    assert.equal(outsider.body.error.code, 'google_domain_not_allowed');
  });

  it('returns 503 when Google sign-in is not configured', async () => {
    config.google.clientId = null;
    const res = await google('token-alice-xxxxxxxxxxxx');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'google_not_configured');
  });

  it('rejects malformed requests', async () => {
    assert.equal((await request(app).post('/api/v1/auth/google').send({})).status, 400);
  });
});

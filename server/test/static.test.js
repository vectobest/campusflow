import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('serving the built web app', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const app = createApp({ clientDist: dir });

  it('serves index.html for client-side routes, uncached', async () => {
    for (const p of ['/', '/analytics', '/my-data']) {
      const res = await request(app).get(p);
      assert.equal(res.status, 200);
      assert.match(res.text, /id="root"/);
      assert.equal(res.headers['cache-control'], 'no-cache');
    }
  });

  it('serves hashed assets with long-lived caching', async () => {
    const res = await request(app).get('/assets/app-abc123.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /immutable/);
  });

  it('keeps unknown API routes as JSON 404s', async () => {
    const res = await request(app).get('/api/v1/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });

  it('sends a restrictive Content-Security-Policy', async () => {
    const csp = (await request(app).get('/')).headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /basemaps\.cartocdn\.com/);
    assert.match(csp, /frame-ancestors 'none'/);
  });
});

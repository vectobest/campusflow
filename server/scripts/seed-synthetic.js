#!/usr/bin/env node
/**
 * Deterministic SYNTHETIC development dataset.
 *
 *   npm run seed -- [--participants 8] [--sessions 6] [--seed 42] [--csv]
 *
 * Everything written here is fabricated for software development and testing:
 *   - sessions are stored under datasetId "synthetic-dev" with dataOrigin "synthetic";
 *   - participant IDs are prefixed "syn_";
 *   - the anchor places are fictional ("SYN_PLACE_*") metre offsets from an
 *     arbitrary origin (SYNTHETIC_ORIGIN, default = the illustrative example
 *     coordinate from the project brief). They are NOT NIT Raipur buildings.
 * Results computed from this dataset must never be reported as campus findings.
 *
 * Generated traces deliberately include realistic defects (GPS drift, poor
 * accuracy fixes, missing optional fields, signal gaps, occasional jumps and
 * invalid fixes) so the preprocessing pipeline has something to catch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import { CollectionSession } from '../src/models/CollectionSession.js';
import '../src/models/index.js';
import { deleteSessions } from '../src/services/deletion.js';
import { ingestBatch } from '../src/services/ingest.js';
import { config } from '../src/config.js';

export const SYNTHETIC_DATASET_ID = 'synthetic-dev';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

// mulberry32: small, fast, deterministic PRNG.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [ORIGIN_LAT, ORIGIN_LON] = (process.env.SYNTHETIC_ORIGIN || '21.2500,81.6050').split(',').map(Number);
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);
const toLatLon = (x, y) => [ORIGIN_LAT + y / M_PER_DEG_LAT, ORIGIN_LON + x / M_PER_DEG_LON];

// Fictional places, as (x, y) metre offsets from the origin.
export const SYNTHETIC_PLACES = [
  { placeId: 'SYN_PLACE_A', category: 'synthetic_residential', x: -450, y: 380 },
  { placeId: 'SYN_PLACE_B', category: 'synthetic_residential', x: -520, y: -150 },
  { placeId: 'SYN_PLACE_C', category: 'synthetic_academic', x: 120, y: 60 },
  { placeId: 'SYN_PLACE_D', category: 'synthetic_academic', x: 330, y: 240 },
  { placeId: 'SYN_PLACE_E', category: 'synthetic_library', x: 260, y: -120 },
  { placeId: 'SYN_PLACE_F', category: 'synthetic_food', x: -60, y: -260 },
  { placeId: 'SYN_PLACE_G', category: 'synthetic_sports', x: 520, y: -380 },
];
const byId = Object.fromEntries(SYNTHETIC_PLACES.map((p) => [p.placeId, p]));

// Itinerary templates so sequence mining has recurring structure to find.
const ITINERARIES = [
  ['SYN_PLACE_A', 'SYN_PLACE_C', 'SYN_PLACE_F'],
  ['SYN_PLACE_A', 'SYN_PLACE_C', 'SYN_PLACE_E', 'SYN_PLACE_A'],
  ['SYN_PLACE_B', 'SYN_PLACE_D', 'SYN_PLACE_F', 'SYN_PLACE_B'],
  ['SYN_PLACE_B', 'SYN_PLACE_C', 'SYN_PLACE_E'],
  ['SYN_PLACE_A', 'SYN_PLACE_G', 'SYN_PLACE_A'],
  ['SYN_PLACE_F', 'SYN_PLACE_E', 'SYN_PLACE_D'],
];

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export function generateSession(rand, { startUtcMs, itinerary, intervalS }) {
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  const points = [];
  let t = startUtcMs;
  let seq = 0;
  const emit = (x, y, speed, heading) => {
    const r = rand();
    let accuracy = Math.round((4 + rand() * 12) * 10) / 10;
    let nx = x + gauss() * accuracy * 0.5;
    let ny = y + gauss() * accuracy * 0.5;
    if (r < 0.03) accuracy = Math.round((60 + rand() * 120) * 10) / 10; // poor fix
    if (r > 0.995) { nx += 400 + rand() * 300; ny -= 300; } // spurious jump
    const [lat, lon] = toLatLon(nx, ny);
    const obs = {
      sequence: seq++,
      timestamp: new Date(t).toISOString(),
      latitude: Math.round(lat * 1e7) / 1e7,
      longitude: Math.round(lon * 1e7) / 1e7,
      accuracy: rand() < 0.02 ? null : accuracy,
      speed: rand() < 0.3 ? null : Math.max(0, Math.round((speed + gauss() * 0.2) * 100) / 100),
      heading: speed < 0.3 || rand() < 0.3 ? null : Math.round((heading + 360) % 360),
    };
    if (rand() < 0.002) obs.latitude = 123.4; // invalid fix that ingestion must reject
    points.push(obs);
    // Sampling jitter plus occasional signal loss.
    t += intervalS * 1000 + Math.round(gauss() * 400) + (rand() < 0.01 ? 60_000 + rand() * 240_000 : 0);
  };

  for (let i = 0; i < itinerary.length; i++) {
    const place = byId[itinerary[i]];
    const dwellS = 300 + rand() * 1800;
    const end = t + dwellS * 1000;
    while (t < end) emit(place.x + gauss() * 4, place.y + gauss() * 4, 0, 0);
    const next = byId[itinerary[i + 1]];
    if (!next) break;
    // Walk via a waypoint so routes are not perfectly straight.
    const legs = [[place, { x: (place.x + next.x) / 2 + gauss() * 40, y: (place.y + next.y) / 2 + gauss() * 40 }], [null, next]];
    let from = place;
    for (const [, to] of legs) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy);
      const speed = 1.1 + rand() * 0.5;
      const heading = (Math.atan2(dx, dy) * 180) / Math.PI;
      const legStart = t;
      while ((t - legStart) / 1000 * speed < dist) {
        const f = ((t - legStart) / 1000 * speed) / dist;
        emit(from.x + dx * f, from.y + dy * f, speed, heading);
      }
      from = to;
    }
  }
  return points;
}

async function main() {
  const participants = Number(arg('participants', 8));
  const sessionsPer = Number(arg('sessions', 6));
  const seed = Number(arg('seed', 42));
  const rand = prng(seed);

  await connectDb();
  const old = await CollectionSession.find({ datasetId: SYNTHETIC_DATASET_ID }, { sessionId: 1 }).lean();
  await deleteSessions(old.map((s) => s.sessionId), 'synthetic_reseed');

  const dayMs = 86400 * 1000;
  const todayIst = Math.floor((Date.now() + IST_OFFSET_MS) / dayMs) * dayMs;
  const csvRows = [];
  let accepted = 0;
  let rejected = 0;

  for (let p = 0; p < participants; p++) {
    const participantId = `syn_p_${String(p + 1).padStart(2, '0')}`;
    for (let s = 0; s < sessionsPer; s++) {
      const dayOffset = 1 + Math.floor(rand() * 21);
      const hourIst = 7 + Math.floor(rand() * 13);
      const startUtcMs = todayIst - dayOffset * dayMs + hourIst * 3600 * 1000 + Math.floor(rand() * 3600) * 1000 - IST_OFFSET_MS;
      const intervalS = [5, 5, 10][Math.floor(rand() * 3)];
      const itinerary = ITINERARIES[Math.floor(rand() * ITINERARIES.length)];
      const points = generateSession(rand, { startUtcMs, itinerary, intervalS });
      const sessionId = `syn_ses_${seed}_${p + 1}_${s + 1}`;
      const session = await CollectionSession.create({
        sessionId,
        participantId,
        datasetId: SYNTHETIC_DATASET_ID,
        dataOrigin: 'synthetic',
        startedAt: new Date(startUtcMs),
        samplingIntervalSeconds: intervalS,
        deviceMetadata: { formFactor: 'mobile' },
      });
      for (let i = 0; i < points.length; i += config.collection.maxBatchSize) {
        const r = await ingestBatch(session, points.slice(i, i + config.collection.maxBatchSize));
        accepted += r.accepted;
        rejected += r.rejected.length;
      }
      session.collectionStatus = 'COMPLETED';
      session.endedAt = new Date(points[points.length - 1].timestamp);
      await session.save();
      for (const pt of points) csvRows.push({ participantId, sessionId, ...pt });
    }
  }

  console.log(`SYNTHETIC dataset "${SYNTHETIC_DATASET_ID}": ${participants * sessionsPer} sessions, ${accepted} accepted, ${rejected} rejected observations (seed ${seed}).`);

  if (arg('csv', false)) {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/synthetic');
    fs.mkdirSync(dir, { recursive: true });
    const cols = ['participantId', 'sessionId', 'sequence', 'timestamp', 'latitude', 'longitude', 'accuracy', 'speed', 'heading'];
    const csv = [cols.join(','), ...csvRows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n');
    fs.writeFileSync(path.join(dir, 'synthetic_observations.csv'), `${csv}\n`);
    const geojson = {
      type: 'FeatureCollection',
      name: 'SYNTHETIC places — fictional, not campus buildings',
      features: SYNTHETIC_PLACES.map((pl) => {
        const [lat, lon] = toLatLon(pl.x, pl.y);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { placeId: pl.placeId, name: pl.placeId, category: pl.category, radiusMeters: 40, dataSource: 'synthetic generator', verificationStatus: 'synthetic' },
        };
      }),
    };
    fs.writeFileSync(path.join(dir, 'synthetic_places.geojson'), `${JSON.stringify(geojson, null, 2)}\n`);
    console.log(`Wrote raw rows (including rejected ones) to ${dir}`);
  }
  await mongoose.disconnect();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

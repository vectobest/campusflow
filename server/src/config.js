import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be numeric, got "${raw}"`);
  return value;
}

/**
 * Optional study-area bounding box "minLon,minLat,maxLon,maxLat".
 * When set, observations outside it are rejected (data minimisation: off-campus
 * locations are never stored). It is intentionally unset by default — the box
 * must come from a verified campus boundary, not from guessed coordinates.
 */
function parseBbox(raw) {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    throw new Error('STUDY_AREA_BBOX must be "minLon,minLat,maxLon,maxLat"');
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) throw new Error('STUDY_AREA_BBOX min values must be below max values');
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Allowed browser origins for the API, comma-separated. Bare hostnames get
 * https:// (Render passes the frontend's host without a scheme); trailing
 * slashes are removed because browsers never send them in Origin.
 */
export function parseOrigins(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((s) => (s.includes('://') ? s : `https://${s}`));
}

const nodeEnv = process.env.NODE_ENV || 'development';

// In production the API also serves the built web app (one service, one HTTPS origin).
const defaultClientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const clientDist = process.env.CLIENT_DIST || (nodeEnv === 'production' ? defaultClientDist : null);
const jwtSecret = process.env.JWT_SECRET || (nodeEnv === 'production' ? null : 'dev-only-insecure-secret');
if (!jwtSecret) throw new Error('JWT_SECRET is required in production');

export const config = {
  nodeEnv,
  port: num('PORT', 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusflow',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientDist: clientDist && fs.existsSync(path.join(clientDist, 'index.html')) ? clientDist : null,
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS || 'http://localhost:5173'),

  collection: {
    // Dataset that participant-contributed sessions are written to.
    datasetId: process.env.COLLECTION_DATASET_ID || 'nitrr-campus-collected',
    defaultSamplingIntervalSeconds: num('DEFAULT_SAMPLING_INTERVAL_SECONDS', 5),
    minSamplingIntervalSeconds: num('MIN_SAMPLING_INTERVAL_SECONDS', 1),
    maxSamplingIntervalSeconds: num('MAX_SAMPLING_INTERVAL_SECONDS', 60),
    maxBatchSize: num('MAX_BATCH_SIZE', 500),
    // Tolerated client/server clock disagreement when validating timestamps.
    clockSkewSeconds: num('CLOCK_SKEW_SECONDS', 300),
    // Physically meaningful upper bounds; anything beyond is a sensor/encoding error.
    maxAccuracyMeters: num('MAX_ACCURACY_METERS', 10000),
    maxSpeedMps: num('MAX_SPEED_MPS', 100),
    studyAreaBbox: parseBbox(process.env.STUDY_AREA_BBOX),
  },

  privacy: {
    // Raw trajectories older than this are purged. 0 disables the purge.
    retentionDays: num('RETENTION_DAYS', 365),
    // Minimum distinct participants before an aggregate is shown. The analysis CLI reads the same variable.
    minAggregateParticipants: num('MIN_AGGREGATE_PARTICIPANTS', 3),
  },

  rateLimits: {
    globalPerMinutePerIp: num('RATE_LIMIT_GLOBAL_PER_MINUTE', 1200),
    authPer15MinPerIp: num('RATE_LIMIT_AUTH_PER_15_MIN', 30),
    collectionPerMinutePerUser: num('RATE_LIMIT_COLLECTION_PER_MINUTE', 120),
  },

  consent: {
    currentVersion: process.env.CONSENT_VERSION || '1.0',
  },
};

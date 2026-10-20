import path from 'node:path';
import cors from 'cors';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import analyticsRoutes from './routes/analytics.js';
import authRoutes from './routes/auth.js';
import collectionRoutes from './routes/collection.js';
import consentRoutes from './routes/consent.js';
import datasetRoutes from './routes/datasets.js';
import statsRoutes from './routes/stats.js';

function limiter(windowMs, limit, { perToken = false } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.nodeEnv === 'test',
    // Route limiters key authenticated traffic per bearer token, so participants
    // sharing a campus NAT/Wi-Fi address do not throttle each other. The global
    // limiter stays per-IP so rotating bogus tokens cannot bypass it.
    keyGenerator: (req) => (perToken && req.headers.authorization) || ipKeyGenerator(req.ip),
    handler: (req, res) =>
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests, please retry later' } }),
  });
}

// Only this origin, plus the fonts and dark map tiles the web app actually loads.
const contentSecurityPolicy = {
  directives: {
    defaultSrc: ["'self'"],
    // accounts.google.com/gsi: "Sign in with Google" (Google Identity Services)
    scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
    frameSrc: ['https://accounts.google.com/gsi/'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'https://*.basemaps.cartocdn.com'],
    connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
  },
};

export function createApp({ clientDist = config.clientDist, googleVerifier = null } = {}) {
  const app = express();
  // Tests inject a fake Google token verifier here.
  if (googleVerifier) app.locals.googleVerifier = googleVerifier;
  app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false);
  // same-origin-allow-popups: Google's sign-in popup must be able to report back.
  app.use(helmet({ contentSecurityPolicy, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }));
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));
  if (config.nodeEnv === 'development') app.use(morgan('dev'));

  const api = express.Router();
  api.use(limiter(60_000, config.rateLimits.globalPerMinutePerIp));

  api.get('/health', (req, res) => {
    res.json({ data: { status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' } });
  });

  // Public sign-in options. The Google client ID is public by design (it is embedded in the page).
  api.get('/config/auth', (req, res) => {
    res.json({ data: { googleClientId: config.google.clientId, googleAllowedDomains: config.google.allowedDomains } });
  });

  // Public, non-sensitive collection settings so the client never hard-codes them.
  api.get('/config/collection', (req, res) => {
    const c = config.collection;
    res.json({
      data: {
        consentVersion: config.consent.currentVersion,
        defaultSamplingIntervalSeconds: c.defaultSamplingIntervalSeconds,
        minSamplingIntervalSeconds: c.minSamplingIntervalSeconds,
        maxSamplingIntervalSeconds: c.maxSamplingIntervalSeconds,
        maxBatchSize: c.maxBatchSize,
        studyAreaConfigured: Boolean(c.studyAreaBbox),
        retentionDays: config.privacy.retentionDays,
        minAggregateParticipants: config.privacy.minAggregateParticipants,
      },
    });
  });

  // Data routes need MongoDB; while it is unreachable they fail fast with a clear 503
  // (the collector treats that as "retry later" and keeps points on the device).
  api.use(['/auth', '/consent', '/collection', '/datasets', '/analytics', '/stats'], (req, res, next) =>
    mongoose.connection.readyState === 1
      ? next()
      : res.status(503).json({ error: { code: 'db_unavailable', message: 'The database is unavailable. Please try again shortly.' } }),
  );

  api.use('/auth', limiter(15 * 60_000, config.rateLimits.authPer15MinPerIp), authRoutes);
  api.use('/consent', consentRoutes);
  api.use('/collection', limiter(60_000, config.rateLimits.collectionPerMinutePerUser, { perToken: true }), collectionRoutes);
  api.use('/datasets', datasetRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/stats', statsRoutes);

  app.use('/api/v1', api);

  if (clientDist) {
    // Hashed assets can be cached forever; index.html must always be revalidated.
    app.use(express.static(clientDist, { index: false, maxAge: '1y', immutable: true }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.set('Cache-Control', 'no-cache');
      return res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

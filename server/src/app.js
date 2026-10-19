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

export function createApp() {
  const app = express();
  app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));
  if (config.nodeEnv === 'development') app.use(morgan('dev'));

  const api = express.Router();
  api.use(limiter(60_000, config.rateLimits.globalPerMinutePerIp));

  api.get('/health', (req, res) => {
    res.json({ data: { status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' } });
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

  api.use('/auth', limiter(15 * 60_000, config.rateLimits.authPer15MinPerIp), authRoutes);
  api.use('/consent', consentRoutes);
  api.use('/collection', limiter(60_000, config.rateLimits.collectionPerMinutePerUser, { perToken: true }), collectionRoutes);
  api.use('/datasets', datasetRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/stats', statsRoutes);

  app.use('/api/v1', api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

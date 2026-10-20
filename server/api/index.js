/**
 * Vercel serverless entry point for the API (server/vercel.json routes every
 * request here). The MongoDB connection is opened on the first request and
 * reused while the function instance stays warm.
 */
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import '../src/models/index.js';

const app = createApp({ clientDist: null });
let connecting = null;

function ensureDb() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  connecting ??= mongoose
    .connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 })
    // createIndexes only adds missing indexes (e.g. unique sessionId+sequence); cheap when they exist.
    .then(() => Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes())))
    .catch((err) => {
      connecting = null; // retry on the next request
      throw err;
    });
  return connecting;
}

export default async function handler(req, res) {
  try {
    await ensureDb();
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    // The health check still answers (reporting db: disconnected); everything else gets a clear 503.
    if (!req.url.startsWith('/api/v1/health')) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: { code: 'db_unavailable', message: 'The database is unavailable. Please try again shortly.' } }));
    }
  }
  return app(req, res);
}

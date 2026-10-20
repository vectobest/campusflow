import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db.js';
// Register every model before syncing indexes.
import './models/index.js';
import { runRetention } from './services/retention.js';

// Open the port first so the host's health check passes even while the database
// is unreachable; data routes answer 503 until the connection is up (see app.js).
const app = createApp();
app.listen(config.port, () => {
  console.log(`CampusFlow API listening on port ${config.port} (/api/v1)`);
  if (!config.collection.studyAreaBbox) {
    console.warn('STUDY_AREA_BBOX is not set: observations are not restricted to the campus area.');
  }
});

// Retention runs hourly in-process once connected; `npm run retention` runs it on demand.
const HOUR = 3600 * 1000;
function startRetention() {
  const tick = () => runRetention().catch((err) => console.error('Retention run failed:', err.message));
  tick();
  setInterval(tick, HOUR).unref();
}

async function connectWithRetry(attempt = 0) {
  try {
    await connectDb();
    console.log('MongoDB connected');
    startRetention();
  } catch (err) {
    const delay = Math.min(60_000, 2000 * 2 ** attempt);
    console.error(`MongoDB connection failed: ${err.message.split('\n')[0]} Retrying in ${delay / 1000} s.`);
    setTimeout(() => connectWithRetry(attempt + 1), delay);
  }
}
connectWithRetry();

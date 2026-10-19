import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db.js';
// Register every model before syncing indexes.
import './models/index.js';
import { runRetention } from './services/retention.js';

await connectDb();
const app = createApp();
app.listen(config.port, () => {
  console.log(`CampusFlow API listening on http://localhost:${config.port}/api/v1`);
  if (!config.collection.studyAreaBbox) {
    console.warn('STUDY_AREA_BBOX is not set: observations are not restricted to the campus area.');
  }
});

// Retention runs hourly in-process; `npm run retention` runs it on demand.
const HOUR = 3600 * 1000;
const tick = () => runRetention().catch((err) => console.error('Retention run failed:', err));
tick();
setInterval(tick, HOUR).unref();

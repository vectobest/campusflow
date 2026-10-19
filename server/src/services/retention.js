import { config } from '../config.js';
import { CollectionSession } from '../models/CollectionSession.js';
import { audit } from './audit.js';
import { deleteSessions } from './deletion.js';

/**
 * Delete raw sessions older than the retention period, and mark sessions that
 * were left ACTIVE/PAUSED for too long as ABANDONED (e.g. the participant closed
 * the tab and never pressed stop).
 */
export async function runRetention({ now = new Date(), retentionDays = config.privacy.retentionDays, abandonAfterHours = 24 } = {}) {
  const abandonCutoff = new Date(now.getTime() - abandonAfterHours * 3600 * 1000);
  const abandoned = await CollectionSession.updateMany(
    { collectionStatus: { $in: ['ACTIVE', 'PAUSED'] }, updatedAt: { $lt: abandonCutoff } },
    // Pipeline update: the last activity time becomes the effective end time.
    [{ $set: { collectionStatus: 'ABANDONED', endedAt: '$updatedAt' } }],
    { updatePipeline: true },
  );

  let purged = { sessions: 0, observations: 0, invalidatedVersions: 0 };
  if (retentionDays > 0) {
    const cutoff = new Date(now.getTime() - retentionDays * 86400 * 1000);
    const expired = await CollectionSession.find({ startedAt: { $lt: cutoff } }, { sessionId: 1 }).lean();
    purged = await deleteSessions(expired.map((s) => s.sessionId), 'retention_policy');
  }

  if (abandoned.modifiedCount > 0 || purged.sessions > 0) {
    await audit('retention.run', { details: { abandoned: abandoned.modifiedCount, ...purged, retentionDays } });
  }
  return { abandoned: abandoned.modifiedCount, ...purged };
}

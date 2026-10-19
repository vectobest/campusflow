import { CollectionSession } from '../models/CollectionSession.js';
import { DatasetVersion } from '../models/DatasetVersion.js';
import { GpsObservation } from '../models/GpsObservation.js';
import { RejectedObservation } from '../models/RejectedObservation.js';

/**
 * Hard-delete sessions and all of their raw observations. Any dataset version
 * that referenced them is marked invalidated so that nobody re-runs an analysis
 * expecting the deleted data to still be present.
 */
export async function deleteSessions(sessionIds, reason) {
  if (sessionIds.length === 0) return { sessions: 0, observations: 0, invalidatedVersions: 0 };
  const filter = { sessionId: { $in: sessionIds } };
  const [obs] = await Promise.all([GpsObservation.deleteMany(filter), RejectedObservation.deleteMany(filter)]);
  const sessions = await CollectionSession.deleteMany(filter);
  const invalidated = await DatasetVersion.updateMany(
    { sessionIds: { $in: sessionIds }, invalidatedAt: null },
    { $set: { invalidatedAt: new Date(), invalidationReason: reason } },
  );
  return {
    sessions: sessions.deletedCount,
    observations: obs.deletedCount,
    invalidatedVersions: invalidated.modifiedCount,
  };
}

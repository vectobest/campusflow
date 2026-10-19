import { Router } from 'express';
import { config } from '../config.js';
import { CollectionSession } from '../models/CollectionSession.js';

/**
 * Public, aggregate-only counters for the landing page. Counts only the real
 * collected dataset (never synthetic or imported data). The participant count
 * is withheld below the privacy threshold.
 */
const router = Router();

router.get('/public', async (req, res) => {
  const [row] = await CollectionSession.aggregate([
    { $match: { datasetId: config.collection.datasetId, dataOrigin: 'collected', collectionStatus: { $in: ['COMPLETED', 'ABANDONED'] } } },
    {
      $group: {
        _id: null,
        sessions: { $sum: 1 },
        observations: { $sum: '$acceptedObservationCount' },
        participants: { $addToSet: '$participantId' },
        recordedMs: { $sum: { $subtract: [{ $ifNull: ['$endedAt', '$startedAt'] }, '$startedAt'] } },
      },
    },
  ]);
  const k = config.privacy.minAggregateParticipants;
  const participants = row ? row.participants.length : 0;
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    data: {
      sessions: row?.sessions ?? 0,
      observations: row?.observations ?? 0,
      hoursRecorded: row ? Math.round((row.recordedMs / 3_600_000) * 10) / 10 : 0,
      participants: participants >= k ? participants : null,
      minAggregateParticipants: k,
    },
  });
});

export default router;

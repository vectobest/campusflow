import crypto from 'node:crypto';
import { CollectionSession } from '../models/CollectionSession.js';
import { DatasetVersion } from '../models/DatasetVersion.js';
import { GpsObservation } from '../models/GpsObservation.js';

/** Aggregate, non-identifying summary of every dataset currently in the database. */
export async function listDatasets() {
  const rows = await CollectionSession.aggregate([
    {
      $group: {
        _id: { datasetId: '$datasetId', dataOrigin: '$dataOrigin' },
        sessionCount: { $sum: 1 },
        observationCount: { $sum: '$acceptedObservationCount' },
        rejectedCount: { $sum: '$rejectedObservationCount' },
        participants: { $addToSet: '$participantId' },
        coverageStart: { $min: '$startedAt' },
        coverageEnd: { $max: { $ifNull: ['$endedAt', '$startedAt'] } },
      },
    },
    { $sort: { '_id.datasetId': 1 } },
  ]);
  const latest = await DatasetVersion.aggregate([
    { $sort: { version: -1 } },
    { $group: { _id: '$datasetId', latestVersion: { $first: '$version' } } },
  ]);
  const latestById = new Map(latest.map((l) => [l._id, l.latestVersion]));
  return rows.map((r) => ({
    datasetId: r._id.datasetId,
    dataOrigin: r._id.dataOrigin,
    sessionCount: r.sessionCount,
    observationCount: r.observationCount,
    rejectedCount: r.rejectedCount,
    participantCount: r.participants.length,
    coverageStart: r.coverageStart,
    coverageEnd: r.coverageEnd,
    latestVersion: latestById.get(r._id.datasetId) ?? null,
  }));
}

/**
 * Freeze the current state of a dataset as a new version. Only finished
 * sessions (COMPLETED or ABANDONED) are included, so a version never changes
 * because a participant is still recording.
 */
export async function createDatasetVersion(datasetId, { description = '', createdByRole }) {
  const sessions = await CollectionSession.find(
    { datasetId, collectionStatus: { $in: ['COMPLETED', 'ABANDONED'] } },
    { sessionId: 1, participantId: 1, dataOrigin: 1, startedAt: 1, endedAt: 1, acceptedObservationCount: 1 },
  )
    .sort({ sessionId: 1 })
    .lean();
  if (sessions.length === 0) return null;

  const origins = new Set(sessions.map((s) => s.dataOrigin));
  if (origins.size > 1) {
    // Guard against mixing synthetic or imported data with collected data.
    throw new Error(`Dataset ${datasetId} mixes data origins (${[...origins].join(', ')}); refusing to version it`);
  }

  const maxSeq = await GpsObservation.aggregate([
    { $match: { sessionId: { $in: sessions.map((s) => s.sessionId) } } },
    { $group: { _id: '$sessionId', maxSequence: { $max: '$sequence' } } },
  ]);
  const maxSeqById = new Map(maxSeq.map((m) => [m._id, m.maxSequence]));
  const hash = crypto.createHash('sha256');
  for (const s of sessions) hash.update(`${s.sessionId}:${s.acceptedObservationCount}:${maxSeqById.get(s.sessionId) ?? -1}\n`);

  const previous = await DatasetVersion.findOne({ datasetId }).sort({ version: -1 });
  const contentHash = hash.digest('hex');
  if (previous && previous.contentHash === contentHash && !previous.invalidatedAt) {
    return { version: previous, created: false };
  }

  const version = await DatasetVersion.create({
    datasetId,
    version: (previous?.version ?? 0) + 1,
    dataOrigin: [...origins][0],
    description,
    createdByRole,
    sessionIds: sessions.map((s) => s.sessionId),
    sessionCount: sessions.length,
    observationCount: sessions.reduce((n, s) => n + s.acceptedObservationCount, 0),
    participantCount: new Set(sessions.map((s) => s.participantId)).size,
    coverageStart: new Date(Math.min(...sessions.map((s) => new Date(s.startedAt).getTime()))),
    coverageEnd: new Date(Math.max(...sessions.map((s) => new Date(s.endedAt ?? s.startedAt).getTime()))),
    contentHash,
  });
  return { version, created: true };
}

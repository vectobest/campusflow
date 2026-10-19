import { config } from '../config.js';
import { CollectionSession } from '../models/CollectionSession.js';
import { GpsObservation } from '../models/GpsObservation.js';
import { RejectedObservation } from '../models/RejectedObservation.js';
import { sameObservation, validateObservation } from './observationValidation.js';

const DUPLICATE_KEY = 11000;

/**
 * Ingest a batch of observations for one session.
 *
 * Idempotency contract: the client may resend any batch (e.g. after a timeout)
 * and the stored data is unchanged. Re-sent identical observations are reported
 * as `duplicates`; a re-used sequence with different content is rejected as
 * `sequence_conflict` (the original is kept). Session counters are recomputed
 * from stored data rather than incremented, so retries cannot inflate them.
 */
export async function ingestBatch(session, items, { now = new Date(), rules = config.collection } = {}) {
  const rejected = [];
  const valid = [];
  const bySequence = new Map();
  let duplicates = 0;

  for (const raw of items) {
    const result = validateObservation(raw, { session, now, rules });
    if (!result.ok) {
      rejected.push({ sequence: result.sequence, reason: result.reason, detail: result.detail });
      continue;
    }
    const seen = bySequence.get(result.value.sequence);
    if (seen) {
      if (sameObservation(seen, result.value)) duplicates += 1;
      else rejected.push({ sequence: result.value.sequence, reason: 'duplicate_in_batch', detail: 'Same sequence twice with different content' });
      continue;
    }
    bySequence.set(result.value.sequence, result.value);
    valid.push(result.value);
  }

  let inserted = 0;
  const collidedSequences = [];
  if (valid.length > 0) {
    const createdAt = new Date();
    const docs = valid.map((v) => ({ ...v, createdAt }));
    try {
      const res = await GpsObservation.collection.insertMany(docs, { ordered: false });
      inserted = res.insertedCount;
    } catch (err) {
      if (!err.writeErrors && err.code !== DUPLICATE_KEY) throw err;
      const writeErrors = err.writeErrors ? [].concat(err.writeErrors) : [err];
      const nonDuplicate = writeErrors.find((we) => (we.code ?? we.err?.code) !== DUPLICATE_KEY);
      if (nonDuplicate) throw err;
      inserted = err.result?.insertedCount ?? err.insertedCount ?? docs.length - writeErrors.length;
      for (const we of writeErrors) collidedSequences.push(docs[we.index].sequence);
    }
  }

  if (collidedSequences.length > 0) {
    const existing = await GpsObservation.find(
      { sessionId: session.sessionId, sequence: { $in: collidedSequences } },
      { _id: 0, createdAt: 0 },
    ).lean();
    const existingBySeq = new Map(existing.map((e) => [e.sequence, e]));
    for (const seq of collidedSequences) {
      if (sameObservation(existingBySeq.get(seq), bySequence.get(seq))) duplicates += 1;
      else rejected.push({ sequence: seq, reason: 'sequence_conflict', detail: 'A different observation with this sequence was already stored' });
    }
  }

  if (rejected.length > 0) {
    await RejectedObservation.bulkWrite(
      rejected.map((r) => ({
        updateOne: {
          filter: { sessionId: session.sessionId, sequence: r.sequence, reason: r.reason },
          update: { $setOnInsert: { detail: r.detail, createdAt: new Date() } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  const totals = await refreshSessionCounts(session.sessionId, duplicates);
  return { accepted: inserted, duplicates, rejected, totals };
}

export async function refreshSessionCounts(sessionId, duplicateIncrement = 0) {
  const [accepted, rejected] = await Promise.all([
    GpsObservation.countDocuments({ sessionId }),
    RejectedObservation.countDocuments({ sessionId }),
  ]);
  const updated = await CollectionSession.findOneAndUpdate(
    { sessionId },
    {
      $set: { acceptedObservationCount: accepted, rejectedObservationCount: rejected },
      $inc: { duplicateSubmissionCount: duplicateIncrement },
    },
    { returnDocument: 'after' },
  );
  return {
    acceptedObservationCount: accepted,
    rejectedObservationCount: rejected,
    duplicateSubmissionCount: updated?.duplicateSubmissionCount ?? 0,
  };
}

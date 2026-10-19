import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth, requireConsent } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { CollectionSession } from '../models/CollectionSession.js';
import { GpsObservation } from '../models/GpsObservation.js';
import { RejectedObservation } from '../models/RejectedObservation.js';
import { audit } from '../services/audit.js';
import { deleteSessions } from '../services/deletion.js';
import { ingestBatch } from '../services/ingest.js';

const router = Router();
const rules = config.collection;
router.use(requireAuth);

/** Load a session the caller owns. Non-owners get 404 so session IDs cannot be probed. */
async function loadOwnSession(req) {
  const session = await CollectionSession.findOne({ sessionId: req.params.sessionId });
  if (!session || !req.participant || session.participantId !== req.participant.participantId) {
    throw new ApiError(404, 'session_not_found', 'Session not found');
  }
  return session;
}

const createSchema = z.object({
  samplingIntervalSeconds: z
    .number()
    .min(rules.minSamplingIntervalSeconds)
    .max(rules.maxSamplingIntervalSeconds)
    .default(rules.defaultSamplingIntervalSeconds),
  formFactor: z.enum(['mobile', 'desktop', 'unknown']).default('unknown'),
});

router.post('/sessions', requireConsent, validate(createSchema), async (req, res) => {
  const { participantId } = req.participant;
  const open = await CollectionSession.findOne({ participantId, collectionStatus: { $in: ['ACTIVE', 'PAUSED'] } });
  if (open) {
    throw new ApiError(409, 'session_already_open', 'Finish or stop your current session first', { session: open.toPublic() });
  }
  const session = await CollectionSession.create({
    sessionId: `ses_${crypto.randomUUID()}`,
    participantId,
    datasetId: rules.datasetId,
    dataOrigin: 'collected',
    startedAt: new Date(),
    samplingIntervalSeconds: req.valid.body.samplingIntervalSeconds,
    deviceMetadata: { formFactor: req.valid.body.formFactor },
  });
  res.status(201).json({ data: session.toPublic() });
});

const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/sessions/my', validate(paging, 'query'), async (req, res) => {
  const { page, limit } = req.valid.query;
  if (!req.participant) return res.json({ data: [], meta: { page, limit, total: 0 } });
  const filter = { participantId: req.participant.participantId };
  const [items, total] = await Promise.all([
    CollectionSession.find(filter).sort({ startedAt: -1 }).skip((page - 1) * limit).limit(limit),
    CollectionSession.countDocuments(filter),
  ]);
  res.json({ data: items.map((s) => s.toPublic()), meta: { page, limit, total } });
});

/** Delete every session the caller contributed (consent itself is unchanged). */
router.delete('/sessions/my', async (req, res) => {
  if (!req.participant) throw new ApiError(403, 'not_a_participant', 'This account has no participant record');
  const sessions = await CollectionSession.find({ participantId: req.participant.participantId }, { sessionId: 1 }).lean();
  const deleted = await deleteSessions(sessions.map((s) => s.sessionId), 'participant_request');
  await audit('session.delete_all', { user: req.user, targetType: 'participant', targetId: req.participant.participantId, details: deleted });
  res.json({ data: { deleted } });
});

router.get('/sessions/:sessionId', async (req, res) => {
  const session = await loadOwnSession(req);
  const rejectionSummary = await RejectedObservation.aggregate([
    { $match: { sessionId: session.sessionId } },
    { $group: { _id: '$reason', count: { $sum: 1 } } },
  ]);
  res.json({
    data: { ...session.toPublic(), rejectionSummary: Object.fromEntries(rejectionSummary.map((r) => [r._id, r.count])) },
  });
});

const batchSchema = z.object({
  observations: z.array(z.unknown()).min(1).max(rules.maxBatchSize),
});

router.post('/sessions/:sessionId/observations', requireConsent, validate(batchSchema), async (req, res) => {
  const session = await loadOwnSession(req);
  if (!['ACTIVE', 'PAUSED'].includes(session.collectionStatus)) {
    throw new ApiError(409, 'session_closed', `Session is ${session.collectionStatus}; it no longer accepts observations`);
  }
  const result = await ingestBatch(session, req.valid.body.observations);
  res.status(200).json({ data: result });
});

/** A participant can review their own raw trace. Researchers have no route here. */
router.get(
  '/sessions/:sessionId/observations',
  validate(
    z.object({
      afterSequence: z.coerce.number().int().min(-1).default(-1),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }),
    'query',
  ),
  async (req, res) => {
    const session = await loadOwnSession(req);
    const { afterSequence, limit } = req.valid.query;
    const items = await GpsObservation.find(
      { sessionId: session.sessionId, sequence: { $gt: afterSequence } },
      { _id: 0, createdAt: 0 },
    )
      .sort({ sequence: 1 })
      .limit(limit)
      .lean();
    const next = items.length === limit ? items[items.length - 1].sequence : null;
    res.json({ data: items, meta: { limit, nextAfterSequence: next } });
  },
);

const TRANSITIONS = {
  ACTIVE: ['PAUSED', 'COMPLETED'],
  PAUSED: ['ACTIVE', 'COMPLETED'],
  COMPLETED: [],
  ABANDONED: [],
};

router.patch(
  '/sessions/:sessionId',
  validate(z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']) })),
  async (req, res) => {
    const session = await loadOwnSession(req);
    const target = req.valid.body.status;
    // Repeating the current status is a no-op so clients can safely retry.
    if (session.collectionStatus === target) return res.json({ data: session.toPublic() });
    if (!TRANSITIONS[session.collectionStatus].includes(target)) {
      throw new ApiError(409, 'invalid_transition', `Cannot change a ${session.collectionStatus} session to ${target}`);
    }
    // Resuming is a new act of collection, so it requires current consent.
    if (target === 'ACTIVE' && !req.participant.hasValidConsent(config.consent.currentVersion)) {
      throw new ApiError(403, 'consent_required', 'Active consent is required to resume collection');
    }
    const now = new Date();
    if (target === 'PAUSED') session.pauses.push({ pausedAt: now });
    if (session.collectionStatus === 'PAUSED') {
      const open = session.pauses[session.pauses.length - 1];
      if (open && !open.resumedAt) open.resumedAt = now;
    }
    if (target === 'COMPLETED') session.endedAt = now;
    session.collectionStatus = target;
    await session.save();
    res.json({ data: session.toPublic() });
  },
);

router.delete('/sessions/:sessionId', async (req, res) => {
  const session = await loadOwnSession(req);
  const deleted = await deleteSessions([session.sessionId], 'participant_request');
  await audit('session.delete', { user: req.user, targetType: 'session', targetId: session.sessionId, details: deleted });
  res.json({ data: { deleted } });
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { getConsentDocument } from '../consent/documents.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { CollectionSession } from '../models/CollectionSession.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { audit } from '../services/audit.js';
import { deleteSessions } from '../services/deletion.js';

const router = Router();

router.get('/current', (req, res) => {
  const doc = getConsentDocument(config.consent.currentVersion);
  if (!doc) throw new ApiError(500, 'consent_missing', 'Current consent document is not configured');
  res.json({ data: doc });
});

const grantSchema = z.object({
  version: z.string(),
  statementsAccepted: z.array(z.string()),
});

router.post('/', requireAuth, validate(grantSchema), async (req, res) => {
  const { version, statementsAccepted } = req.valid.body;
  if (!req.participant) throw new ApiError(403, 'not_a_participant', 'This account has no participant record');
  const doc = getConsentDocument(config.consent.currentVersion);
  if (version !== doc.version) {
    throw new ApiError(409, 'consent_version_mismatch', `Current consent version is ${doc.version}`);
  }
  // Consent must be explicit: every statement has to be affirmed individually.
  const missing = doc.statements.filter((s) => !statementsAccepted.includes(s));
  if (missing.length > 0) throw new ApiError(400, 'consent_incomplete', 'All consent statements must be accepted', missing);

  const p = req.participant;
  p.consentStatus = 'granted';
  p.consentVersion = version;
  p.consentTimestamp = new Date();
  await p.save();
  await ConsentRecord.create({ participantId: p.participantId, action: 'granted', consentVersion: version, statementsAccepted });
  await audit('consent.grant', { user: req.user, targetType: 'participant', targetId: p.participantId, details: { version } });
  res.json({ data: p.toPublic() });
});

router.post('/withdraw', requireAuth, validate(z.object({ deleteData: z.boolean().default(false) })), async (req, res) => {
  const p = req.participant;
  if (!p) throw new ApiError(403, 'not_a_participant', 'This account has no participant record');
  const now = new Date();

  // Withdrawal immediately ends any running session.
  await CollectionSession.updateMany(
    { participantId: p.participantId, collectionStatus: { $in: ['ACTIVE', 'PAUSED'] } },
    { $set: { collectionStatus: 'COMPLETED', endedAt: now } },
  );

  let deleted = null;
  if (req.valid.body.deleteData) {
    const sessions = await CollectionSession.find({ participantId: p.participantId }, { sessionId: 1 }).lean();
    deleted = await deleteSessions(sessions.map((s) => s.sessionId), 'consent_withdrawn');
  }

  await ConsentRecord.create({ participantId: p.participantId, action: 'withdrawn', consentVersion: p.consentVersion ?? 'none' });
  p.consentStatus = 'withdrawn';
  p.consentTimestamp = now;
  await p.save();
  await audit('consent.withdraw', {
    user: req.user,
    targetType: 'participant',
    targetId: p.participantId,
    details: { deleteData: req.valid.body.deleteData, deleted },
  });
  res.json({ data: { participant: p.toPublic(), deleted } });
});

export default router;

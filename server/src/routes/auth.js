import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, signToken } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { CollectionSession } from '../models/CollectionSession.js';
import { Participant } from '../models/Participant.js';
import { User } from '../models/User.js';
import { audit } from '../services/audit.js';
import { deleteSessions } from '../services/deletion.js';

const router = Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

function authPayload(user, participant) {
  return { token: signToken(user), user: user.toPublic(), participant: participant?.toPublic() ?? null };
}

router.post('/register', validate(credentials), async (req, res) => {
  const { email, password } = req.valid.body;
  if (await User.exists({ email })) throw new ApiError(409, 'email_taken', 'An account with this email already exists');
  const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
  const participant = await Participant.create({ participantId: `p_${crypto.randomUUID()}`, internalUserId: user._id });
  res.status(201).json({ data: authPayload(user, participant) });
});

router.post('/login', validate(credentials), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await User.findOne({ email });
  // Same error for unknown email and wrong password to avoid account enumeration.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  const participant = await Participant.findOne({ internalUserId: user._id });
  res.json({ data: authPayload(user, participant) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ data: { user: req.user.toPublic(), participant: req.participant?.toPublic() ?? null } });
});

/** Delete the account, the participant record, and every contributed session. */
router.delete('/me', requireAuth, async (req, res) => {
  let deleted = { sessions: 0, observations: 0, invalidatedVersions: 0 };
  if (req.participant) {
    const sessions = await CollectionSession.find({ participantId: req.participant.participantId }, { sessionId: 1 }).lean();
    deleted = await deleteSessions(sessions.map((s) => s.sessionId), 'participant_account_deleted');
    await Participant.deleteOne({ _id: req.participant._id });
  }
  await User.deleteOne({ _id: req.user._id });
  await audit('account.delete', { user: req.user, targetType: 'user', targetId: req.user._id.toString(), details: deleted });
  res.json({ data: { deleted } });
});

export default router;

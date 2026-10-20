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
import { config } from '../config.js';
import { audit } from '../services/audit.js';
import { verifyGoogleCredential } from '../services/google.js';
import { deleteSessions } from '../services/deletion.js';

const router = Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

function authPayload(user, participant) {
  return { token: signToken(user), user: user.toPublic(), participant: participant?.toPublic() ?? null };
}

const newParticipant = (user) => Participant.create({ participantId: `p_${crypto.randomUUID()}`, internalUserId: user._id });

router.post('/register', validate(credentials), async (req, res) => {
  const { email, password } = req.valid.body;
  if (await User.exists({ email })) throw new ApiError(409, 'email_taken', 'An account with this email already exists');
  const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
  const participant = await newParticipant(user);
  res.status(201).json({ data: authPayload(user, participant) });
});

router.post('/login', validate(credentials), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await User.findOne({ email });
  // Same error for unknown email, wrong password, and Google-only accounts (no enumeration).
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  const participant = await Participant.findOne({ internalUserId: user._id });
  res.json({ data: authPayload(user, participant) });
});

/**
 * Sign in with Google (OpenID Connect over OAuth 2.0, Google Identity Services).
 * The browser obtains a signed ID token from Google; we verify it server-side and
 * then issue our own session token. Accounts are matched by Google's stable `sub`,
 * falling back to a verified email address (which links an existing password account).
 */
router.post('/google', validate(z.object({ credential: z.string().min(20).max(4096) })), async (req, res) => {
  if (!config.google.clientId) throw new ApiError(503, 'google_not_configured', 'Google sign-in is not configured');
  const verify = req.app.locals.googleVerifier ?? verifyGoogleCredential;
  let identity;
  try {
    identity = await verify(req.valid.body.credential);
  } catch {
    throw new ApiError(401, 'invalid_google_token', 'Google sign-in could not be verified. Please try again.');
  }
  if (!identity.emailVerified || !identity.email) {
    throw new ApiError(401, 'google_email_unverified', 'Your Google account email is not verified');
  }
  const { allowedDomains } = config.google;
  if (allowedDomains.length && !allowedDomains.includes((identity.hostedDomain || '').toLowerCase())) {
    throw new ApiError(403, 'google_domain_not_allowed', `Please use your ${allowedDomains.join(' or ')} Google account`);
  }

  const email = identity.email.toLowerCase();
  let user = await User.findOne({ googleId: identity.sub });
  let created = false;
  if (!user) {
    user = await User.findOne({ email });
    if (user) {
      user.googleId = identity.sub; // Google has verified this address: link the existing account
      await user.save();
      await audit('auth.google_linked', { user, targetType: 'user', targetId: user._id.toString() });
    } else {
      user = await User.create({ email, googleId: identity.sub });
      created = true;
    }
  }
  const participant = (await Participant.findOne({ internalUserId: user._id })) ?? (await newParticipant(user));
  res.status(created ? 201 : 200).json({ data: authPayload(user, participant) });
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

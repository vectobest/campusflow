import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Participant } from '../models/Participant.js';
import { ApiError } from './errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Requires a valid bearer token; loads req.user (and req.participant if one exists). */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new ApiError(401, 'unauthenticated', 'Authentication required'));
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new ApiError(401, 'invalid_token', 'Token is invalid or expired'));
  }
  // Role is re-read from the database so demotions take effect immediately.
  const user = await User.findById(payload.sub);
  if (!user) return next(new ApiError(401, 'invalid_token', 'Account no longer exists'));
  req.user = user;
  req.participant = await Participant.findOne({ internalUserId: user._id });
  return next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'forbidden', 'You do not have permission for this action'));
  }
  return next();
};

/** Requires the caller to hold consent for the current consent version. */
export function requireConsent(req, res, next) {
  if (!req.participant || !req.participant.hasValidConsent(config.consent.currentVersion)) {
    return next(
      new ApiError(403, 'consent_required', `Active consent to version ${config.consent.currentVersion} is required`),
    );
  }
  return next();
}

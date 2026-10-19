import mongoose from 'mongoose';

export const CONSENT_STATUSES = ['none', 'granted', 'withdrawn'];

/**
 * Research identity. participantId is a random UUID with no relation to the
 * account; internalUserId links back to User and must never leave the API
 * layer (it is excluded from analytics exports and dashboard responses).
 */
const participantSchema = new mongoose.Schema(
  {
    participantId: { type: String, required: true, unique: true },
    internalUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    consentVersion: { type: String, default: null },
    consentTimestamp: { type: Date, default: null },
    consentStatus: { type: String, enum: CONSENT_STATUSES, default: 'none' },
  },
  { timestamps: true },
);

participantSchema.methods.hasValidConsent = function hasValidConsent(currentVersion) {
  return this.consentStatus === 'granted' && this.consentVersion === currentVersion;
};

participantSchema.methods.toPublic = function toPublic() {
  return {
    participantId: this.participantId,
    consentVersion: this.consentVersion,
    consentTimestamp: this.consentTimestamp,
    consentStatus: this.consentStatus,
  };
};

export const Participant = mongoose.model('Participant', participantSchema);

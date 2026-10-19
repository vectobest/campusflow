import mongoose from 'mongoose';

/** Append-only history of consent decisions, for audit. */
const consentRecordSchema = new mongoose.Schema(
  {
    participantId: { type: String, required: true, index: true },
    action: { type: String, enum: ['granted', 'withdrawn'], required: true },
    consentVersion: { type: String, required: true },
    statementsAccepted: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const ConsentRecord = mongoose.model('ConsentRecord', consentRecordSchema);

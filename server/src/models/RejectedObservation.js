import mongoose from 'mongoose';

export const REJECTION_REASONS = [
  'invalid_schema',
  'invalid_latitude',
  'invalid_longitude',
  'invalid_timestamp',
  'timestamp_in_future',
  'timestamp_before_session',
  'timestamp_after_session',
  'invalid_accuracy',
  'invalid_speed',
  'invalid_heading',
  'outside_study_area',
  'duplicate_in_batch',
  'sequence_conflict',
];

/**
 * Why an observation was refused. Coordinates are deliberately NOT stored —
 * only the session, sequence and reason, so rejection is auditable without
 * retaining location data we decided not to keep.
 */
const rejectedObservationSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    sequence: { type: Number, default: null },
    reason: { type: String, enum: REJECTION_REASONS, required: true },
    detail: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// Unique so a retried batch does not double-count the same rejection.
rejectedObservationSchema.index({ sessionId: 1, sequence: 1, reason: 1 }, { unique: true });

export const RejectedObservation = mongoose.model('RejectedObservation', rejectedObservationSchema);

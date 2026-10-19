import mongoose from 'mongoose';

export const SESSION_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED'];
export const DATA_ORIGINS = ['collected', 'imported', 'synthetic'];

const pauseSchema = new mongoose.Schema(
  { pausedAt: { type: Date, required: true }, resumedAt: { type: Date, default: null } },
  { _id: false },
);

const collectionSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    participantId: { type: String, required: true, index: true },
    datasetId: { type: String, required: true, index: true },
    // Synthetic and imported data must never be mixed with collected data
    // or presented as real observations.
    dataOrigin: { type: String, enum: DATA_ORIGINS, required: true, default: 'collected' },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    collectionStatus: { type: String, enum: SESSION_STATUSES, default: 'ACTIVE', index: true },
    // Pauses are recorded so preprocessing can tell intentional gaps from signal loss.
    pauses: { type: [pauseSchema], default: [] },
    samplingIntervalSeconds: { type: Number, required: true },
    acceptedObservationCount: { type: Number, default: 0 },
    rejectedObservationCount: { type: Number, default: 0 },
    duplicateSubmissionCount: { type: Number, default: 0 },
    // Deliberately coarse: no user-agent string, no device identifiers.
    deviceMetadata: {
      formFactor: { type: String, enum: ['mobile', 'desktop', 'unknown'], default: 'unknown' },
    },
  },
  { timestamps: true },
);

collectionSessionSchema.methods.toPublic = function toPublic() {
  return {
    sessionId: this.sessionId,
    datasetId: this.datasetId,
    dataOrigin: this.dataOrigin,
    startedAt: this.startedAt,
    endedAt: this.endedAt,
    collectionStatus: this.collectionStatus,
    pauses: this.pauses,
    samplingIntervalSeconds: this.samplingIntervalSeconds,
    acceptedObservationCount: this.acceptedObservationCount,
    rejectedObservationCount: this.rejectedObservationCount,
    duplicateSubmissionCount: this.duplicateSubmissionCount,
    deviceMetadata: this.deviceMetadata,
    createdAt: this.createdAt,
  };
};

export const CollectionSession = mongoose.model('CollectionSession', collectionSessionSchema);

import mongoose from 'mongoose';

/**
 * A frozen description of a dataset at a point in time. Every analytics
 * result (later phases) references a dataset version so results are
 * reproducible and can be traced to exactly which sessions they used.
 */
const datasetVersionSchema = new mongoose.Schema(
  {
    datasetId: { type: String, required: true },
    version: { type: Number, required: true },
    dataOrigin: { type: String, enum: ['collected', 'imported', 'synthetic'], required: true },
    description: { type: String, default: '' },
    createdByRole: { type: String, required: true },
    sessionIds: { type: [String], default: [] },
    sessionCount: { type: Number, required: true },
    observationCount: { type: Number, required: true },
    participantCount: { type: Number, required: true },
    coverageStart: { type: Date, default: null },
    coverageEnd: { type: Date, default: null },
    // sha256 over sorted "sessionId:acceptedCount:maxSequence" — changes if any
    // session is added, deleted, or receives more observations.
    contentHash: { type: String, required: true },
    // Set when a participant deletes data included in this version.
    invalidatedAt: { type: Date, default: null },
    invalidationReason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

datasetVersionSchema.index({ datasetId: 1, version: 1 }, { unique: true });

datasetVersionSchema.methods.toPublic = function toPublic() {
  const o = this.toObject();
  delete o._id;
  delete o.__v;
  delete o.sessionIds; // session lists are not needed by clients
  return o;
};

export const DatasetVersion = mongoose.model('DatasetVersion', datasetVersionSchema);

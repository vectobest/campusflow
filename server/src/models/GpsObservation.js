import mongoose from 'mongoose';

/**
 * One raw GPS fix, stored exactly as reported (original timestamp preserved,
 * missing optional measurements stored as null). Quality flagging happens in
 * the analytics preprocessing pipeline, not here.
 *
 * Note: one document per fix is fine for the pilot scale. For large datasets
 * observations should be materialised to Parquet per dataset version and only
 * metadata kept in MongoDB (see docs/DATA_MODEL.md).
 */
const gpsObservationSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    sequence: { type: Number, required: true },
    timestamp: { type: Date, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    speed: { type: Number, default: null },
    heading: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// Idempotent ingestion: a retried batch can never create a second copy.
gpsObservationSchema.index({ sessionId: 1, sequence: 1 }, { unique: true });
gpsObservationSchema.index({ sessionId: 1, timestamp: 1 });
gpsObservationSchema.index({ timestamp: 1 });

export const GpsObservation = mongoose.model('GpsObservation', gpsObservationSchema);

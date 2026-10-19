import mongoose from 'mongoose';

/**
 * Audit trail for sensitive operations (consent changes, deletions, role
 * changes, dataset snapshots, retention purges). Never stores coordinates.
 */
const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
    actorRole: { type: String, default: 'system' },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

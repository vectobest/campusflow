import { AuditLog } from '../models/AuditLog.js';

export function audit(action, { user = null, targetType = null, targetId = null, details = {} } = {}) {
  return AuditLog.create({
    action,
    actorUserId: user?._id ?? null,
    actorRole: user?.role ?? 'system',
    targetType,
    targetId,
    details,
  });
}

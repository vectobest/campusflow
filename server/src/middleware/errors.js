import { config } from '../config.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (req, res, next) => next(new ApiError(404, 'not_found', `No route for ${req.method} ${req.path}`));

// Consistent error envelope: { error: { code, message, details? } }
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
  }
  if (config.nodeEnv !== 'test') console.error(err);
  return res.status(500).json({ error: { code: 'internal_error', message: 'An unexpected error occurred' } });
}

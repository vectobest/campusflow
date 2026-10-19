import { ApiError } from './errors.js';

/** Validate req[source] against a zod schema and replace it with the parsed value. */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(new ApiError(400, 'validation_error', 'Request validation failed', details));
  }
  // req.query is a getter in Express 5, so parsed values go on req.valid instead.
  req.valid = { ...(req.valid || {}), [source]: result.data };
  return next();
};

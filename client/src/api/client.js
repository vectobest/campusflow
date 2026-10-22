import axios from 'axios'

const TOKEN_KEY = 'campusflow.token'

function safeStorage(fn, fallback = null) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const tokenStore = {
  get: () => safeStorage(() => localStorage.getItem(TOKEN_KEY)),
  set: (t) => safeStorage(() => localStorage.setItem(TOKEN_KEY, t)),
  clear: () => safeStorage(() => localStorage.removeItem(TOKEN_KEY)),
}

/**
 * Where the API lives. Development: same origin, proxied by Vite.
 * Separate deployments: set VITE_API_BASE_URL (full URL, e.g. https://api.example.com/api/v1)
 * or VITE_API_HOST (hostname only, as Render's blueprint provides it).
 */
export function apiBaseUrl(env = import.meta.env) {
  if (env.VITE_API_BASE_URL) return env.VITE_API_BASE_URL.replace(/\/+$/, '')
  if (env.VITE_API_HOST) return `https://${env.VITE_API_HOST.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/api/v1`
  return '/api/v1'
}

// Generous timeout: the API runs on a free host that sleeps when idle and can
// take up to about a minute to wake on the first request.
export const http = axios.create({
  baseURL: apiBaseUrl(),
  timeout: 60000,
})

http.interceptors.request.use((cfg) => {
  const token = tokenStore.get()
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

/**
 * Normalised error: { kind: 'network' | 'http', status, code, message, details }.
 * 'network' means the request may or may not have reached the server, so
 * callers must only retry idempotent operations.
 */
export class ApiRequestError extends Error {
  constructor({ kind, status = null, code = null, message, details = null }) {
    super(message)
    Object.assign(this, { kind, status, code, details })
  }
}

function normalise(err) {
  if (err.response) {
    const e = err.response.data?.error || {}
    return new ApiRequestError({
      kind: 'http',
      status: err.response.status,
      code: e.code || null,
      message: e.message || `Request failed (${err.response.status})`,
      details: e.details || null,
    })
  }
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    return new ApiRequestError({
      kind: 'network',
      code: 'timeout',
      message: 'The server is taking a while to respond. It may be waking up; please try again in a moment.',
    })
  }
  return new ApiRequestError({
    kind: 'network',
    code: 'unreachable',
    message: 'Could not reach the server. Check your internet connection and try again.',
  })
}

/** Retry an idempotent request on network errors (e.g. while the server wakes up). */
export async function withRetry(fn, { attempts = 4, delayMs = 3000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (err.kind !== 'network' || i >= attempts) throw err
      await new Promise((r) => setTimeout(r, delayMs * i))
    }
  }
}

async function call(method, url, data, params) {
  try {
    const res = await http.request({ method, url, data, params })
    return res.data
  } catch (err) {
    throw normalise(err)
  }
}

export const api = {
  register: (email, password) => call('post', '/auth/register', { email, password }),
  login: (email, password) => call('post', '/auth/login', { email, password }),
  googleSignIn: (credential) => call('post', '/auth/google', { credential }),
  authConfig: () => call('get', '/config/auth'),
  health: () => call('get', '/health'),
  me: () => call('get', '/auth/me'),
  deleteAccount: () => call('delete', '/auth/me'),

  collectionConfig: () => call('get', '/config/collection'),
  publicStats: () => call('get', '/stats/public'),
  consentDocument: () => call('get', '/consent/current'),
  grantConsent: (version, statementsAccepted) => call('post', '/consent', { version, statementsAccepted }),
  withdrawConsent: (deleteData) => call('post', '/consent/withdraw', { deleteData }),

  createSession: (body) => call('post', '/collection/sessions', body),
  mySessions: (page = 1, limit = 20) => call('get', '/collection/sessions/my', null, { page, limit }),
  session: (id) => call('get', `/collection/sessions/${id}`),
  setSessionStatus: (id, status) => call('patch', `/collection/sessions/${id}`, { status }),
  uploadObservations: (id, observations) => call('post', `/collection/sessions/${id}/observations`, { observations }),
  sessionObservations: (id, afterSequence = -1, limit = 1000) =>
    call('get', `/collection/sessions/${id}/observations`, null, { afterSequence, limit }),
  deleteSession: (id) => call('delete', `/collection/sessions/${id}`),
  deleteAllSessions: () => call('delete', '/collection/sessions/my'),

  datasets: () => call('get', '/datasets'),
  dataset: (id) => call('get', `/datasets/${encodeURIComponent(id)}`),
  analyticsResults: () => call('get', '/analytics/results'),
  analyticsResult: (id) => call('get', `/analytics/results/${encodeURIComponent(id)}`),
  createDatasetVersion: (id, description) => call('post', `/datasets/${encodeURIComponent(id)}/versions`, { description }),
}

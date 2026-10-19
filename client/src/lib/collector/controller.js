import { backoffMs, isRetryable, removeAcknowledged, shouldRecord, stepDistance, summariseRejections, toObservation } from './core'

/**
 * GPS collection controller.
 *
 * Responsibilities:
 *  - record fixes only while a session is RECORDING (never while paused/stopped);
 *  - throttle to the configured sampling interval;
 *  - assign monotonically increasing sequence numbers (persisted, so a reload
 *    never reuses a sequence);
 *  - keep unsent observations in a durable local queue and upload them in
 *    batches, retrying with backoff. Because the server de-duplicates on
 *    (sessionId, sequence), resending a batch after an ambiguous failure is safe;
 *  - only mark the session COMPLETED after the queue is empty.
 *
 * Browser APIs (geolocation, storage, timers) are injected for testability.
 */

const STORAGE_KEY = 'campusflow.collector.v1'

export const PHASE = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused',
  FINISHING: 'finishing',
  DONE: 'done',
}

const emptyStats = () => ({ recorded: 0, accepted: 0, duplicates: 0, rejected: 0, rejectedReasons: {}, discarded: 0, distanceM: 0 })

// Recent good fixes kept in memory for the live path preview (never persisted or uploaded).
const RECENT_MAX = 400

function initialState() {
  return {
    phase: PHASE.IDLE,
    participantId: null,
    sessionId: null,
    samplingIntervalSeconds: null,
    serverStatus: null,
    desiredStatus: null,
    nextSequence: 0,
    lastRecordedMs: null,
    queue: [],
    stats: emptyStats(),
    serverTotals: null,
    interrupted: false,
    startedAtMs: null,
    // Transient (not persisted)
    recent: [],
    gps: { lastFix: null, error: null },
    upload: { inFlight: false, attempt: 0, nextRetryAt: null, lastSuccessAt: null, error: null },
    notice: null,
    fatal: null,
    storageError: false,
  }
}

const DURABLE_KEYS = [
  'phase', 'participantId', 'sessionId', 'samplingIntervalSeconds', 'serverStatus', 'desiredStatus',
  'nextSequence', 'lastRecordedMs', 'queue', 'stats', 'serverTotals', 'interrupted', 'startedAtMs',
]

export class CollectorController {
  constructor({
    api,
    geolocation,
    storage,
    timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (id) => clearTimeout(id) },
    now = () => Date.now(),
    random = Math.random,
    maxBatchSize = 200,
    uploadEveryMs = 15000,
    eagerBatchSize = 50,
  }) {
    Object.assign(this, { api, geolocation, storage, timers, now, random, maxBatchSize, uploadEveryMs, eagerBatchSize })
    this.state = initialState()
    this.listeners = new Set()
    this.watchId = null
    this.timer = null
    this.flushRequested = false
  }

  // ----- subscription (compatible with React's useSyncExternalStore) -----
  subscribe = (fn) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.state

  _set(patch, { persist = true } = {}) {
    this.state = { ...this.state, ...patch }
    if (persist) this._persist()
    for (const fn of this.listeners) fn()
  }

  _persist() {
    try {
      if (this.state.phase === PHASE.IDLE || this.state.phase === PHASE.DONE) {
        this.storage.removeItem(STORAGE_KEY)
        return
      }
      const durable = Object.fromEntries(DURABLE_KEYS.map((k) => [k, this.state[k]]))
      this.storage.setItem(STORAGE_KEY, JSON.stringify(durable))
      if (this.state.storageError) this.state = { ...this.state, storageError: false }
    } catch {
      // Storage full or blocked: keep working in memory, but tell the participant.
      this.state = { ...this.state, storageError: true }
    }
  }

  /** Any unsent state left on this device by a previous page load (for any participant). */
  pendingOnDevice() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  /**
   * Restore an unfinished session after a reload. Recording never resumes
   * silently: a session that was recording comes back PAUSED and the
   * participant must press Resume.
   */
  restore(participantId) {
    const saved = this.pendingOnDevice()
    if (!saved || saved.participantId !== participantId || !saved.sessionId) return false
    const wasRecording = saved.phase === PHASE.RECORDING
    this._set({
      ...initialState(),
      ...saved,
      phase: wasRecording ? PHASE.PAUSED : saved.phase,
      desiredStatus: wasRecording ? 'PAUSED' : saved.desiredStatus,
      interrupted: wasRecording || saved.interrupted,
    })
    this.flush()
    return true
  }

  /** Remove local unsent data (e.g. on logout of a shared device). */
  clearDevice() {
    this._stopWatch()
    this._clearTimer()
    try {
      this.storage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    this._set(initialState(), { persist: false })
  }

  begin({ participantId, sessionId, samplingIntervalSeconds }) {
    this._set({
      ...initialState(),
      phase: PHASE.RECORDING,
      participantId,
      sessionId,
      samplingIntervalSeconds,
      serverStatus: 'ACTIVE',
      desiredStatus: 'ACTIVE',
      startedAtMs: this.now(),
    })
    this._startWatch()
    this._schedule(this.uploadEveryMs)
  }

  pause() {
    if (this.state.phase !== PHASE.RECORDING) return
    this._stopWatch()
    this._set({ phase: PHASE.PAUSED, desiredStatus: 'PAUSED' })
    this.flush()
  }

  resume() {
    if (this.state.phase !== PHASE.PAUSED) return
    this._set({ phase: PHASE.RECORDING, desiredStatus: 'ACTIVE', interrupted: false, gps: { ...this.state.gps, error: null } })
    this._startWatch()
    this.flush()
  }

  stop() {
    if (![PHASE.RECORDING, PHASE.PAUSED].includes(this.state.phase)) return
    this._stopWatch()
    this._set({ phase: PHASE.FINISHING, desiredStatus: 'COMPLETED' })
    this.flush()
  }

  /** Acknowledge the finished summary and return to idle. */
  reset() {
    this._clearTimer()
    this._set(initialState())
  }

  /** Retry immediately (e.g. the browser reported it is back online). */
  retryNow() {
    if (this.state.phase === PHASE.IDLE || this.state.phase === PHASE.DONE) return
    this._set({ upload: { ...this.state.upload, attempt: 0, nextRetryAt: null } }, { persist: false })
    this.flush()
  }

  // ----- geolocation -----
  _startWatch() {
    if (this.watchId !== null) return
    this.watchId = this.geolocation.watchPosition(
      (pos) => this._onPosition(pos),
      (err) => this._onGpsError(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    )
  }

  _stopWatch() {
    if (this.watchId === null) return
    this.geolocation.clearWatch(this.watchId)
    this.watchId = null
  }

  _onPosition(pos) {
    const s = this.state
    const lastFix = { accuracy: pos.coords.accuracy ?? null, timestamp: pos.timestamp }
    if (s.phase !== PHASE.RECORDING) return // never record outside an active session
    if (!shouldRecord(pos.timestamp, s.lastRecordedMs, s.samplingIntervalSeconds)) {
      this._set({ gps: { lastFix, error: null } }, { persist: false })
      return
    }
    const obs = toObservation(pos, s.sessionId, s.nextSequence)
    const queue = [...s.queue, obs]
    const point = { lat: obs.latitude, lon: obs.longitude, t: pos.timestamp, accuracy: obs.accuracy }
    const prev = s.recent[s.recent.length - 1]
    const step = stepDistance(prev, point)
    const good = (obs.accuracy ?? 0) <= 50
    this._set({
      gps: { lastFix, error: null },
      queue,
      nextSequence: s.nextSequence + 1,
      lastRecordedMs: pos.timestamp,
      recent: good && (!prev || step > 0) ? [...s.recent, point].slice(-RECENT_MAX) : s.recent,
      stats: { ...s.stats, recorded: s.stats.recorded + 1, distanceM: (s.stats.distanceM ?? 0) + step },
    })
    if (queue.length >= this.eagerBatchSize && !s.upload.inFlight && !s.upload.nextRetryAt) this.flush()
  }

  _onGpsError(err) {
    // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
    if (err.code === 1) {
      this._stopWatch()
      this._set({
        phase: this.state.phase === PHASE.RECORDING ? PHASE.PAUSED : this.state.phase,
        desiredStatus: this.state.phase === PHASE.RECORDING ? 'PAUSED' : this.state.desiredStatus,
        gps: { ...this.state.gps, error: 'permission_denied' },
      })
      this.flush()
      return
    }
    this._set({ gps: { ...this.state.gps, error: err.code === 3 ? 'timeout' : 'unavailable' } }, { persist: false })
  }

  // ----- upload loop -----
  _clearTimer() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
  }

  _schedule(delayMs) {
    this._clearTimer()
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      this.flush()
    }, delayMs)
  }

  async flush() {
    const s = this.state
    if (!s.sessionId || s.phase === PHASE.IDLE || s.phase === PHASE.DONE || s.fatal) return
    if (s.upload.inFlight) {
      // Pause/stop/new data arrived mid-upload: run again as soon as this one ends.
      this.flushRequested = true
      return
    }
    this.flushRequested = false
    this._clearTimer()
    this._set({ upload: { ...s.upload, inFlight: true, error: null } }, { persist: false })
    try {
      // 1. Bring the server's pause/resume status in line (idempotent PATCH).
      const desired = this.state.desiredStatus
      if ((desired === 'PAUSED' || desired === 'ACTIVE') && desired !== this.state.serverStatus) {
        await this.api.setSessionStatus(this.state.sessionId, desired)
        this._set({ serverStatus: desired })
      }
      // 2. Drain the queue in batches.
      while (this.state.queue.length > 0) {
        const batch = this.state.queue.slice(0, this.maxBatchSize)
        let result
        try {
          ;({ data: result } = await this.api.uploadObservations(this.state.sessionId, batch))
        } catch (err) {
          if (err.kind === 'http' && err.status === 400) {
            // Malformed batch the server will never accept: drop it rather than retry forever.
            this._dropQueued(batch.map((o) => o.sequence))
            continue
          }
          throw err
        }
        const st = this.state.stats
        this._set({
          queue: removeAcknowledged(this.state.queue, batch.map((o) => o.sequence)),
          stats: {
            ...st,
            accepted: st.accepted + result.accepted,
            duplicates: st.duplicates + result.duplicates,
            rejected: st.rejected + result.rejected.length,
            rejectedReasons: summariseRejections(result.rejected, st.rejectedReasons),
          },
          serverTotals: result.totals,
        })
      }
      // 3. Only complete once every observation has been acknowledged.
      if (this.state.desiredStatus === 'COMPLETED') {
        try {
          await this.api.setSessionStatus(this.state.sessionId, 'COMPLETED')
        } catch (err) {
          if (!(err.kind === 'http' && err.status === 409)) throw err // 409: already closed server-side
        }
        this._set({ phase: PHASE.DONE, serverStatus: 'COMPLETED' })
      }
      this._set(
        { upload: { inFlight: false, attempt: 0, nextRetryAt: null, lastSuccessAt: this.now(), error: null } },
        { persist: false },
      )
      if (this.flushRequested) return this.flush()
      if (this.state.phase === PHASE.RECORDING || this.state.phase === PHASE.PAUSED) this._schedule(this.uploadEveryMs)
    } catch (err) {
      this._handleFlushError(err)
    }
  }

  _dropQueued(sequences) {
    const st = this.state.stats
    this._set({
      queue: removeAcknowledged(this.state.queue, sequences),
      stats: { ...st, discarded: st.discarded + sequences.length },
    })
  }

  _handleFlushError(err) {
    const upload = { ...this.state.upload, inFlight: false, error: err.message }
    if (isRetryable(err)) {
      const delay = backoffMs(upload.attempt, { random: this.random })
      this._set({ upload: { ...upload, attempt: upload.attempt + 1, nextRetryAt: this.now() + delay } }, { persist: false })
      this._schedule(delay)
      return
    }
    if (err.status === 401) {
      // Keep the queue: once the participant signs in again, uploading continues.
      this._stopWatch()
      this._set({ upload, fatal: { code: 'unauthenticated', message: 'Your sign-in expired. Sign in again to finish uploading.' } })
      return
    }
    if (err.status === 403) {
      this._stopWatch()
      this._set({ upload, fatal: { code: err.code || 'forbidden', message: err.message } })
      return
    }
    if (err.status === 404 || err.status === 409) {
      // The session was closed or deleted elsewhere; queued data can no longer be stored.
      this._stopWatch()
      const st = this.state.stats
      this._set({
        upload,
        phase: PHASE.DONE,
        queue: [],
        stats: { ...st, discarded: st.discarded + this.state.queue.length },
        notice: 'This session was closed on the server, so it no longer accepts observations.',
      })
      return
    }
    this._set({ upload: { ...upload, attempt: upload.attempt + 1 } }, { persist: false })
    this._schedule(backoffMs(upload.attempt, { random: this.random }))
  }

  /** Clear a fatal error (e.g. after re-authenticating) and try again. */
  clearFatal() {
    this._set({ fatal: null })
    this.flush()
  }
}

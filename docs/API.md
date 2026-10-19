# API reference (v1)

Base path `/api/v1`. JSON in and out. Success: `{ "data": …, "meta"?: … }`. Error: `{ "error": { "code", "message", "details"? } }`.
Authenticated routes need `Authorization: Bearer <jwt>`.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, db }` |
| GET | `/config/collection` | sampling-interval range/default, batch size, consent version, retention days, suppression threshold, whether a study area is configured |
| GET | `/consent/current` | current consent document |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password(≥10) }` | creates User + Participant (`p_<uuid>`) → `{ token, user, participant }` |
| POST | `/auth/login` | `{ email, password }` | identical 401 for unknown email / wrong password |
| GET | `/auth/me` | | `{ user, participant }` |
| DELETE | `/auth/me` | | deletes account, participant, all sessions |

## Consent

| Method | Path | Body |
|---|---|---|
| POST | `/consent` | `{ version, statementsAccepted: string[] }` — all statements required; 409 on outdated version |
| POST | `/consent/withdraw` | `{ deleteData?: boolean }` |

## Collection (participant, own data only)

| Method | Path | Notes |
|---|---|---|
| POST | `/collection/sessions` | `{ samplingIntervalSeconds?, formFactor? }`; consent required; 409 `session_already_open` (details include the open session) |
| GET | `/collection/sessions/my?page&limit` | paginated, newest first |
| DELETE | `/collection/sessions/my` | delete all own sessions |
| GET | `/collection/sessions/:id` | session + `rejectionSummary` |
| PATCH | `/collection/sessions/:id` | `{ status: ACTIVE\|PAUSED\|COMPLETED }`; repeating the current status is a no-op; 409 `invalid_transition` |
| POST | `/collection/sessions/:id/observations` | `{ observations: [...] }` (1–`MAX_BATCH_SIZE`); session must be ACTIVE/PAUSED (else 409 `session_closed`) |
| GET | `/collection/sessions/:id/observations?afterSequence&limit` | owner's raw trace, cursor pagination by sequence |
| DELETE | `/collection/sessions/:id` | hard delete |

Sessions owned by someone else return **404** (not 403) so IDs cannot be probed.

### Observation

```json
{ "sequence": 1, "timestamp": "2026-10-17T08:30:00Z", "latitude": 21.25, "longitude": 81.6,
  "accuracy": 12.5, "speed": 1.2, "heading": 85 }
```
Illustrative values only. `sessionId` is optional in the body (must match the URL if present). `accuracy`/`speed`/`heading` may be omitted or `null`.

### Ingestion response

```json
{ "data": {
  "accepted": 48, "duplicates": 2,
  "rejected": [{ "sequence": 17, "reason": "invalid_latitude", "detail": "…" }],
  "totals": { "acceptedObservationCount": 512, "rejectedObservationCount": 3, "duplicateSubmissionCount": 6 } } }
```

## Datasets (researcher / admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/datasets` | per dataset: origin, sessions, observations, rejected, distinct participants, coverage, latest version |
| GET | `/datasets/:datasetId` | summary + versions |
| POST | `/datasets/:datasetId/versions` | `{ description? }`; freezes COMPLETED/ABANDONED sessions; 201 new, 200 if unchanged (same content hash), 409 `mixed_origins`, 404 if nothing to freeze |

## Analytics (researcher / admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/analytics/results` | datasets that have been analysed: origin, latest run time, number of runs |
| GET | `/analytics/results/:datasetId` | latest aggregate result (written by `npm run analyze`); 404 `no_results` before the first run |

## Not built (outside the current scope)

Dataset import/export, places CRUD (places are a GeoJSON file instead), analysis job queue, report export.

## Rate limits

Per IP: 1200/min overall, 30 per 15 min on `/auth`. Per token: 120/min on `/collection`. All configurable; 429 with `rate_limited`.

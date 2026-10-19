# Consent and privacy model

CampusFlow studies **aggregate** movement. These controls are enforced in code; the "Where" column points to the implementation.

| Control | Behaviour | Where |
|---|---|---|
| Informed, explicit consent | Versioned consent document; every statement must be affirmed individually; history kept in `ConsentRecord` | `server/src/consent/documents.js`, `routes/consent.js` |
| Consent gating | Creating, resuming, and uploading to sessions require consent to the *current* version (bumping `CONSENT_VERSION` forces re-consent) | `middleware/auth.js#requireConsent` |
| Withdrawal | Ends open sessions immediately; optional deletion of all data | `POST /consent/withdraw` |
| Collection only during a session | The client records only in the RECORDING phase; watchers are cleared on pause/stop; after a reload a session comes back PAUSED and never resumes silently | `client/src/lib/collector/controller.js` |
| Visible indicator | Full-width banner on every page plus tab title `● Recording` | `components/Layout.jsx` |
| No background-tracking promises | UI and consent explain that browsers may stop updates when the screen locks; background gaps are detected and reported to the participant | `CollectorPanel.jsx` |
| Data minimisation | No user-agent, device IDs, or IP stored with data; device metadata is just `mobile/desktop`; optional `STUDY_AREA_BBOX` rejects off-campus points before storage | `CollectionSession.js`, `observationValidation.js` |
| Identity separation | Email only in `User`; research data keyed by random `participantId`; `internalUserId` never returned by any endpoint | `Participant.js` |
| Raw-trace access | Only the owner can read a session's observations (non-owners get 404, including researchers). Researchers see aggregate dataset summaries | `routes/collection.js`, `routes/datasets.js` |
| Deletion | Per session, all sessions, account deletion; dataset versions referencing deleted data are invalidated | `services/deletion.js` |
| Retention | Hourly in-process job + `npm run retention`; stale open sessions → ABANDONED after 24 h | `services/retention.js` |
| Audit log | Consent changes, deletions, role changes, dataset versioning, retention runs. Never coordinates | `services/audit.js` |
| Abuse protection | Helmet headers, per-IP and per-token rate limits, JSON body limit, schema validation, generic login errors | `app.js` |

## Before collecting real data

1. Obtain institutional ethics approval and set `ETHICS_APPROVAL_REF` and `STUDY_CONTACT` (they appear in the consent form, currently marked TODO).
2. Set `STUDY_AREA_BBOX` from a **verified** campus boundary (not from this repository; no campus coordinates are bundled).
3. Set a strong `JWT_SECRET`, serve over HTTPS, and choose `RETENTION_DAYS` and `MIN_AGGREGATE_PARTICIPANTS` per the study's privacy assessment.

## Known limits

* Pseudonymisation is not anonymisation: a raw trace can identify a person from where they sleep and study. Raw traces are therefore never published or exported publicly.
* The small-group threshold (default 3 distinct participants, shared by the API and the analysis) is a starting point, not a guarantee. The dashboard offers only fixed hour-of-day buckets (no free-form filters) to limit differencing between overlapping queries.
* Bearer tokens are stored in `localStorage` (simple, but readable by injected scripts). The app has no third-party scripts; moving to httpOnly cookies is a hardening option.
* Viewing one's own trace loads OpenStreetMap tiles, revealing the viewed area to the tile server.

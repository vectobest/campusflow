# CampusFlow architecture

Status legend: ✅ implemented · 🔜 not built (out of the current, reduced scope)

> Scope update: the project follows the short brief (collection → stay points, crowded zones by hour, frequent paths, PrefixSpan, trajectory clustering). Analysis runs as a command (`npm run analyze`) whose result the API serves to the dashboard; the FastAPI job service, import/export module and report generator from the original plan are not built.

## System architecture

```mermaid
flowchart LR
  subgraph Browser
    C["Collection client ✅<br/>(React, Geolocation API,<br/>local queue)"]
    D["Analytics dashboard ✅<br/>(React Leaflet, Recharts)"]
  end
  subgraph API["Node.js API ✅ (Express)"]
    A1[Auth / consent]
    A2[Sessions + ingestion]
    A3[Datasets + versions]
    A4["Analysis results ✅<br/>(read-only)"]
    A5["Exports / reports 🔜"]
  end
  M[("MongoDB ✅<br/>metadata, sessions,<br/>observations (pilot scale)")]
  F[("analyticsresults ✅<br/>+ output/*.json")]
  P["Python analysis CLI ✅<br/>(pandas, scikit-learn,<br/>own PrefixSpan)"]

  C -- "HTTPS JSON, batched,<br/>idempotent" --> A2
  D -- "aggregate-only queries" --> A4
  API <--> M
  P -- "reads finished sessions" --> M
  P -- "aggregate result" --> F
  A4 -- reads --> F
```

### Responsibilities

| Component | Owns | Never does |
|---|---|---|
| Collection client | Consent UI, location capture during an active session, throttling to the sampling interval, local durable queue, batch upload with retry | Records outside a session; records silently after a reload; sends user-agent or device IDs |
| Node.js API | Accounts, consent records, session lifecycle, observation validation and idempotent storage, deletion, retention, dataset versions, audit log, (later) job orchestration and access control for results | Runs expensive analytics inside request handlers |
| MongoDB | Metadata and, at pilot scale, raw observations | Holds published aggregates mixed with raw data |
| Python analysis CLI | Cleaning, segmentation, stay points, place matching, hourly aggregation, route mining, PrefixSpan, clustering | Accesses account identities (it only sees `participantId`) |
| Analytics dashboard | Aggregate visualisation with small-group suppression | Shows individual trajectories |

## Data flow

```mermaid
sequenceDiagram
  autonumber
  participant U as Participant (browser)
  participant Q as Local queue (localStorage)
  participant API as Node API
  participant DB as MongoDB
  U->>API: register / login (JWT)
  U->>API: POST /consent (all statements, version)
  U->>U: getCurrentPosition (permission prompt)
  U->>API: POST /collection/sessions
  loop while RECORDING
    U->>Q: fix passes interval throttle → observation(seq++)
    Q->>API: POST …/observations (≤ batch size)
    API->>API: validate each observation
    API->>DB: insertMany(ordered:false), unique (sessionId, sequence)
    API->>DB: upsert rejection reasons (no coordinates)
    API-->>Q: accepted / duplicates / rejected[] / totals
    Q->>Q: remove acknowledged sequences
  end
  Note over Q,API: network failure → keep queue, exponential backoff,<br/>resend is safe (duplicates detected)
  U->>API: PATCH status=COMPLETED (only after queue drained)
  Note over API,DB: Researcher freezes a dataset version<br/>(session list + content hash)
  Note over API: npm run analyze reads finished sessions → stores aggregate result
```

### Idempotency and counting

* Each observation carries a client-assigned `sequence`, persisted locally so it is never reused after a reload.
* MongoDB enforces a unique index on `(sessionId, sequence)`. A resend of identical content → `duplicates`; same sequence with different content → rejected as `sequence_conflict` (the original is kept).
* Session counters (`acceptedObservationCount`, `rejectedObservationCount`) are **recomputed** from stored rows after each batch, never incremented, so retries cannot inflate them. Rejection rows are unique on `(sessionId, sequence, reason)`.

### Session lifecycle

```mermaid
stateDiagram-v2
  [*] --> ACTIVE: POST /sessions (consent required)
  ACTIVE --> PAUSED: PATCH PAUSED
  PAUSED --> ACTIVE: PATCH ACTIVE (consent required)
  ACTIVE --> COMPLETED: PATCH COMPLETED / consent withdrawn
  PAUSED --> COMPLETED: PATCH COMPLETED / consent withdrawn
  ACTIVE --> ABANDONED: no activity for 24 h (retention job)
  PAUSED --> ABANDONED: no activity for 24 h
  COMPLETED --> [*]: deleted (participant / retention)
  ABANDONED --> [*]: deleted
```

Uploads are accepted only in `ACTIVE` and `PAUSED` (paused sessions may still be draining their queue). Pause intervals are stored so preprocessing can distinguish deliberate gaps from signal loss.

## Research methodology flow (target)

```mermaid
flowchart TD
  A[Consented collection ✅] --> B[Validation at ingestion ✅]
  B --> C[Frozen dataset version ✅]
  C --> D[Cleaning + segmentation ✅]
  D --> E[Stay-point detection ✅]
  E --> F[Stay regions + verified places ✅]
  D --> G[Trips on a grid ✅]
  F --> H[Sequences → PrefixSpan ✅]
  G --> I[Frequent paths ✅]
  G --> J[Trajectory clustering ✅]
  E --> K[Crowded zones by hour ✅]
  H & I & J & K --> L[Small-group suppression]
  L --> M[Dashboard ✅]
```

## Key design decisions

* **Separate Python service.** Geospatial and mining libraries are mature in Python; isolating them keeps the API responsive and lets analyses run as jobs against immutable dataset versions.
* **MongoDB for observations at pilot scale only.** One document per fix is simple and supports per-session deletion. For larger studies, frozen versions are materialised to Parquet and the analytics service reads those files; MongoDB keeps only references.
* **No silent drops.** Ingestion rejects only malformed or physically impossible values, with recorded reasons. Plausible-but-poor data (low accuracy, jumps) is stored and handled by the cleaning pipeline, which records why each point was flagged.
* **Synthetic data isolation.** Synthetic sessions live in `synthetic-dev` with `dataOrigin: synthetic`; versioning refuses to freeze a dataset that mixes origins.

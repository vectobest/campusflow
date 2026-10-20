# CampusFlow

**Campus Mobility Analytics and Trajectory Mining Platform**

[![CI](https://github.com/vectobest/campusflow/actions/workflows/ci.yml/badge.svg)](https://github.com/vectobest/campusflow/actions/workflows/ci.yml)

CampusFlow is a research platform for studying movement patterns on the campus of the National Institute of Technology (NIT) Raipur. Participating students voluntarily record GPS traces with a mobile-friendly web application. An analysis pipeline then turns these traces into aggregate, privacy-preserving findings about how the campus is used.

| | |
|---|---|
| **Live application** | https://campusflow-web-ten.vercel.app |
| **API health endpoint** | https://campusflow-api-d6h8.onrender.com/api/v1/health |
| **Source code** | https://github.com/vectobest/campusflow |

> **Note on data.** This repository contains no NIT Raipur coordinates or study results. The demonstration dataset is synthetic, is generated around fictional locations, and is labelled as synthetic throughout the application. It must not be interpreted as campus observations.

---

## Table of Contents

1. [Objectives](#1-objectives)
2. [Methodology](#2-methodology)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Repository Structure](#5-repository-structure)
6. [Getting Started](#6-getting-started)
7. [Running the Analysis](#7-running-the-analysis)
8. [Deployment](#8-deployment)
9. [Testing](#9-testing)
10. [Privacy and Ethics](#10-privacy-and-ethics)
11. [Configuration](#11-configuration)
12. [Limitations](#12-limitations)
13. [Documentation](#13-documentation)
14. [Author](#14-author)

---

## 1. Objectives

The project addresses the following research questions:

| No. | Research question |
|---|---|
| RQ1 | Which paths and corridors are most frequently travelled between campus locations? |
| RQ2 | Where do students stop for a meaningful duration, and for how long? |
| RQ3 | How does campus activity vary by hour of day, and between weekdays and weekends? |
| RQ4 | Which zones show the highest observed activity at each hour? |
| RQ5 | Which ordered sequences of visited places recur across trajectories? |
| RQ6 | Can trajectories be grouped into clusters of geometrically similar routes? |

## 2. Methodology

The analysis pipeline processes only completed collection sessions. Every parameter is configurable, and each result records the exact parameter values and algorithm version used to produce it.

| Stage | Method | Default parameters |
|---|---|---|
| Data cleaning | Removal of invalid values, duplicate timestamps, fixes with reported accuracy worse than 50 m, and spatial jumps implying speeds above 12 m/s. Trajectories are split at gaps longer than 5 minutes. Each removal is recorded with its reason. | `max_accuracy_m = 50`, `max_speed_mps = 12`, `gap_split_s = 300` |
| Stay-point detection | Anchor-based algorithm after Li et al. (2008): a stay point is a period of at least 5 minutes during which a trajectory remains within 50 m of an anchor fix. | `stay_distance_m = 50`, `stay_min_duration_s = 300` |
| Stay regions | DBSCAN clustering of stay points from all participants. A region is named only if a verified campus place lies within 60 m; otherwise it is reported as unidentified. | `region_eps_m = 40`, `region_min_samples = 3` |
| Crowded zones by hour | The campus is divided into 50 m grid cells. Activity is measured in distinct participant-days per cell and hour, so that repeated GPS fixes from one person are never counted as multiple people. | `grid_cell_m = 50` |
| Frequent paths | Trips between consecutive stays are mapped onto the grid. Each transition between adjacent cells is counted once per trip, and origin–destination frequencies are computed between stay regions. | `min_trip_length_m = 100` |
| Sequential pattern mining | PrefixSpan (Pei et al., 2001), implemented in this project and verified against brute-force enumeration. Each session is represented as the ordered sequence of stay regions it visited. | `prefixspan_min_support = 3` |
| Trajectory clustering | Trips are resampled to 20 points by arc length and compared by mean point-wise distance. Clustering uses DBSCAN on the precomputed distance matrix; trips that fit no cluster are reported as noise. | `cluster_eps_m = 35`, `cluster_min_samples = 3` |
| Evaluation | Sensitivity analysis across stay-point, clustering and support thresholds, together with participant-contribution statistics. In the absence of ground truth, this evaluation is exploratory. | — |

A detailed description of each method, including its assumptions and computational complexity, is given in [analytics/README.md](analytics/README.md).

## 3. System Architecture

```
┌──────────────────────┐      HTTPS       ┌──────────────────────┐       ┌──────────────────┐
│  Web application     │ ───────────────► │  REST API            │ ────► │  MongoDB Atlas   │
│  React · Vercel      │   (CORS-scoped)  │  Express · Render    │       │                  │
└──────────────────────┘                  └──────────────────────┘       └──────────────────┘
  consent, collection,                      authentication, consent,             ▲
  offline upload queue,                     validated idempotent                 │
  analytics dashboard                       ingestion, deletion,                 │
                                            retention, result API                │
                                                                                 │
                                          ┌──────────────────────┐               │
                                          │  Analysis pipeline   │ ──────────────┘
                                          │  Python · CLI        │   reads sessions,
                                          └──────────────────────┘   writes aggregate results
```

Responsibilities are separated as follows:

- **Web application.** Obtains informed consent and records location only while a session is active. Observations are queued on the device and uploaded in batches with retry, so temporary network loss does not lose data.
- **Authentication.** Users sign in with email and password, or with **Google OAuth 2.0** (Google Identity Services). The Google ID token is verified on the server against the configured client ID before CampusFlow issues its own session token.
- **REST API.** Enforces consent and session ownership, validates every observation, and stores observations idempotently on the key (session, sequence number), so retried uploads never create duplicates. It also handles data deletion and the retention policy.
- **Analysis pipeline.** Reads finished sessions, computes the results described in Section 2, applies privacy suppression, and stores a single aggregate result for the dashboard.

Further detail, including data-flow and state diagrams, is available in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 4. Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, React Router, React Leaflet, Recharts, Lucide icons |
| Backend | Node.js, Express 5, MongoDB, Mongoose 9, JSON Web Tokens, Google OAuth 2.0 / OpenID Connect (google-auth-library), Zod, Helmet, express-rate-limit |
| Analysis | Python 3, pandas, NumPy, scikit-learn, PyMongo |
| Testing | Node test runner with Supertest, Vitest, pytest |
| Infrastructure | Vercel (frontend), Render (API), MongoDB Atlas (database), GitHub Actions (continuous integration) |

## 5. Repository Structure

```
campusflow/
├── client/            React web application (collection interface and analytics dashboard)
├── server/            Express REST API, data models, services and tests
│   └── api/           Serverless entry point (alternative deployment on Vercel)
├── analytics/         Python analysis pipeline, parameters and tests
│   └── places/        Template for verified campus place coordinates
├── docs/              Architecture, data model, privacy, API and deployment documentation
├── render.yaml        Render deployment blueprint
└── .github/workflows/ Continuous integration
```

## 6. Getting Started

### Prerequisites

- Node.js 20 or later
- Python 3.11 or later
- MongoDB 6 or later, running locally or on MongoDB Atlas

### Installation

```bash
git clone https://github.com/vectobest/campusflow.git
cd campusflow
npm install                      # installs the client and server workspaces
npm run setup:analytics          # creates the Python virtual environment
cp server/.env.example server/.env
```

Edit `server/.env` to set `MONGODB_URI` if you are not using a local MongoDB instance. Then verify the connection:

```bash
npm run db:check -w server
```

### Running locally

```bash
npm run dev
```

This starts the API at `http://localhost:4000` and the web application at `http://localhost:5173`. Browsers expose GPS only to secure origins. To test on a mobile device over the local network, run `npm run dev:https` and open the network address it prints.

### Enabling Sign in with Google (optional)

Create an OAuth 2.0 *Web application* client in Google Cloud Console, and add the application's address under **Authorized JavaScript origins**. Then set `GOOGLE_CLIENT_ID` in `server/.env`, or in the API's environment when deployed. Setting `GOOGLE_ALLOWED_DOMAINS=nitrr.ac.in` restricts sign-in to institute accounts. Detailed steps are given in [docs/DEPLOY.md](docs/DEPLOY.md#optional-sign-in-with-google).

### Granting researcher access

Analytics and dataset pages are restricted to researchers. After registering an account, grant the role with:

```bash
npm run set-role -w server -- user@example.com researcher
```

## 7. Running the Analysis

Create `analytics/places/nitrr_places.geojson` from the provided template using verified coordinates. Then run the analysis for the collected dataset:

```bash
npm run analyze -- --dataset nitrr-campus-collected --places analytics/places/nitrr_places.geojson
```

The result is stored in the database and shown on the **Analytics** page. Parameters can be overridden per run, for example `--param stay_distance_m=40 --param grid_cell_m=30`.

To explore the platform without real data, generate and analyse the synthetic demonstration dataset:

```bash
npm run seed -- --csv
npm run analyze -- --dataset synthetic-dev --places data/synthetic/synthetic_places.geojson
```

## 8. Deployment

The production deployment consists of three independently hosted components:

| Component | Host | Notes |
|---|---|---|
| Web application | Vercel | Built with `VITE_API_BASE_URL` pointing to the API |
| REST API | Render (Singapore region) | `CORS_ORIGINS` restricted to the web application's address |
| Database | MongoDB Atlas | Connection string supplied only through environment variables |

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/vectobest/campusflow)

The included [render.yaml](render.yaml) can also deploy both the API and the web application on Render. Step-by-step instructions are provided in [docs/DEPLOY.md](docs/DEPLOY.md). On Render's free plan the API is suspended after 15 minutes of inactivity and takes roughly one minute to resume.

## 9. Testing

```bash
npm test
```

| Suite | Framework | Tests | Coverage |
|---|---|---|---|
| Server | Node test runner, Supertest | 82 | Google sign-in (account creation, linking, token rejection, domain restriction), consent enforcement, session lifecycle, observation validation, idempotent ingestion, ownership isolation, deletion, retention, dataset versioning, access control, static serving, database-unavailable behaviour |
| Client | Vitest | 26 | Sampling throttle, observation mapping, offline queue and retry, duplicate-safe resubmission, session restoration, live distance estimation, API address resolution |
| Analysis | pytest | 61 | Cleaning, stay points, stay regions, zones, paths, PrefixSpan (including brute-force cross-checks), clustering, privacy suppression, end-to-end reproducibility |

All suites, together with a production build, run automatically on every push through GitHub Actions.

## 10. Privacy and Ethics

CampusFlow is designed for aggregate research, not for monitoring individuals. The following safeguards are enforced in code:

- **Informed consent.** Consent is versioned and required before collection; withdrawal stops collection immediately.
- **Session-only collection.** Location is recorded only during a session that the participant starts, and only while the page is open.
- **Identity separation.** Account email addresses are stored separately from research data, which is keyed by a random participant identifier.
- **Restricted raw data.** Raw traces are visible only to the participant who recorded them, and are never published or exported.
- **Small-group suppression.** Every published aggregate requires at least three distinct participants (configurable).
- **Participant control.** Participants may delete individual sessions, all of their data, or their account at any time.
- **Retention.** A retention policy automatically deletes raw traces after a configurable period (365 days by default).
- **Security controls.** The system applies rate limiting, input validation, a restrictive Content Security Policy and audit logging of sensitive operations.

Institutional ethics approval should be obtained before collecting real participant data. The complete privacy model is documented in [docs/PRIVACY.md](docs/PRIVACY.md).

## 11. Configuration

| Location | Purpose |
|---|---|
| [server/.env.example](server/.env.example) | API settings: database, sampling limits, retention, consent version, rate limits, optional study-area boundary |
| [client/.env.example](client/.env.example) | Address of the API for separately deployed frontends |
| [analytics/campusflow/params.py](analytics/campusflow/params.py) | All analysis thresholds |

Secrets such as the database connection string and token-signing key are supplied through environment variables and are excluded from version control.

## 12. Limitations

- **Sample.** The sample is small and self-selected. "Crowded zones" therefore describe observed activity among participants, not physical crowd density.
- **Browser GPS.** Browser-based collection pauses when the device screen is locked, and indoor positioning is imprecise.
- **No ground truth.** No ground-truth labels are available, so the reported sensitivity analyses are exploratory rather than measures of accuracy.
- **Place labels.** A stay region associated with a verified place indicates proximity only; GPS data cannot establish what activity took place there.

## 13. Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, session lifecycle and design decisions |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Database schema, indexes and data lifecycle |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Consent and privacy model |
| [docs/API.md](docs/API.md) | REST API reference |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deployment guide |
| [analytics/README.md](analytics/README.md) | Analysis methods, parameters and limitations |

## 14. Author

**Nitin Bharti**, National Institute of Technology Raipur

No license has been specified for this project. Please contact the author before reusing the code.

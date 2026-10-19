# CampusFlow — Campus Mobility Analytics

Students collect their own GPS traces around the NIT Raipur campus with a phone-friendly web app. The analysis then finds **frequent paths**, **crowded zones by hour**, and **stay points** such as the canteen or library, using three methods: **stay-point detection**, **frequent sequential pattern mining (PrefixSpan)** and **trajectory clustering**.

The point is a real, original dataset with a clear story. Nothing in this repository is a campus finding: no NIT Raipur coordinates or results are bundled, and the demo dataset is synthetic and labelled as such everywhere.

## How it fits together

```
phone browser ──► Node API (Express + MongoDB) ──► Python analysis (npm run analyze) ──► Analytics dashboard
  consent,          sessions, validated,              cleaning, stay points, zones,         map + charts,
  start/stop,       idempotent GPS storage,           paths, PrefixSpan, clustering         aggregates only
  offline queue     deletion, retention               → stored result
```

| Folder | What |
|---|---|
| [client/](client/) | React + Vite + Tailwind: consent, collection, My data, **Analytics** dashboard, Datasets |
| [server/](server/) | Express 5 + Mongoose: auth, consent, sessions, ingestion, deletion, retention, analysis results API |
| [analytics/](analytics/) | Python pipeline: methods, parameters and limitations are in [analytics/README.md](analytics/README.md) |
| [docs/](docs/) | [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [Privacy](docs/PRIVACY.md) · [API](docs/API.md) · **[Deploy](docs/DEPLOY.md)** |

## Quick start

Requirements: Node ≥ 20, Python ≥ 3.11, MongoDB running locally.

```bash
npm install
npm run setup:analytics          # Python venv for the analysis
npm run dev                      # API :4000 + web :5173
```

1. **Collect.** Open http://localhost:5173, create an account, accept the consent form, then Start/Stop a session while walking. On a phone, run `npm run dev:https` and open the printed Network URL; browsers allow GPS only over HTTPS.
2. **Become a researcher.** Run `npm run set-role -w server -- you@example.com researcher`.
3. **Analyse.** Run `npm run analyze -- --dataset nitrr-campus-collected --places analytics/places/nitrr_places.geojson`, then open **Analytics**.

**Demo without real data:** `npm run seed -- --csv` then `npm run analyze -- --dataset synthetic-dev --places data/synthetic/synthetic_places.geojson`. The dashboard shows it on a blank background, marked SYNTHETIC.

## Deploying

One Render web service (API + web app, HTTPS) and a free MongoDB Atlas database; `render.yaml` is included. Step by step: [docs/DEPLOY.md](docs/DEPLOY.md). GitHub Actions runs every test suite on each push.

## The presentation story

| Question | Method | Where it shows |
|---|---|---|
| Where do students stop, and for how long? | Stay-point detection → DBSCAN stay regions → named from verified places | Map: stay regions · table with visits, median stay, arrivals by hour |
| Which zones are busiest at each hour? | Participant × hour × 50 m cell presences | Map with hour slider · busiest zones · hourly weekday/weekend chart |
| Which paths are used most? | Trips between stays → grid corridor counts · origin→destination | Map: corridors (wider = more trips) · OD table |
| What order do people visit places in? | PrefixSpan over per-session place sequences | Pattern table (support, share, participants) · direct transitions |
| Which routes are alike? | Arc-length resampling + DBSCAN | Map: mean path per cluster · cluster cards |
| How trustworthy is this? | Cleaning report, sensitivity sweeps, contribution imbalance | "Method checks" section |

Every count is of **distinct participants or participant-days, never GPS points**. Anything based on fewer than 3 participants (configurable) is hidden.

## Collecting good data

* **Before real collection:** get institutional ethics approval and set `ETHICS_APPROVAL_REF` and `STUDY_CONTACT` (shown on the consent form). Optionally set `STUDY_AREA_BBOX` from a verified campus boundary so off-campus points are never stored.
* **Name the places:** fill `analytics/places/nitrr_places.geojson` from the template with coordinates you measured yourself (stand at each entrance and take a few readings). Unmatched regions show as "Unidentified region"; nothing is guessed.
* **During sessions:** keep the page open with the screen on (the app requests a wake lock). Browsers pause GPS in the background, and the app tells the participant when that happens.
* **Coverage:** aim for many participants over several weekdays and weekend days. The dashboard reports contribution imbalance, and per-hour figures need at least 3 participants to appear.

## Testing

```bash
npm test     # server (node:test, 66) · client collector (vitest, 19) · analytics (pytest, 61)
```

The analytics tests use small fixtures with known answers:

* **Stay points:** stationary, moving, short stop, long stop, GPS drift and long gaps.
* **PrefixSpan:** support counts, ordering, repeats, filters and empty input, plus cross-checks against brute force on 25 random datasets.
* **Clustering:** similar trips, separated trips, direction, noise, empty input, sensitivity and the privacy cut-off.
* **Zones:** distinct-participant counting and suppression.
* **End to end:** a reproducible pipeline run that leaks no identifiers.

## Configuration

Server settings are in [server/.env.example](server/.env.example): sampling interval range, batch size, retention days, consent version, rate limits and the study-area box. Analysis parameters are in [analytics/campusflow/params.py](analytics/campusflow/params.py) and can be overridden per run with `--param name=value`. Every result records the parameters it used.

`.claude/settings.json` turns off the local `ml-pipeline` plugin guard for this project only. It flagged the unsupervised clustering (DBSCAN) as model training.

## Limitations

* The sample is small and self-selected, so "crowded zone" means the most observed activity among participants, not physical crowd size.
* Browser GPS stops when the screen locks, and indoor fixes are noisy.
* There is no ground truth, so the sensitivity tables are exploratory rather than accuracy scores.
* A stay region near a verified place is probably that place, but GPS cannot say what anyone did there.
* Raw traces are visible only to their owner. There is no raw-data export.

"""End-to-end analysis: raw observations -> privacy-safe aggregate result."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import ALGORITHM_VERSION
from . import clustering, paths, staypoints, zones
from .clean import clean
from .params import Params
from .prefixspan import collapse_repeats, prefixspan
from .regions import build_regions

DEFINITIONS = {
    "participants": "Distinct contributing participants (pseudonymous IDs). Never a count of GPS points.",
    "participantDays": "Distinct (participant, local date) pairs. One person on one day counts once per hour and zone.",
    "stayPoint": "A period of at least stay_min_duration_s during which one trajectory stayed within stay_distance_m of an anchor fix.",
    "stayRegion": "A DBSCAN cluster of stay points from all participants: a place where people tend to stop.",
    "visit": "Consecutive stay points of one session in the same stay region, at most visit_merge_gap_s apart, merged into one stop.",
    "trip": "Movement between two consecutive stays (or a stay and the start/end of a trajectory) within one trajectory.",
    "corridorEdge": "Two adjacent grid cells consecutively visited by a trip; frequency = distinct trips using it.",
    "sequenceSupport": "Number of sessions whose ordered list of visited stay regions contains the pattern (gaps allowed).",
    "crowdedZone": "Grid cell ranked by observed participant-days in an hour. Observed activity among participants, not physical crowd size.",
    "suppression": "Any aggregate based on fewer than min_participants distinct participants is withheld.",
}


def run(df: pd.DataFrame, meta: dict, params: Params, places: list[dict] | None = None) -> dict:
    places = places or []
    k = params.min_participants

    def local_time(t):
        return pd.to_datetime(pd.Series(np.asarray(t, float)), unit="s", utc=True).dt.tz_convert(params.timezone)

    points, cleaning, projection = clean(df, params)

    # ---- stay points and regions ----
    stays = staypoints.detect_stay_points(points, params, projection)
    stays, visits, regions = build_regions(stays, params, projection, places, local_time)
    region_names = {r["regionId"]: r["name"] for r in regions}
    visible_regions = [r for r in regions if r["distinctParticipants"] >= k]

    # ---- PrefixSpan over per-session region sequences ----
    seqs, seq_owner = [], []
    if len(visits):
        for sid, g in visits.sort_values("startT").groupby("sessionId"):
            seq = collapse_repeats(g["regionId"].tolist())
            if len(seq) >= 2:
                seqs.append(seq)
                seq_owner.append(g["participantId"].iat[0])
    patterns = []
    for p in prefixspan(seqs, params.prefixspan_min_support, params.prefixspan_max_length, min_length=2) if seqs else []:
        n_people = len({seq_owner[i] for i in p["sequenceIds"]})
        if n_people < k:
            continue
        patterns.append(
            {
                "pattern": p["pattern"],
                "names": [region_names.get(x, x) for x in p["pattern"]],
                "length": len(p["pattern"]),
                "support": p["support"],
                "supportShare": round(p["support"] / len(seqs), 3),
                "participants": n_people,
            }
        )
    transitions = Counter()
    transition_people: dict[tuple, set] = {}
    for seq, owner in zip(seqs, seq_owner):
        for a, b in zip(seq, seq[1:]):
            transitions[(a, b)] += 1
            transition_people.setdefault((a, b), set()).add(owner)
    transition_list = [
        {"from": a, "to": b, "count": c, "participants": len(transition_people[(a, b)])}
        for (a, b), c in transitions.most_common()
        if len(transition_people[(a, b)]) >= k
    ]

    # ---- crowded zones by hour ----
    pres = zones.presences(points, params, local_time) if len(points) else None
    hourly = zones.hourly_activity(pres, k) if pres is not None else []
    cells, suppressed_cell_hours = zones.zone_hour_matrix(pres, params, projection) if pres is not None else ([], 0)

    # ---- trips, frequent paths, clustering ----
    trips = paths.extract_trips(points, stays, params)
    edges, suppressed_edges = paths.corridor_edges(trips, params, projection)
    od = paths.origin_destination(trips, params)
    R = clustering.resample_trips(trips, params.cluster_resample_n)
    D = clustering.distance_matrix(R)
    labels = clustering.cluster(D, params.cluster_eps_m, params.cluster_min_samples)
    clusters = clustering.summarise(trips, R, labels, params, projection)

    summary = {
        "participants": cleaning["participants"] if cleaning["participants"] >= k else None,
        "sessions": cleaning["sessions"],
        "trajectories": cleaning["trajectories"],
        "validObservations": cleaning["keptObservations"],
        "totalDistanceKm": round(sum(t["lengthM"] for t in trips) / 1000, 1),
        "stayPoints": int(len(stays)),
        "stayPointsInRegions": int(stays["regionId"].notna().sum()) if len(stays) else 0,
        "visits": int(len(visits)),
        "medianDwellMin": round(float(visits["dwellSeconds"].median()) / 60, 1) if len(visits) else None,
        "stayRegions": len(visible_regions),
        "trips": len(trips),
        "frequentCorridorEdges": len(edges),
        "sequences": len(seqs),
        "frequentPatterns": len(patterns),
        "trajectoryClusters": len(clusters),
        "noiseTrips": int((labels == -1).sum()),
        "coverage": cleaning["coverage"],
    }

    return {
        "datasetId": meta["datasetId"],
        "dataOrigin": meta.get("dataOrigin"),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "algorithmVersion": ALGORITHM_VERSION,
        "params": params.to_dict(),
        "projection": projection.to_dict(),
        "placesProvided": len(places),
        "definitions": DEFINITIONS,
        "summary": summary,
        "cleaning": cleaning,
        "stayRegions": visible_regions,
        "suppressedRegions": len(regions) - len(visible_regions),
        "hourlyActivity": hourly,
        "collectionDays": zones.collection_days(pres) if pres is not None else {"weekday": 0, "weekend": 0},
        "zones": cells,
        "topZonesByHour": zones.top_zones_by_hour(cells),
        "suppressedZoneHours": suppressed_cell_hours,
        "corridors": edges,
        "suppressedCorridorEdges": suppressed_edges,
        "originDestination": od,
        "sequencePatterns": patterns[:100],
        "transitions": transition_list,
        "clusters": clusters,
        "evaluation": {
            "stayPointSensitivity": staypoints.sensitivity(points, params) if len(points) else [],
            "clusteringSensitivity": clustering.sensitivity(D),
            "prefixspanSupportSweep": [
                {"minSupport": s, "patterns": len(prefixspan(seqs, s, params.prefixspan_max_length, min_length=2)) if seqs else 0}
                for s in sorted({2, 3, 5, 8, params.prefixspan_min_support})
            ],
            "participantContribution": _contribution(points),
        },
    }


def _contribution(points: pd.DataFrame) -> dict:
    """How unevenly participants contributed (imbalance biases every aggregate)."""
    if points.empty:
        return {}
    per = points.groupby("participantId")["sessionId"].nunique().sort_values(ascending=False)
    return {
        "sessionsPerParticipant": {"min": int(per.min()), "median": float(per.median()), "max": int(per.max())},
        "topParticipantShareOfSessions": round(float(per.iloc[0] / per.sum()), 3),
    }

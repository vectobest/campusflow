import json

import numpy as np
import pandas as pd

from campusflow.clustering import cluster, distance_matrix, resample_trips, sensitivity, summarise
from campusflow.params import Params
from campusflow.pipeline import run
from campusflow.regions import build_regions, merge_visits
from conftest import PROJ, make_points, stationary, walk

to_local = lambda t: pd.to_datetime(pd.Series(np.asarray(t, float)), unit="s", utc=True).dt.tz_convert("Asia/Kolkata")  # noqa: E731


def stay_rows(spec):
    """spec: [(participant, session, x, y, startT, endT)]"""
    return pd.DataFrame(
        [{"participantId": p, "sessionId": s, "x": x, "y": y, "startT": a, "endT": b, "dwellSeconds": b - a,
          "trajectoryId": s + "#0", "firstIndex": 0, "lastIndex": 1} for p, s, x, y, a, b in spec]
    )


# ---------------- regions & visits ----------------

def test_regions_named_only_when_verified_place_is_near():
    stays = stay_rows([(f"p{i}", f"s{i}", 2 * i, 0, 0, 600) for i in range(4)] +
                      [(f"p{i}", f"t{i}", 500 + i, 500, 0, 600) for i in range(3)])
    lat, lon = PROJ.to_latlon(0, 0)
    places = [{"placeId": "LIB", "name": "Library", "category": "library", "verificationStatus": "verified",
               "latitude": float(lat), "longitude": float(lon)}]
    stays, visits, regions = build_regions(stays, Params(), PROJ, places, to_local)
    by_id = {r["regionId"]: r for r in regions}
    assert by_id["LIB"]["name"] == "Library" and by_id["LIB"]["visits"] == 4
    other = [r for r in regions if r["regionId"] != "LIB"][0]
    assert other["name"].startswith("Unidentified region") and other["category"] == "unidentified"


def test_lone_stay_is_not_forced_into_a_region():
    stays = stay_rows([(f"p{i}", f"s{i}", i, 0, 0, 600) for i in range(3)] + [("p9", "s9", 900, 900, 0, 600)])
    stays, _, regions = build_regions(stays, Params(), PROJ, [], to_local)
    assert len(regions) == 1
    assert stays.loc[stays["sessionId"] == "s9", "regionId"].isna().all()


def test_visit_merging_rules():
    stays = stay_rows([
        ("p1", "s1", 0, 0, 0, 600), ("p1", "s1", 0, 0, 900, 1500),       # 300 s gap -> same visit
        ("p1", "s1", 0, 0, 5000, 5600),                                     # 3500 s gap -> new visit
        ("p2", "s2", 0, 0, 0, 600),
    ])
    stays["regionId"] = "R1"
    v = merge_visits(stays, 900)
    assert v.groupby("sessionId").size().to_dict() == {"s1": 2, "s2": 1}
    first = v[v["sessionId"] == "s1"].iloc[0]
    assert (first["startT"], first["endT"], first["stayPoints"]) == (0, 1500, 2)


# ---------------- clustering ----------------

def trip(x, y, pid="p"):
    return {"x": np.asarray(x, float), "y": np.asarray(y, float), "participantId": pid, "durationS": 300.0,
            "lengthM": 400.0, "originRegion": None, "destinationRegion": None}


def corridor(offset, n=3, y0=0.0):
    return [trip(np.linspace(0, 400, 20 + k), np.full(20 + k, y0 + offset * k), f"p{k}") for k in range(n)]


def test_resampling_makes_different_sampling_rates_comparable():
    a = trip(np.linspace(0, 400, 5), np.zeros(5))
    b = trip(np.linspace(0, 400, 80), np.zeros(80))
    D = distance_matrix(resample_trips([a, b], 20))
    assert D[0, 1] < 1e-9


def test_similar_trips_cluster_and_separated_corridors_split():
    trips = corridor(3) + corridor(3, y0=300)
    labels = cluster(distance_matrix(resample_trips(trips, 20)), eps=35, min_samples=3)
    assert len(set(labels[:3])) == 1 and len(set(labels[3:])) == 1 and labels[0] != labels[3]
    assert -1 not in labels


def test_direction_matters():
    fwd = corridor(2)
    back = [trip(t["x"][::-1], t["y"][::-1], t["participantId"]) for t in fwd]
    labels = cluster(distance_matrix(resample_trips(fwd + back, 20)), eps=35, min_samples=3)
    assert labels[0] != labels[3]


def test_outlier_trip_is_noise():
    trips = corridor(3) + [trip(np.zeros(20), np.linspace(0, 400, 20), "px")]
    labels = cluster(distance_matrix(resample_trips(trips, 20)), eps=35, min_samples=3)
    assert labels[-1] == -1 and (labels[:3] >= 0).all()


def test_empty_input():
    R = resample_trips([], 20)
    assert cluster(distance_matrix(R), 35, 3).size == 0
    assert summarise([], R, np.array([], int), Params(), PROJ) == []


def test_mean_path_withheld_below_participant_threshold():
    trips = [trip(np.linspace(0, 400, 20), np.full(20, 1.0 * k), "same-person") for k in range(4)]
    R = resample_trips(trips, 20)
    labels = cluster(distance_matrix(R), 35, 3)
    [c] = summarise(trips, R, labels, Params(min_participants=3), PROJ)
    assert c["trips"] == 4 and c["participants"] == 1 and c["meanPath"] is None and c["suppressed"]


def test_parameter_sensitivity_is_monotone_in_noise():
    trips = corridor(10, n=6)
    rows = sensitivity(distance_matrix(resample_trips(trips, 20)), eps_values=(5, 50, 500), min_samples_values=(3,))
    noise = [r["noiseShare"] for r in rows]
    assert noise == sorted(noise, reverse=True)


# ---------------- end to end ----------------

def commute(pid, sid, day=0):
    a = stationary(0, 0, 0, 900)
    w = walk(0, 0, 500, 0, a[-1][2] + 5)
    b = stationary(500, 0, w[-1][2] + 10, 900)
    df = make_points(a + w + b, pid, sid)
    df["timestamp"] += pd.Timedelta(days=day)
    return df


def test_pipeline_end_to_end_is_reproducible_and_aggregate_only():
    df = pd.concat([commute(f"p{i}", f"s{i}", day=i % 2) for i in range(4)], ignore_index=True)
    meta = {"datasetId": "fixture", "dataOrigin": "synthetic"}
    r1 = run(df, meta, Params())
    r2 = run(df, meta, Params())
    for r in (r1, r2):
        r.pop("generatedAt")
    assert json.dumps(r1, sort_keys=True, default=str) == json.dumps(r2, sort_keys=True, default=str)

    s = r1["summary"]
    assert s["participants"] == 4 and s["visits"] == 8 and s["stayRegions"] == 2
    [pattern] = r1["sequencePatterns"]
    origin = min(r1["stayRegions"], key=lambda r: r["longitude"])["regionId"]  # commute starts at x=0 (west)
    assert pattern["support"] == 4 and pattern["participants"] == 4 and pattern["pattern"][0] == origin
    assert r1["originDestination"][0]["trips"] == 4
    assert s["trajectoryClusters"] == 1
    text = json.dumps(r1, default=str)
    assert "sessionId" not in text and "s0" not in text  # no session or participant identifiers leak
    assert all("p0" not in json.dumps(v, default=str) for v in r1.values())


def test_pipeline_suppresses_everything_for_too_few_participants():
    df = pd.concat([commute("p1", "s1"), commute("p2", "s2")], ignore_index=True)
    r = run(df, {"datasetId": "tiny", "dataOrigin": "synthetic"}, Params(min_participants=3))
    assert r["summary"]["participants"] is None
    assert r["stayRegions"] == [] and r["corridors"] == [] and r["zones"] == [] and r["sequencePatterns"] == []
    assert all(c["meanPath"] is None for c in r["clusters"])

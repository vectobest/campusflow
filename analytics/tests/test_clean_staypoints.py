import numpy as np
import pandas as pd

from campusflow.clean import clean
from campusflow.params import Params
from campusflow.staypoints import detect_in_trajectory, detect_stay_points
from conftest import PROJ, make_points, stationary, walk

P = Params()


# ---------------- cleaning ----------------

def test_removes_duplicates_poor_accuracy_and_invalid_with_reasons():
    df = make_points(stationary(0, 0, 0, 100))
    df = pd.concat([df, df.iloc[[3]]])  # duplicate timestamp
    df.loc[df.index[5], "accuracy"] = 200.0
    df.loc[df.index[6], "latitude"] = np.nan
    kept, report, _ = clean(df, P, PROJ)
    r = report["removedByReason"]
    assert (r["duplicate_timestamp"], r["poor_accuracy"], r["invalid_value"]) == (1, 1, 1)
    assert report["keptObservations"] == len(df) - 3
    assert report["totalObservations"] == len(df)


def test_spike_removed_but_following_good_fix_kept():
    pts = stationary(0, 0, 0, 100)
    pts[5] = (800, 0, pts[5][2])  # 800 m jump in 10 s
    kept, report, _ = clean(make_points(pts), P, PROJ)
    assert report["removedByReason"]["implausible_jump"] == 1
    assert len(kept) == len(pts) - 1


def test_splits_at_long_gaps_and_drops_short_fragments():
    pts = stationary(0, 0, 0, 100) + stationary(0, 0, 1000, 100) + [(0, 0, 3000), (0, 0, 3010)]
    kept, report, _ = clean(make_points(pts), P, PROJ)
    assert report["trajectories"] == 2
    assert report["removedByReason"]["short_trajectory"] == 2
    assert kept.groupby("trajectoryId").size().tolist() == [11, 11]


def test_out_of_order_input_is_sorted():
    df = make_points(stationary(0, 0, 0, 60)).sample(frac=1, random_state=1)
    kept, _, _ = clean(df, P, PROJ)
    assert kept["t"].is_monotonic_increasing


# ---------------- stay points ----------------

def detect(pts, d=50, T=300, gap=180):
    x, y, t = (np.array(v, float) for v in zip(*pts))
    return detect_in_trajectory(x, y, t, d, T, gap)


def test_stationary_trajectory_is_one_stay():
    assert detect(stationary(0, 0, 0, 900)) == [(0, 90)]


def test_moving_trajectory_has_no_stay():
    assert detect(walk(0, 0, 2000, 0, 0)) == []


def test_short_stop_below_minimum_is_ignored():
    pts = walk(0, 0, 300, 0, 0)
    pts += stationary(300, 0, pts[-1][2] + 10, 120)
    pts += walk(300, 0, 600, 0, pts[-1][2] + 5)
    assert detect(pts) == []


def test_long_stop_between_walks_detected_with_correct_bounds():
    a = walk(0, 0, 300, 0, 0)
    s = stationary(300, 0, a[-1][2] + 10, 600)
    b = walk(300, 0, 600, 0, s[-1][2])
    stays = detect(a + s + b)
    assert len(stays) == 1
    i, j = stays[0]
    assert i <= len(a) and j >= len(a) + len(s) - 1  # covers the stationary block
    t = [p[2] for p in a + s + b]
    assert t[j] - t[i] >= 600


def test_gps_drift_within_radius_still_counts():
    rng = np.random.default_rng(0)
    pts = [(x, y, t) for (x, y), (_, _, t) in zip(rng.normal(0, 8, (91, 2)), stationary(0, 0, 0, 900))]
    assert len(detect(pts)) == 1


def test_long_gap_breaks_a_stay():
    pts = stationary(0, 0, 0, 200) + stationary(0, 0, 600, 200)  # 400 s gap > 180 s
    assert detect(pts) == []


def test_detect_stay_points_frame_has_required_fields():
    kept, _, _ = clean(make_points(stationary(100, 50, 0, 900)), P, PROJ)
    sp = detect_stay_points(kept, P, PROJ)
    assert len(sp) == 1
    row = sp.iloc[0]
    assert row["dwellSeconds"] == 900 and row["observationCount"] == 91
    assert abs(row["x"] - 100) < 1e-6 and abs(row["y"] - 50) < 1e-6
    assert row["meanAccuracyM"] == 8.0

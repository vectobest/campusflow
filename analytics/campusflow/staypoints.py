"""Stay-point detection (after Li et al., 2008, "Mining user similarity based on
location history").

For each trajectory, take an anchor point i and extend j while every point
stays within `stay_distance_m` of the anchor and no gap between consecutive
fixes exceeds `stay_max_gap_s`. If the covered time span is at least
`stay_min_duration_s`, points i..j-1 form a stay point (centroid, arrival,
departure) and scanning resumes at j; otherwise the anchor moves to i+1.

Complexity: O(n * w) per trajectory, where w is the number of points inside a
stay window (bounded by dwell time / sampling interval).

A stay point only says "this device stayed near here". It does not say what
the person was doing, and it is not a building label.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .params import Params


def detect_in_trajectory(x, y, t, distance_m: float, min_duration_s: float, max_gap_s: float):
    """Return a list of (start_index, end_index_inclusive) for detected stays."""
    x, y, t = np.asarray(x, float), np.asarray(y, float), np.asarray(t, float)
    n = len(t)
    stays = []
    i = 0
    while i < n:
        j = i + 1
        while j < n and np.hypot(x[j] - x[i], y[j] - y[i]) <= distance_m and t[j] - t[j - 1] <= max_gap_s:
            j += 1
        if t[j - 1] - t[i] >= min_duration_s:
            stays.append((i, j - 1))
            i = j
        else:
            i += 1
    return stays


def detect_stay_points(points: pd.DataFrame, params: Params, projection) -> pd.DataFrame:
    """Stay points for every trajectory in a cleaned frame (sorted by trajectoryId, t)."""
    rows = []
    for traj_id, g in points.groupby("trajectoryId", sort=False):
        x, y, t = g["x"].to_numpy(), g["y"].to_numpy(), g["t"].to_numpy()
        acc = g["accuracy"].to_numpy(dtype=float)
        for a, b in detect_in_trajectory(x, y, t, params.stay_distance_m, params.stay_min_duration_s, params.stay_max_gap_s):
            cx, cy = float(x[a : b + 1].mean()), float(y[a : b + 1].mean())
            lat, lon = projection.to_latlon(cx, cy)
            window_acc = acc[a : b + 1]
            rows.append(
                {
                    "stayPointId": f"{traj_id}@{a}",
                    "trajectoryId": traj_id,
                    "sessionId": g["sessionId"].iat[0],
                    "participantId": g["participantId"].iat[0],
                    "startT": float(t[a]),
                    "endT": float(t[b]),
                    "dwellSeconds": float(t[b] - t[a]),
                    "x": cx,
                    "y": cy,
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "observationCount": int(b - a + 1),
                    "meanAccuracyM": float(np.nanmean(window_acc)) if np.isfinite(window_acc).any() else None,
                    "firstIndex": int(a),
                    "lastIndex": int(b),
                }
            )
    cols = ["stayPointId", "trajectoryId", "sessionId", "participantId", "startT", "endT", "dwellSeconds", "x", "y",
            "latitude", "longitude", "observationCount", "meanAccuracyM", "firstIndex", "lastIndex"]
    return pd.DataFrame(rows, columns=cols)


def sensitivity(points: pd.DataFrame, params: Params, distances=(30, 50, 75), durations=(180, 300, 600)) -> list[dict]:
    """How many stay points (and median dwell) each threshold combination yields."""
    out = []
    trajs = [(g["x"].to_numpy(), g["y"].to_numpy(), g["t"].to_numpy()) for _, g in points.groupby("trajectoryId", sort=False)]
    for d in distances:
        for T in durations:
            dwell = []
            for x, y, t in trajs:
                dwell += [t[b] - t[a] for a, b in detect_in_trajectory(x, y, t, d, T, params.stay_max_gap_s)]
            out.append(
                {
                    "distanceM": d,
                    "minDurationS": T,
                    "stayPoints": len(dwell),
                    "medianDwellMin": round(float(np.median(dwell)) / 60, 1) if dwell else None,
                }
            )
    return out

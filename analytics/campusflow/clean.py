"""GPS cleaning and trajectory segmentation.

Nothing is dropped silently: every removed observation gets a reason, and the
report counts them. Accuracy is treated as the device's own uncertainty
estimate, not as ground truth.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .geo import LocalProjection
from .params import Params

REASONS = ("invalid_value", "duplicate_timestamp", "poor_accuracy", "implausible_jump", "short_trajectory")


def _percentiles(s: pd.Series, qs=(10, 50, 90)) -> dict:
    s = s.dropna()
    if s.empty:
        return {f"p{q}": None for q in qs}
    return {f"p{q}": round(float(np.percentile(s, q)), 2) for q in qs}


def clean(df: pd.DataFrame, params: Params, projection: LocalProjection | None = None):
    """Return (cleaned frame with x, y, t, trajectoryId), report dict, projection."""
    total = len(df)
    df = df.copy()
    df["removed"] = pd.Series([None] * len(df), dtype="object", index=df.index)

    bad = (
        df["timestamp"].isna()
        | df["latitude"].isna()
        | df["longitude"].isna()
        | ~df["latitude"].between(-90, 90)
        | ~df["longitude"].between(-180, 180)
    )
    df.loc[bad, "removed"] = "invalid_value"

    df = df.sort_values(["sessionId", "timestamp", "sequence"], kind="stable")
    dup = df["removed"].isna() & df.duplicated(["sessionId", "timestamp"], keep="first")
    df.loc[dup, "removed"] = "duplicate_timestamp"

    poor = df["removed"].isna() & (df["accuracy"] > params.max_accuracy_m)
    df.loc[poor, "removed"] = "poor_accuracy"

    valid = df[df["removed"].isna()]
    if projection is None:
        projection = LocalProjection.for_points(valid["latitude"], valid["longitude"]) if len(valid) else LocalProjection(0, 0)
    x, y = projection.to_xy(df["latitude"].fillna(0).to_numpy(), df["longitude"].fillna(0).to_numpy())
    df["x"], df["y"] = x, y
    # Seconds since epoch; resolution-independent (pandas 3 may store µs, not ns).
    df["t"] = (df["timestamp"] - pd.Timestamp(0, tz="UTC")).dt.total_seconds()

    # Implausible jumps: compare each point with the last point that was KEPT,
    # so a single spike does not also eliminate the good fix after it.
    jump_idx = []
    for _, g in df[df["removed"].isna()].groupby("sessionId", sort=False):
        gx, gy, gt, idx = g["x"].to_numpy(), g["y"].to_numpy(), g["t"].to_numpy(), g.index.to_numpy()
        last = 0
        for k in range(1, len(g)):
            dt = gt[k] - gt[last]
            if dt > params.gap_split_s:
                last = k  # across a gap, speed is meaningless; restart
                continue
            if np.hypot(gx[k] - gx[last], gy[k] - gy[last]) / max(dt, 1e-9) > params.max_speed_mps:
                jump_idx.append(idx[k])
            else:
                last = k
    df.loc[jump_idx, "removed"] = "implausible_jump"

    # Segment into trajectories at long gaps; never connect points across a gap.
    kept = df[df["removed"].isna()].copy()
    gap = kept.groupby("sessionId", sort=False)["t"].diff() > params.gap_split_s
    part = gap.groupby(kept["sessionId"], sort=False).cumsum().astype(int)
    kept["trajectoryId"] = kept["sessionId"] + "#" + part.astype(str)
    sizes = kept.groupby("trajectoryId")["t"].transform("size")
    short_idx = kept.index[sizes < params.min_points_per_trajectory]
    df.loc[short_idx, "removed"] = "short_trajectory"
    kept = kept.drop(index=short_idx)

    durations = kept.groupby("trajectoryId")["t"].agg(lambda s: s.max() - s.min())
    intervals = kept.groupby("trajectoryId")["t"].diff().dropna()
    extent = None
    if len(kept):
        extent = {
            "widthM": round(float(kept["x"].max() - kept["x"].min()), 1),
            "heightM": round(float(kept["y"].max() - kept["y"].min()), 1),
        }

    report = {
        "totalObservations": int(total),
        "keptObservations": int(len(kept)),
        "removedObservations": int(df["removed"].notna().sum()),
        "removedByReason": {r: int((df["removed"] == r).sum()) for r in REASONS},
        "missingAccuracy": int(df["accuracy"].isna().sum()),
        "sessions": int(df["sessionId"].nunique()),
        "participants": int(df["participantId"].nunique()),
        "trajectories": int(kept["trajectoryId"].nunique()),
        "accuracyM": _percentiles(df["accuracy"]),
        "samplingIntervalS": _percentiles(intervals),
        "trajectoryDurationMin": _percentiles(durations / 60),
        "spatialExtent": extent,
        "coverage": {
            "start": kept["timestamp"].min().isoformat() if len(kept) else None,
            "end": kept["timestamp"].max().isoformat() if len(kept) else None,
        },
    }
    kept = kept.sort_values(["trajectoryId", "t"]).reset_index(drop=True)
    return kept.drop(columns=["removed"]), report, projection

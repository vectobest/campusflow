"""Trajectory clustering of trips.

Representation: each trip is resampled to N points equally spaced along its
arc length (in metres), which removes differences in sampling rate and walking
speed while keeping the route shape.

Distance: mean point-wise Euclidean distance between two resampled trips
(a fixed-length, order-aware path distance; direction matters, so A->B and
B->A are different routes). Raw GPS sequences of different lengths are never
compared index-by-index.

Clustering: DBSCAN on the precomputed distance matrix. DBSCAN needs no preset
number of clusters and labels unusual trips as noise. eps is in metres: "two
trips are neighbours if they are, on average, within eps of each other".

Complexity: O(m^2 * N) time and O(m^2) memory for m trips, which is fine for
the hundreds to low thousands of trips of a campus study.

Clusters are groups of geometrically similar trips. They are not groups of
people and say nothing about who made them.
"""

from __future__ import annotations

import numpy as np
from sklearn.cluster import DBSCAN

from .geo import resample_path
from .params import Params


def resample_trips(trips: list[dict], n: int) -> np.ndarray:
    if not trips:
        return np.zeros((0, n, 2))
    return np.stack([np.column_stack(resample_path(t["x"], t["y"], n)) for t in trips])


def distance_matrix(R: np.ndarray) -> np.ndarray:
    m = len(R)
    D = np.zeros((m, m))
    for i in range(m):
        D[i] = np.linalg.norm(R - R[i], axis=2).mean(axis=1)
    return D


def cluster(D: np.ndarray, eps: float, min_samples: int) -> np.ndarray:
    if len(D) == 0:
        return np.array([], dtype=int)
    return DBSCAN(eps=eps, min_samples=min_samples, metric="precomputed").fit_predict(D)


def summarise(trips: list[dict], R: np.ndarray, labels: np.ndarray, params: Params, projection) -> list[dict]:
    out = []
    for label in sorted(set(labels.tolist()) - {-1}):
        idx = np.flatnonzero(labels == label)
        members = [trips[i] for i in idx]
        participants = {t["participantId"] for t in members}
        mean_path = R[idx].mean(axis=0)
        spread = float(np.linalg.norm(R[idx] - mean_path, axis=2).mean())
        visible = len(participants) >= params.min_participants
        lat, lon = projection.to_latlon(mean_path[:, 0], mean_path[:, 1])
        all_xy = np.concatenate([np.column_stack([t["x"], t["y"]]) for t in members])
        out.append(
            {
                "clusterId": int(label),
                "trips": int(len(idx)),
                "participants": int(len(participants)),
                # The mean path is an average of several people's trips, never one person's
                # actual trajectory; it is withheld when too few participants contribute.
                "meanPath": [[float(a), float(b)] for a, b in zip(lat, lon)] if visible else None,
                "suppressed": not visible,
                "spreadM": round(spread, 1),
                "medianDurationMin": round(float(np.median([t["durationS"] for t in members])) / 60, 1),
                "medianLengthM": round(float(np.median([t["lengthM"] for t in members])), 0),
                "extentM": {
                    "width": round(float(np.ptp(all_xy[:, 0])), 0),
                    "height": round(float(np.ptp(all_xy[:, 1])), 0),
                },
                "commonOD": _common_od(members),
            }
        )
    out.sort(key=lambda c: c["trips"], reverse=True)
    return out


def _common_od(members: list[dict]):
    pairs = [(t["originRegion"], t["destinationRegion"]) for t in members if t["originRegion"] and t["destinationRegion"]]
    if not pairs:
        return None
    (o, d), = [max(set(pairs), key=pairs.count)]
    return {"origin": o, "destination": d, "share": round(pairs.count((o, d)) / len(members), 2)}


def sensitivity(D: np.ndarray, eps_values=(20, 35, 50, 75), min_samples_values=(3, 5)) -> list[dict]:
    out = []
    for eps in eps_values:
        for ms in min_samples_values:
            labels = cluster(D, eps, ms)
            n = len(labels)
            sizes = np.bincount(labels[labels >= 0]) if (labels >= 0).any() else np.array([])
            out.append(
                {
                    "epsM": eps,
                    "minSamples": ms,
                    "clusters": int(len(sizes)),
                    "noiseShare": round(float((labels == -1).mean()), 3) if n else None,
                    "largestCluster": int(sizes.max()) if len(sizes) else 0,
                }
            )
    return out

"""Trips and frequent paths.

A *trip* is the movement between two consecutive stays (or between a stay and
the start/end of a trajectory) inside one trajectory. Trips are never stitched
across trajectories, sessions or participants.

Frequent paths are counted on a grid: each trip is densified (so fast or sparse
segments do not skip cells), converted to its sequence of visited cells, and
every pair of consecutive cells becomes an undirected *corridor edge*. An edge's
frequency is the number of distinct trips that used it (a trip counts once per
edge, however much it dithers there). Cell size changes the result: smaller
cells separate parallel paths but split noisy traces of one path.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .geo import path_length
from .params import Params
from .zones import cell_of


def extract_trips(points: pd.DataFrame, stays: pd.DataFrame, params: Params) -> list[dict]:
    trips = []
    stays_by_traj = {k: g.sort_values("firstIndex") for k, g in stays.groupby("trajectoryId")} if len(stays) else {}
    for traj_id, g in points.groupby("trajectoryId", sort=False):
        x, y, t = g["x"].to_numpy(), g["y"].to_numpy(), g["t"].to_numpy()
        st = stays_by_traj.get(traj_id)
        # Boundaries: (end index of previous stay, region) ... (start index of next stay, region)
        bounds = [(0, None)]
        if st is not None:
            for r in st.itertuples():
                bounds.append((r.firstIndex, getattr(r, "regionId", None)))
                bounds.append((r.lastIndex, getattr(r, "regionId", None)))
        bounds.append((len(t) - 1, None))
        for k in range(0, len(bounds) - 1, 2):
            (a, origin), (b, dest) = bounds[k], bounds[k + 1]
            if b - a + 1 < params.min_trip_points:
                continue
            length = path_length(x[a : b + 1], y[a : b + 1])
            if length < params.min_trip_length_m:
                continue
            trips.append(
                {
                    "tripId": f"{traj_id}:{a}-{b}",
                    "trajectoryId": traj_id,
                    "sessionId": g["sessionId"].iat[0],
                    "participantId": g["participantId"].iat[0],
                    "x": x[a : b + 1],
                    "y": y[a : b + 1],
                    "startT": float(t[a]),
                    "endT": float(t[b]),
                    "durationS": float(t[b] - t[a]),
                    "lengthM": length,
                    "originRegion": origin if k > 0 else None,
                    "destinationRegion": dest if k + 1 < len(bounds) - 1 else None,
                }
            )
    return trips


def densify(x, y, step: float):
    xs, ys = [x[0]], [y[0]]
    for i in range(1, len(x)):
        d = np.hypot(x[i] - x[i - 1], y[i] - y[i - 1])
        n = max(1, int(np.ceil(d / step)))
        for k in range(1, n + 1):
            xs.append(x[i - 1] + (x[i] - x[i - 1]) * k / n)
            ys.append(y[i - 1] + (y[i] - y[i - 1]) * k / n)
    return np.array(xs), np.array(ys)


def trip_cells(trip: dict, size: float) -> list[tuple[int, int]]:
    x, y = densify(trip["x"], trip["y"], size / 3)
    ix, iy = cell_of(x, y, size)
    cells = []
    for c in zip(ix.tolist(), iy.tolist()):
        if not cells or cells[-1] != c:
            cells.append(c)
    return cells


def corridor_edges(trips: list[dict], params: Params, projection) -> tuple[list[dict], int]:
    size = params.grid_cell_m
    trip_sets: dict[tuple, set] = {}
    people: dict[tuple, set] = {}
    for trip in trips:
        cells = trip_cells(trip, size)
        for a, b in zip(cells, cells[1:]):
            edge = (a, b) if a <= b else (b, a)
            trip_sets.setdefault(edge, set()).add(trip["tripId"])
            people.setdefault(edge, set()).add(trip["participantId"])

    edges, suppressed = [], 0
    for (a, b), tids in trip_sets.items():
        n_people = len(people[(a, b)])
        if n_people < params.min_participants:
            suppressed += 1
            continue
        lat, lon = projection.to_latlon(
            (np.array([a[0], b[0]]) + 0.5) * size, (np.array([a[1], b[1]]) + 0.5) * size
        )
        edges.append(
            {
                "from": f"{a[0]}_{a[1]}",
                "to": f"{b[0]}_{b[1]}",
                "line": [[float(lat[0]), float(lon[0])], [float(lat[1]), float(lon[1])]],
                "trips": len(tids),
                "participants": n_people,
            }
        )
    edges.sort(key=lambda e: e["trips"], reverse=True)
    return edges, suppressed


def origin_destination(trips: list[dict], params: Params) -> list[dict]:
    """Directed region-to-region trip counts (only trips that start and end at a stay region)."""
    rows = [t for t in trips if t["originRegion"] and t["destinationRegion"] and t["originRegion"] != t["destinationRegion"]]
    if not rows:
        return []
    df = pd.DataFrame(
        {
            "o": [t["originRegion"] for t in rows],
            "d": [t["destinationRegion"] for t in rows],
            "p": [t["participantId"] for t in rows],
            "dur": [t["durationS"] for t in rows],
            "len": [t["lengthM"] for t in rows],
        }
    )
    out = []
    for (o, d), g in df.groupby(["o", "d"]):
        if g["p"].nunique() < params.min_participants:
            continue
        out.append(
            {
                "origin": o,
                "destination": d,
                "trips": int(len(g)),
                "participants": int(g["p"].nunique()),
                "medianDurationMin": round(float(g["dur"].median()) / 60, 1),
                "medianLengthM": round(float(g["len"].median()), 0),
            }
        )
    out.sort(key=lambda r: r["trips"], reverse=True)
    return out

"""Stay regions: places where many participants stop.

Stay points from all participants are clustered with DBSCAN (metres). A region
is named after a verified campus place only if one lies within
`place_match_m`; otherwise it stays "Unidentified region Rn". The nearest place
wins when several are in range, and the others are reported.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

from .params import Params


def cluster_stay_points(stays: pd.DataFrame, params: Params) -> np.ndarray:
    if stays.empty:
        return np.array([], dtype=int)
    xy = stays[["x", "y"]].to_numpy()
    return DBSCAN(eps=params.region_eps_m, min_samples=params.region_min_samples).fit_predict(xy)


def match_place(cx, cy, places_xy, max_m: float):
    candidates = sorted(
        ((float(np.hypot(px - cx, py - cy)), p) for p, px, py in places_xy if np.hypot(px - cx, py - cy) <= max_m),
        key=lambda c: c[0],
    )
    if not candidates:
        return None, []
    return candidates[0], [c[1]["placeId"] for c in candidates[1:]]


def merge_visits(stays: pd.DataFrame, merge_gap_s: float) -> pd.DataFrame:
    """Merge consecutive stays of one session in the same region into visits.

    Stays outside any region are never merged. The time between merged stays is
    counted as dwell, on the assumption that the person stayed while GPS was lost.
    """
    cols = ["visitId", "sessionId", "participantId", "regionId", "startT", "endT", "dwellSeconds", "stayPoints"]
    rows = []
    for sid, g in stays[stays["regionId"].notna()].sort_values("startT").groupby("sessionId", sort=False):
        cur = None
        for r in g.itertuples():
            if cur and r.regionId == cur["regionId"] and r.startT - cur["endT"] <= merge_gap_s:
                cur["endT"] = r.endT
                cur["stayPoints"] += 1
                continue
            if cur:
                rows.append(cur)
            cur = {"visitId": f"{sid}/{len(rows)}", "sessionId": sid, "participantId": r.participantId,
                   "regionId": r.regionId, "startT": r.startT, "endT": r.endT, "stayPoints": 1}
        if cur:
            rows.append(cur)
    visits = pd.DataFrame(rows, columns=[c for c in cols if c != "dwellSeconds"])
    visits["dwellSeconds"] = visits["endT"] - visits["startT"]
    return visits[cols]


def build_regions(stays: pd.DataFrame, params: Params, projection, places: list[dict], local_time):
    """Assign regionId to stays (None = not in any region), merge them into visits,
    and summarise each region from its visits. Returns (stays, visits, regions)."""
    stays = stays.copy()
    labels = cluster_stay_points(stays, params)
    places_xy = []
    for p in places:
        px, py = projection.to_xy(p["latitude"], p["longitude"])
        places_xy.append((p, float(px), float(py)))

    stays["regionId"] = pd.Series([None] * len(stays), dtype="object", index=stays.index)
    regions = []
    for n, label in enumerate(sorted(set(labels.tolist()) - {-1}), start=1):
        member = labels == label
        g = stays[member]
        cx, cy = float(g["x"].mean()), float(g["y"].mean())
        lat, lon = projection.to_latlon(cx, cy)
        match, also_near = match_place(cx, cy, places_xy, params.place_match_m)
        region_id = match[1]["placeId"] if match else f"R{n}"
        if any(r["regionId"] == region_id for r in regions):  # two regions near one place
            region_id = f"{region_id}~{n}"
        stays.loc[member, "regionId"] = region_id
        regions.append(
            {
                "regionId": region_id,
                "name": match[1]["name"] if match else f"Unidentified region R{n}",
                "category": match[1]["category"] if match else "unidentified",
                "placeVerification": match[1]["verificationStatus"] if match else None,
                "placeDistanceM": round(match[0], 1) if match else None,
                "otherPlacesInRange": also_near,
                "latitude": float(lat),
                "longitude": float(lon),
                "radiusM": round(float(np.percentile(np.hypot(g["x"] - cx, g["y"] - cy), 90)), 1),
                "stayPoints": int(len(g)),
            }
        )

    visits = merge_visits(stays, params.visit_merge_gap_s)
    for r in regions:
        v = visits[visits["regionId"] == r["regionId"]]
        arrival = local_time(v["startT"])
        r.update(
            {
                "visits": int(len(v)),
                "distinctParticipants": int(v["participantId"].nunique()),
                "distinctSessions": int(v["sessionId"].nunique()),
                "medianDwellMin": round(float(v["dwellSeconds"].median()) / 60, 1),
                "arrivalsByHour": [int((arrival.dt.hour == h).sum()) for h in range(24)],
                "weekdayVisits": int((arrival.dt.dayofweek < 5).sum()),
                "weekendVisits": int((arrival.dt.dayofweek >= 5).sum()),
            }
        )
    regions.sort(key=lambda r: r["visits"], reverse=True)
    return stays, visits, regions

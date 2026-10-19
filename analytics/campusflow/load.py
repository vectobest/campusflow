"""Load observations from MongoDB (the collection app's database) or a CSV file.

Output frame columns: participantId, sessionId, sequence, timestamp (UTC),
latitude, longitude, accuracy.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

COLUMNS = ["participantId", "sessionId", "sequence", "timestamp", "latitude", "longitude", "accuracy"]


def _finalise(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for col in ("latitude", "longitude", "accuracy"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["sequence"] = pd.to_numeric(df["sequence"], errors="coerce")
    return df[COLUMNS]


def from_mongo(uri: str, dataset_id: str) -> tuple[pd.DataFrame, dict]:
    """Observations from finished sessions of one dataset, plus dataset metadata."""
    from pymongo import MongoClient

    client = MongoClient(uri)
    db = client.get_default_database("campusflow")
    sessions = list(
        db.collectionsessions.find(
            {"datasetId": dataset_id, "collectionStatus": {"$in": ["COMPLETED", "ABANDONED"]}},
            {"_id": 0, "sessionId": 1, "participantId": 1, "dataOrigin": 1},
        )
    )
    if not sessions:
        client.close()
        return pd.DataFrame(columns=COLUMNS), {"datasetId": dataset_id, "dataOrigin": None, "sessions": 0}

    origins = {s["dataOrigin"] for s in sessions}
    if len(origins) > 1:
        raise ValueError(f"Dataset {dataset_id} mixes data origins {origins}; refusing to analyse it")
    owner = {s["sessionId"]: s["participantId"] for s in sessions}
    rows = list(
        db.gpsobservations.find(
            {"sessionId": {"$in": list(owner)}},
            {"_id": 0, "sessionId": 1, "sequence": 1, "timestamp": 1, "latitude": 1, "longitude": 1, "accuracy": 1},
        )
    )
    client.close()
    df = pd.DataFrame(rows, columns=[c for c in COLUMNS if c != "participantId"])
    df["participantId"] = df["sessionId"].map(owner)
    return _finalise(df), {"datasetId": dataset_id, "dataOrigin": origins.pop(), "sessions": len(sessions)}


def from_csv(path: str | Path, dataset_id: str, data_origin: str) -> tuple[pd.DataFrame, dict]:
    df = pd.read_csv(path)
    missing = set(COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing columns: {sorted(missing)}")
    df = _finalise(df)
    return df, {"datasetId": dataset_id, "dataOrigin": data_origin, "sessions": int(df["sessionId"].nunique())}


def load_places(path: str | Path | None) -> list[dict]:
    """Named campus places from GeoJSON Point features.

    Required properties: placeId, name, category, verificationStatus. Only use
    coordinates that were verified on the ground or from an authoritative map.
    """
    if not path:
        return []
    data = json.loads(Path(path).read_text())
    places = []
    for f in data.get("features", []):
        geom = f.get("geometry") or {}
        if geom.get("type") != "Point":
            continue
        lon, lat = geom["coordinates"][:2]
        p = f.get("properties", {})
        places.append(
            {
                "placeId": p.get("placeId") or p.get("name"),
                "name": p.get("name") or p.get("placeId"),
                "category": p.get("category", "other"),
                "verificationStatus": p.get("verificationStatus", "unverified"),
                "latitude": float(lat),
                "longitude": float(lon),
            }
        )
    return places

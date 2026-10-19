"""Crowded zones by hour, on a square grid.

Unit of counting: a *presence* = (participant, local date, local hour, cell).
A participant standing still for an hour produces hundreds of fixes but one
presence, so raw point counts never inflate activity.

Metrics per (cell, hour-of-day):
  participantDays  - distinct (participant, date) pairs observed there in that hour
  participants     - distinct participants (used for privacy suppression)

This measures *observed activity among study participants*, not how many
people were physically present: the sample is small, self-selected and unevenly
spread over days.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .params import Params


def cell_of(x, y, size: float):
    return np.floor(np.asarray(x) / size).astype(int), np.floor(np.asarray(y) / size).astype(int)


def cell_polygon(ix: int, iy: int, size: float, projection) -> list[list[float]]:
    xs = np.array([ix, ix + 1, ix + 1, ix]) * size
    ys = np.array([iy, iy, iy + 1, iy + 1]) * size
    lat, lon = projection.to_latlon(xs, ys)
    return [[float(a), float(b)] for a, b in zip(lat, lon)]


def presences(points: pd.DataFrame, params: Params, local_time) -> pd.DataFrame:
    ix, iy = cell_of(points["x"], points["y"], params.grid_cell_m)
    local = local_time(points["t"])
    p = pd.DataFrame(
        {
            "participantId": points["participantId"].to_numpy(),
            "date": local.dt.date.to_numpy(),
            "hour": local.dt.hour.to_numpy(),
            "weekend": (local.dt.dayofweek >= 5).to_numpy(),
            "ix": ix,
            "iy": iy,
        }
    )
    return p.drop_duplicates()


def hourly_activity(pres: pd.DataFrame, min_participants: int) -> list[dict]:
    """Campus-wide activity per local hour, split weekday/weekend.

    Weekdays outnumber weekend days, so the comparison uses the average number
    of active participants per collection day (days with any data of that type).
    Each figure is suppressed on its own when it rests on too few participants.
    """
    pdays = pres[["participantId", "date", "hour", "weekend"]].drop_duplicates()
    days = pres[["date", "weekend"]].drop_duplicates()
    n_days = {False: int((~days["weekend"]).sum()), True: int(days["weekend"].sum())}
    out = []
    for h in range(24):
        g = pdays[pdays["hour"] == h]
        row = {"hour": h, "participantDays": int(len(g)), "participants": int(g["participantId"].nunique())}
        for weekend, key in ((False, "weekday"), (True, "weekend")):
            part = g[g["weekend"] == weekend]
            ok = part["participantId"].nunique() >= min_participants
            row[f"{key}ParticipantDays"] = int(len(part)) if ok else None
            row[f"{key}AvgPerDay"] = round(len(part) / n_days[weekend], 2) if ok and n_days[weekend] else None
        row["suppressed"] = row["participants"] < min_participants
        if row["suppressed"]:
            row["participantDays"] = None
        out.append(row)
    return out


def collection_days(pres: pd.DataFrame) -> dict:
    days = pres[["date", "weekend"]].drop_duplicates()
    return {"weekday": int((~days["weekend"]).sum()), "weekend": int(days["weekend"].sum())}


def zone_hour_matrix(pres: pd.DataFrame, params: Params, projection) -> tuple[list[dict], int]:
    """Cells with per-hour counts. Hours below the privacy threshold are suppressed (null)."""
    # presences are unique per (participant, date, hour, cell), so row count = participant-days
    agg = (
        pres.groupby(["ix", "iy", "hour"])
        .agg(participantDays=("date", "size"), participants=("participantId", "nunique"))
        .reset_index()
    )

    suppressed = 0
    cells = []
    for (ix, iy), g in agg.groupby(["ix", "iy"]):
        by_hour = [None] * 24
        any_visible = False
        for row in g.itertuples():
            if row.participants >= params.min_participants:
                by_hour[row.hour] = {"participantDays": int(row.participantDays), "participants": int(row.participants)}
                any_visible = True
            else:
                suppressed += 1
        if not any_visible:
            continue
        total_participants = int(pres[(pres["ix"] == ix) & (pres["iy"] == iy)]["participantId"].nunique())
        cells.append(
            {
                "cellId": f"{ix}_{iy}",
                "polygon": cell_polygon(ix, iy, params.grid_cell_m, projection),
                "hours": by_hour,
                "totalParticipants": total_participants,
            }
        )
    return cells, suppressed


def top_zones_by_hour(cells: list[dict], k: int = 5) -> list[dict]:
    out = []
    for h in range(24):
        ranked = sorted(
            (c for c in cells if c["hours"][h]),
            key=lambda c: (c["hours"][h]["participantDays"], c["hours"][h]["participants"]),
            reverse=True,
        )[:k]
        out.append({"hour": h, "cells": [{"cellId": c["cellId"], **c["hours"][h]} for c in ranked]})
    return out

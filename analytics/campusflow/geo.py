"""Coordinate helpers.

Distances are computed in a local equirectangular projection centred on the
dataset. Over a campus-sized area (a few km) its distance error is far below
GPS noise (< 0.1 %), and it lets every algorithm work in plain metres.
"""

from __future__ import annotations

import math

import numpy as np

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres (vectorised)."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))


class LocalProjection:
    """Equirectangular projection around (lat0, lon0): x east, y north, metres."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0 = float(lat0)
        self.lon0 = float(lon0)
        self._kx = EARTH_RADIUS_M * math.cos(math.radians(self.lat0)) * math.pi / 180
        self._ky = EARTH_RADIUS_M * math.pi / 180

    @classmethod
    def for_points(cls, lat, lon) -> "LocalProjection":
        return cls(float(np.median(lat)), float(np.median(lon)))

    def to_xy(self, lat, lon):
        return (np.asarray(lon) - self.lon0) * self._kx, (np.asarray(lat) - self.lat0) * self._ky

    def to_latlon(self, x, y):
        return self.lat0 + np.asarray(y) / self._ky, self.lon0 + np.asarray(x) / self._kx

    def to_dict(self) -> dict:
        return {"type": "local-equirectangular", "lat0": self.lat0, "lon0": self.lon0}


def path_length(x, y) -> float:
    x, y = np.asarray(x, float), np.asarray(y, float)
    if len(x) < 2:
        return 0.0
    return float(np.hypot(np.diff(x), np.diff(y)).sum())


def resample_path(x, y, n: int):
    """Resample a polyline to n points equally spaced along its arc length."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    seg = np.hypot(np.diff(x), np.diff(y))
    s = np.concatenate([[0.0], np.cumsum(seg)])
    if s[-1] == 0:
        return np.full(n, x[0]), np.full(n, y[0])
    targets = np.linspace(0, s[-1], n)
    return np.interp(targets, s, x), np.interp(targets, s, y)

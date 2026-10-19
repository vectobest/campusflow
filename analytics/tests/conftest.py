import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from campusflow.geo import LocalProjection  # noqa: E402

PROJ = LocalProjection(21.25, 81.60)
T0 = pd.Timestamp("2026-10-12T03:30:00Z")  # Monday 09:00 IST


def make_points(xy_t, participant="p1", session="s1"):
    """Build an observation frame from [(x_m, y_m, seconds_after_T0), ...]."""
    xs, ys, ts = zip(*xy_t)
    lat, lon = PROJ.to_latlon(np.array(xs, float), np.array(ys, float))
    return pd.DataFrame(
        {
            "participantId": participant,
            "sessionId": session,
            "sequence": range(len(xs)),
            "timestamp": [T0 + pd.Timedelta(seconds=s) for s in ts],
            "latitude": lat,
            "longitude": lon,
            "accuracy": 8.0,
        }
    )


def stationary(x, y, start, seconds, every=10):
    return [(x, y, start + k) for k in range(0, seconds + 1, every)]


def walk(x0, y0, x1, y1, start, speed=1.4, every=5):
    d = float(np.hypot(x1 - x0, y1 - y0))
    n = max(1, int(d / (speed * every)))
    return [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, start + k * every) for k in range(1, n + 1)]


@pytest.fixture
def proj():
    return PROJ

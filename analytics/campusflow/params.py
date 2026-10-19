"""All tunable parameters in one place. Every result records the exact values used."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field, fields


@dataclass(frozen=True)
class Params:
    # --- cleaning ---
    max_accuracy_m: float = 50.0  # fixes reporting worse accuracy are removed (reason logged)
    max_speed_mps: float = 12.0  # implied speed above this between fixes = GPS jump
    gap_split_s: float = 300.0  # split a session into trajectories at gaps longer than this
    min_points_per_trajectory: int = 5

    # --- stay points (Li et al. 2008 style) ---
    stay_distance_m: float = 50.0  # points must stay within this radius of the anchor
    stay_min_duration_s: float = 300.0  # ...for at least this long
    stay_max_gap_s: float = 180.0  # a gap longer than this inside a candidate ends it

    # --- stay regions (DBSCAN over stay points of all participants) ---
    region_eps_m: float = 40.0
    region_min_samples: int = 3
    place_match_m: float = 60.0  # name a region after a verified place within this distance
    # Consecutive stays of one session in the same region, less than this apart, are one
    # visit (GPS often drops indoors, splitting a single stop into several stay points).
    visit_merge_gap_s: float = 900.0

    # --- crowded zones by hour ---
    grid_cell_m: float = 50.0
    timezone: str = "Asia/Kolkata"

    # --- frequent paths / trips ---
    min_trip_length_m: float = 100.0
    min_trip_points: int = 5

    # --- PrefixSpan ---
    prefixspan_min_support: int = 3  # number of sessions containing the pattern
    prefixspan_max_length: int = 5

    # --- trajectory clustering ---
    cluster_resample_n: int = 20
    cluster_eps_m: float = 35.0  # mean point-wise distance between resampled trips
    cluster_min_samples: int = 3

    # --- privacy ---
    # Aggregates with fewer distinct participants are suppressed. Same env variable as the API,
    # so the privacy notice and the analysis always agree.
    min_participants: int = field(default_factory=lambda: int(os.environ.get("MIN_AGGREGATE_PARTICIPANTS", 3)))

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_overrides(cls, overrides: dict) -> "Params":
        known = {f.name: f.type for f in fields(cls)}
        clean = {}
        for k, v in overrides.items():
            if k not in known:
                raise ValueError(f"Unknown parameter: {k}")
            clean[k] = v
        defaults = cls()
        return cls(**{**defaults.to_dict(), **{k: type(getattr(defaults, k))(v) for k, v in clean.items()}})

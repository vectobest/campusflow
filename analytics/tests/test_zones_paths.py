import pandas as pd

from campusflow.clean import clean
from campusflow.params import Params
from campusflow.paths import corridor_edges, extract_trips, origin_destination, trip_cells
from campusflow.staypoints import detect_stay_points
from campusflow.zones import hourly_activity, presences, top_zones_by_hour, zone_hour_matrix
from conftest import PROJ, make_points, stationary, walk

P = Params(min_participants=2)
to_local = lambda t: pd.to_datetime(pd.Series(t), unit="s", utc=True).dt.tz_convert(P.timezone)  # noqa: E731


def cleaned(frames):
    kept, _, _ = clean(pd.concat(frames, ignore_index=True), P, PROJ)
    return kept


def test_stationary_participant_counts_once_not_per_fix():
    # p1 sends 360 fixes in one cell during one hour; p2 sends 7.
    kept = cleaned([
        make_points(stationary(10, 10, 0, 3600 - 10), "p1", "s1"),
        make_points(stationary(12, 12, 0, 60), "p2", "s2"),
    ])
    pres = presences(kept, P, to_local)
    hourly = hourly_activity(pres, 2)
    h9 = hourly[9]  # T0 is 09:00 IST
    assert h9["participants"] == 2
    assert h9["participantDays"] == 2
    cells, suppressed = zone_hour_matrix(pres, P, PROJ)
    assert len(cells) == 1 and cells[0]["hours"][9] == {"participantDays": 2, "participants": 2}
    assert suppressed == 0


def test_cells_below_threshold_are_suppressed():
    kept = cleaned([make_points(stationary(10, 10, 0, 60), "p1", "s1")])
    cells, suppressed = zone_hour_matrix(presences(kept, P, to_local), P, PROJ)
    assert cells == [] and suppressed == 1


def test_same_participant_two_days_is_two_participant_days():
    day2 = make_points(stationary(10, 10, 0, 60), "p1", "s2")
    day2["timestamp"] += pd.Timedelta(days=1)
    kept = cleaned([make_points(stationary(10, 10, 0, 60), "p1", "s1"), day2,
                    make_points(stationary(10, 10, 0, 60), "p2", "s3")])
    cells, _ = zone_hour_matrix(presences(kept, P, to_local), P, PROJ)
    assert cells[0]["hours"][9] == {"participantDays": 3, "participants": 2}
    assert top_zones_by_hour(cells)[9]["cells"][0]["participantDays"] == 3


def _commute(pid, sid):
    a = stationary(0, 0, 0, 600)
    w = walk(0, 0, 400, 0, a[-1][2] + 5)
    b = stationary(400, 0, w[-1][2] + 10, 600)
    return make_points(a + w + b, pid, sid)


def test_trips_between_stays_and_corridor_counts():
    kept = cleaned([_commute("p1", "s1"), _commute("p2", "s2"), _commute("p2", "s3")])
    stays = detect_stay_points(kept, P, PROJ)
    stays["regionId"] = ["A" if x < 200 else "B" for x in stays["x"]]
    trips = extract_trips(kept, stays, P)
    assert len(trips) == 3
    assert {(t["originRegion"], t["destinationRegion"]) for t in trips} == {("A", "B")}
    edges, _ = corridor_edges(trips, P, PROJ)
    assert edges and all(e["trips"] == 3 and e["participants"] == 2 for e in edges)
    od = origin_destination(trips, P)
    assert od == [{"origin": "A", "destination": "B", "trips": 3, "participants": 2,
                   "medianDurationMin": od[0]["medianDurationMin"], "medianLengthM": od[0]["medianLengthM"]}]


def test_sparse_trip_does_not_skip_cells():
    import numpy as np
    trip = {"x": np.array([0.0, 400.0]), "y": np.array([10.0, 10.0])}
    cells = trip_cells(trip, 50)
    assert [c[0] for c in cells] == list(range(0, 9))


def test_weekday_weekend_figures_are_suppressed_separately_and_averaged_per_day():
    weekend = make_points(stationary(10, 10, 0, 60), "p3", "s3")
    weekend["timestamp"] += pd.Timedelta(days=5)  # Saturday
    kept = cleaned([make_points(stationary(10, 10, 0, 60), "p1", "s1"),
                    make_points(stationary(10, 10, 0, 60), "p2", "s2"), weekend])
    h9 = hourly_activity(presences(kept, P, to_local), 2)[9]
    assert h9["participants"] == 3 and h9["participantDays"] == 3
    assert h9["weekdayParticipantDays"] == 2 and h9["weekdayAvgPerDay"] == 2.0
    assert h9["weekendParticipantDays"] is None and h9["weekendAvgPerDay"] is None  # only one weekend participant

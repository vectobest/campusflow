"""CLI:  python -m campusflow --dataset nitrr-campus-collected [--places places/nitrr.geojson]

Reads finished sessions from MongoDB (or --csv), runs the full analysis, stores
the aggregate result in MongoDB (`analyticsresults`, read by the dashboard) and
writes output/<dataset>.json.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from . import load
from .params import Params
from .pipeline import run


def parse_param(s: str):
    if "=" not in s:
        raise argparse.ArgumentTypeError("use name=value")
    k, v = s.split("=", 1)
    return k.strip(), v.strip()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="campusflow", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True, help="datasetId, e.g. nitrr-campus-collected or synthetic-dev")
    ap.add_argument("--mongo-uri", default=os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017/campusflow"))
    ap.add_argument("--csv", help="read observations from CSV instead of MongoDB")
    ap.add_argument("--origin", default="imported", choices=["collected", "imported", "synthetic"], help="dataOrigin for --csv")
    ap.add_argument("--places", help="GeoJSON of verified campus places used to name stay regions")
    ap.add_argument("--param", action="append", type=parse_param, default=[], help="override a parameter, e.g. --param stay_distance_m=40")
    ap.add_argument("--no-save", action="store_true", help="do not write to MongoDB")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "output"))
    args = ap.parse_args(argv)

    params = Params.from_overrides(dict(args.param))
    if args.csv:
        df, meta = load.from_csv(args.csv, args.dataset, args.origin)
    else:
        df, meta = load.from_mongo(args.mongo_uri, args.dataset)
    if df.empty:
        print(f"No finished sessions with observations in dataset '{args.dataset}'.", file=sys.stderr)
        return 1

    started = time.time()
    result = run(df, meta, params, load.load_places(args.places))
    result["runtimeSeconds"] = round(time.time() - started, 2)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{args.dataset}.json"
    out_file.write_text(json.dumps(result, indent=1, default=str))

    if not args.no_save:
        from pymongo import MongoClient

        client = MongoClient(args.mongo_uri)
        client.get_default_database("campusflow").analyticsresults.insert_one(dict(result))
        client.close()

    s = result["summary"]
    banner = "  ** SYNTHETIC DATA — not campus observations **" if result["dataOrigin"] == "synthetic" else ""
    print(f"Dataset {args.dataset} ({result['dataOrigin']}){banner}")
    print(f"  cleaned: {result['cleaning']['keptObservations']}/{result['cleaning']['totalObservations']} observations, "
          f"{s['trajectories']} trajectories, {s['trips']} trips")
    print(f"  stay points: {s['stayPoints']} -> {s['stayRegions']} stay regions")
    print(f"  frequent corridor edges: {s['frequentCorridorEdges']}, OD pairs: {len(result['originDestination'])}")
    print(f"  PrefixSpan: {s['sequences']} sequences -> {s['frequentPatterns']} patterns (min support {params.prefixspan_min_support})")
    print(f"  clusters: {s['trajectoryClusters']} (+{s['noiseTrips']} noise trips)")
    print(f"  wrote {out_file}{'' if args.no_save else ' and MongoDB analyticsresults'} in {result['runtimeSeconds']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

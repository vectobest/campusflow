"""PrefixSpan (Pei et al., 2001) for sequences of single items.

A sequence here is the ordered list of places one session visited, e.g.
["HOSTEL_A", "ACADEMIC", "CANTEEN"]. A pattern P is *contained* in a sequence
S if P's items appear in S in the same order, not necessarily contiguously.
Support of P = number of sequences containing P (each sequence counts once,
no matter how many times P occurs in it).

Algorithm: for the current prefix, keep a projected database of
(sequence id, start offset) pairs where the suffix after the prefix's first
occurrence begins. Count, per item, how many distinct sequences contain it in
their suffix; each frequent item extends the prefix and the database is
projected again. Using the *first* occurrence is what makes the projection
complete: any later occurrence's suffix is a sub-suffix of the first one.

Worst-case complexity is exponential in pattern length (as for all frequent
sequence mining); in practice it is bounded by min_support and max_length.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Hashable, Sequence


def prefixspan(
    sequences: Sequence[Sequence[Hashable]],
    min_support: int,
    max_length: int | None = None,
    min_length: int = 1,
) -> list[dict]:
    """Return frequent patterns as dicts {pattern, support, sequenceIds}.

    Sorted by support (desc), then length (desc), then pattern.
    """
    if min_support < 1:
        raise ValueError("min_support must be >= 1")
    results: list[dict] = []

    def mine(prefix: list, projected: list[tuple[int, int]]):
        # item -> set of sequence ids whose suffix contains it
        holders: dict[Hashable, set[int]] = defaultdict(set)
        for sid, start in projected:
            for item in set(sequences[sid][start:]):
                holders[item].add(sid)
        for item in sorted(holders, key=str):
            sids = holders[item]
            if len(sids) < min_support:
                continue
            pattern = prefix + [item]
            if len(pattern) >= min_length:
                results.append({"pattern": pattern, "support": len(sids), "sequenceIds": sorted(sids)})
            if max_length is None or len(pattern) < max_length:
                next_db = []
                for sid, start in projected:
                    if sid not in sids:
                        continue
                    seq = sequences[sid]
                    k = start
                    while seq[k] != item:  # first occurrence after start; exists because sid in sids
                        k += 1
                    next_db.append((sid, k + 1))
                mine(pattern, next_db)

    mine([], [(i, 0) for i in range(len(sequences))])
    results.sort(key=lambda r: (-r["support"], -len(r["pattern"]), [str(x) for x in r["pattern"]]))
    return results


def contains(sequence: Sequence, pattern: Sequence) -> bool:
    """True if pattern is an (ordered, possibly gapped) subsequence of sequence."""
    it = iter(sequence)
    return all(any(x == p for x in it) for p in pattern)


def collapse_repeats(seq: Sequence) -> list:
    """["A","A","B","A"] -> ["A","B","A"]: consecutive repeats are one visit."""
    out = []
    for item in seq:
        if not out or out[-1] != item:
            out.append(item)
    return out

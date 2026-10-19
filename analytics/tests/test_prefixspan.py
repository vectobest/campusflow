import itertools
import random

import pytest

from campusflow.prefixspan import collapse_repeats, contains, prefixspan


def as_map(results):
    return {tuple(r["pattern"]): r["support"] for r in results}


def brute_force(sequences, min_support, max_length):
    items = sorted({i for s in sequences for i in s})
    out = {}
    for L in range(1, max_length + 1):
        for pat in itertools.product(items, repeat=L):
            sup = sum(contains(s, pat) for s in sequences)
            if sup >= min_support:
                out[pat] = sup
    return out


def test_textbook_example_support_counts():
    seqs = [list("abcd"), list("acbd"), list("abd"), list("bd")]
    got = as_map(prefixspan(seqs, min_support=3))
    assert got[("a",)] == 3
    assert got[("b",)] == 4
    assert got[("b", "d")] == 4
    assert got[("a", "b")] == 3
    assert got[("a", "b", "d")] == 3
    assert ("a", "c") not in got  # support 2


def test_order_matters():
    got = as_map(prefixspan([["H", "A"], ["H", "A"], ["A", "H"]], min_support=2))
    assert got[("H", "A")] == 2
    assert ("A", "H") not in got


def test_repeated_locations_count_once_per_sequence():
    got = as_map(prefixspan([["A", "B", "A", "B"], ["A", "B"]], min_support=1))
    assert got[("A", "B")] == 2
    assert got[("A", "B", "A", "B")] == 1
    assert got[("B", "A")] == 1


def test_min_support_and_length_filters():
    seqs = [["H", "C", "L"], ["H", "C"], ["H", "L"]]
    res = prefixspan(seqs, min_support=2, min_length=2, max_length=2)
    assert as_map(res) == {("H", "C"): 2, ("H", "L"): 2}
    assert all(len(r["pattern"]) == 2 for r in res)


def test_sequence_ids_identify_supporting_sequences():
    res = {tuple(r["pattern"]): r["sequenceIds"] for r in prefixspan([["A", "B"], ["B"], ["A", "C", "B"]], 2)}
    assert res[("A", "B")] == [0, 2]


def test_empty_input_and_invalid_support():
    assert prefixspan([], 1) == []
    assert prefixspan([[], []], 1) == []
    with pytest.raises(ValueError):
        prefixspan([["A"]], 0)


@pytest.mark.parametrize("seed", range(25))
def test_matches_brute_force_on_random_data(seed):
    rnd = random.Random(seed)
    seqs = [[rnd.choice("ABCD") for _ in range(rnd.randint(0, 6))] for _ in range(rnd.randint(1, 8))]
    min_sup = rnd.randint(1, 3)
    assert as_map(prefixspan(seqs, min_sup, max_length=4)) == brute_force(seqs, min_sup, 4)


def test_collapse_repeats():
    assert collapse_repeats(["A", "A", "B", "A", "A"]) == ["A", "B", "A"]
